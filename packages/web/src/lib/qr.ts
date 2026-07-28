import QRCodeLib from 'qrcode';
import { TRACKING_LINK_API_URL } from '../config';
import { slugForFilename } from './format';

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

/**
 * Filename for a downloaded QR code PNG: `<name>_QR.png`.
 *
 * Only the name goes in. The medium and location were in here as well, which
 * buried the one part anyone actually scans a folder for behind two fields that
 * repeat across most codes.
 *
 * Extracted rather than inlined for the same reason as qrTargetUrl: a bulk-print
 * view will need exactly this, and the two must not drift.
 */
export function qrPngFileName(name: string): string {
	// 'QR' is passed as a part rather than appended, so the separator collapsing
	// in slugForFilename applies to it too — a blank name gives "QR.png", not
	// "_QR.png".
	return `${slugForFilename(name, 'QR')}.png`;
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

/** One printed line beneath the QR code. */
export interface QrCaptionLine {
	text: string;
	/** Rendered bold. Reserved for the name — see qrCaptionLines. */
	emphasis?: boolean;
}

/** Which of the two required fields get printed under the code. */
export interface QrCaptionOptions {
	includeName: boolean;
	includeMedium: boolean;
}

/**
 * Nothing is printed unless asked for.
 *
 * A caption is only wanted when the sheet is one of many being sorted by hand;
 * for a poster that already carries its own design, text under the code is
 * clutter someone has to crop off. Defaulting to off makes the clean version the
 * one you get without thinking about it.
 */
export const QR_CAPTION_DEFAULTS: QrCaptionOptions = {
	includeName: false,
	includeMedium: false,
};

/**
 * Builds the caption for a QR code PNG from the two required fields.
 *
 * `location` is optional and has no toggle of its own: it qualifies the medium
 * ("Poster · 1F bulletin board") and shares its line, so it follows the medium's
 * checkbox. A location with no medium to attach to would read as a stray
 * fragment on a printed sheet.
 *
 * Split out of the dialog so the mapping from checkboxes to printed lines can be
 * tested without a canvas.
 */
export function qrCaptionLines(
	qr: { name: string; medium: string; location?: string | null },
	options: QrCaptionOptions,
): QrCaptionLine[] {
	const lines: QrCaptionLine[] = [];

	// The name is what someone reads from across a corridor, so it takes the bold
	// weight — but only ever the name. Emphasis is tied to the field, not to the
	// position, or a medium-only caption would print in bold and read as a title.
	if (options.includeName && qr.name) {
		lines.push({ text: qr.name, emphasis: true });
	}

	if (options.includeMedium) {
		const text = [qr.medium, qr.location].filter(Boolean).join(' · ');
		if (text) lines.push({ text });
	}

	return lines;
}

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
 * Renders a QR code to a PNG, optionally with a caption printed beneath.
 *
 * One QR code is generated per physical item, so on paper the caption is the only
 * thing that says which item a given sheet belongs to — the filename only helps
 * while it is still in a folder. It is opt-in nonetheless: see
 * QR_CAPTION_DEFAULTS. With no lines the output is just the code on white, which
 * is what a designer placing it into a poster wants.
 */
export async function qrPngBlob(
	text: string,
	captionLines: QrCaptionLine[] = [],
): Promise<Blob> {
	const qrCanvas = document.createElement('canvas');
	await QRCodeLib.toCanvas(qrCanvas, text, {
		width: PNG_QR_SIZE,
		margin: 2,
		errorCorrectionLevel: 'H',
	});

	const lines = captionLines.filter((line) => line.text);
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
		for (const line of lines) {
			ctx.font = `${line.emphasis ? '600 ' : ''}${CAPTION_FONT_SIZE}px system-ui, sans-serif`;
			ctx.fillText(fitText(ctx, line.text, maxWidth), canvas.width / 2, y);
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
