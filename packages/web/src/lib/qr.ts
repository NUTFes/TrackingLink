import QRCodeLib from 'qrcode';
import { TRACKING_LINK_API_URL } from '../config';

/**
 * Base URL that scanned QR codes resolve against. Separate from the API URL
 * because the redirect endpoint can live on its own hostname (see
 * VITE_FWD_BASE_URL in .env.example).
 */
const FWD_BASE_URL = import.meta.env.VITE_FWD_BASE_URL ?? TRACKING_LINK_API_URL;

/**
 * Longest fallback keyword accepted. Mirrors FALLBACK_KEY_MAX in the API's
 * projects route and the Projects.fallback_key column.
 */
const FALLBACK_KEY_MAX = 40;

/**
 * Suggests a fallback keyword from a destination URL's host.
 *
 * `https://www.instagram.com/nutfes/` → `instagram`. Strips a leading `www.` and
 * takes the first label, which gives a sensible answer for `nutfes.net`,
 * `www.nutfes.ac.jp` and `example.co.jp` alike without needing a public-suffix
 * list.
 *
 * Used in two places: to prefill the field when someone types a destination URL,
 * and — more importantly — as the effective keyword for projects whose
 * `fallbackKey` is still blank. That second use is why no data migration was
 * needed: QR codes for projects created before the column existed still carry a
 * usable keyword.
 *
 * Returns '' rather than throwing for anything unparseable; the caller then just
 * omits `&p=` and the scan falls through to the site-wide fallback.
 */
export function deriveFallbackKey(destinationUrl: string): string {
	let host: string;
	try {
		host = new URL(destinationUrl).hostname;
	} catch {
		return '';
	}

	const label = host.replace(/^www\./i, '').split('.')[0] ?? '';
	return label
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '')
		.replace(/^-+/, '')
		.slice(0, FALLBACK_KEY_MAX);
}

/**
 * The URL baked into a printed QR code.
 *
 * `&p=<fallbackKey>` is what lets a scan still reach somewhere sensible when the
 * Worker cannot read D1 — see packages/api/src/fallback.ts for why this is a
 * keyword rather than the destination URL itself.
 *
 * Extracted from the dialog because it is the one string that, if wrong, produces
 * posters that have to be reprinted — and because a future bulk-print view needs
 * exactly this and nothing else from the dialog.
 */
export function qrTargetUrl(qrId: string, fallbackKey = ''): string {
	const base = `${FWD_BASE_URL}/?id=${qrId}`;
	// Omitted rather than sent empty: `&p=` with no value is noise in the payload
	// and the Worker treats a missing key and a blank one identically.
	return fallbackKey ? `${base}&p=${encodeURIComponent(fallbackKey)}` : base;
}

/** On-screen preview. */
export function qrPreviewDataUrl(text: string): Promise<string> {
	return QRCodeLib.toDataURL(text, {
		width: 300,
		margin: 2,
		errorCorrectionLevel: 'H',
	});
}

const PNG_QR_SIZE = 640;
const PNG_PADDING = 32;
const CAPTION_LINE_HEIGHT = 34;
const CAPTION_FONT_SIZE = 24;

/** Shortens a caption line to fit the image width, with an ellipsis. */
function fitText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}
	return `${text.slice(0, low)}…`;
}

/**
 * Renders a QR code to a PNG with its name, medium and location printed beneath.
 *
 * The caption is the point. One QR code is generated per physical item, and the
 * downloaded PNG used to carry no identifying text at all — so once printed,
 * nobody could tell which poster a given sheet belonged to. The filename helps in
 * a folder; only the caption helps on paper.
 */
export async function qrPngBlob(
	text: string,
	captionLines: string[],
): Promise<Blob> {
	const qrCanvas = document.createElement('canvas');
	await QRCodeLib.toCanvas(qrCanvas, text, {
		width: PNG_QR_SIZE,
		margin: 2,
		errorCorrectionLevel: 'H',
	});

	const lines = captionLines.filter(Boolean);
	const canvas = document.createElement('canvas');
	canvas.width = qrCanvas.width + PNG_PADDING * 2;
	canvas.height =
		qrCanvas.height +
		PNG_PADDING * 2 +
		(lines.length ? lines.length * CAPTION_LINE_HEIGHT + PNG_PADDING / 2 : 0);

	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');

	// Explicit white fill: a transparent PNG prints as nothing useful, and QR
	// scanners need the quiet zone to actually be light.
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(qrCanvas, PNG_PADDING, PNG_PADDING);

	if (lines.length) {
		ctx.fillStyle = '#000000';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		const maxWidth = canvas.width - PNG_PADDING * 2;
		let y = qrCanvas.height + PNG_PADDING + PNG_PADDING / 2;
		for (const [index, line] of lines.entries()) {
			// First line is the name, and it is what someone reads from across a
			// corridor — so it gets the bold weight.
			ctx.font = `${index === 0 ? '600 ' : ''}${CAPTION_FONT_SIZE}px system-ui, sans-serif`;
			ctx.fillText(fitText(ctx, line, maxWidth), canvas.width / 2, y);
			y += CAPTION_LINE_HEIGHT;
		}
	}

	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('Failed to encode the QR code as PNG'));
		}, 'image/png');
	});
}
