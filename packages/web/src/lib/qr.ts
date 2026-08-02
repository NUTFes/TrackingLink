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
	return (
		label
			.toLowerCase()
			// Keep exactly the characters the API accepts, so a suggestion can never
			// fail the form's own validation. Hyphen last in the class: `[^a-z0-9-_]`
			// would read `9-_` as a range.
			.replace(/[^a-z0-9_-]/g, '')
			// The rule requires an alphanumeric first character.
			.replace(/^[-_]+/, '')
			.slice(0, FALLBACK_KEY_MAX)
	);
}

/**
 * The identifiers a scan URL can be built from — the subset of a QR code record
 * that qrTargetUrl needs.
 */
export interface QrLinkIdentity {
	id: string;
	/**
	 * Preferred in the printed URL. Optional because a response from an API older
	 * than the short-code column omits it entirely, and null on a row the backfill
	 * has not reached.
	 */
	shortCode?: string | null;
}

/**
 * The URL baked into a printed QR code.
 *
 * Built from the short code rather than the id: `/?id=q7mfe3x&p=instagram` is 74
 * characters and encodes as a 49x49 symbol, against 103 characters and 57x57 for
 * the UUID. Bigger modules at the same printed size is the difference between a
 * poster that scans from across a corridor and one that does not.
 *
 * `&p=<fallbackKey>` is what lets a scan still reach somewhere sensible when the
 * Worker cannot read D1 — see packages/api/src/fallback.ts for why this is a
 * keyword rather than the destination URL itself.
 *
 * Extracted from the dialog because it is the one string that, if wrong, produces
 * posters that have to be reprinted — and because a future bulk-print view needs
 * exactly this and nothing else from the dialog.
 */
export function qrTargetUrl(qr: QrLinkIdentity, fallbackKey = ''): string {
	// Falling back to the UUID is not dead code, even though the backfill leaves
	// every row with a short code: the Worker resolves either form, so a long URL
	// still scans correctly, whereas rendering no URL at all would produce a blank
	// QR image and a poster nobody can use. A briefly-larger symbol is the far
	// cheaper failure. Empty string is treated as absent along with null.
	const base = `${FWD_BASE_URL}/?id=${qr.shortCode || qr.id}`;
	// Omitted rather than sent empty: `&p=` with no value is noise in the payload
	// and the Worker treats a missing key and a blank one identically.
	return fallbackKey ? `${base}&p=${encodeURIComponent(fallbackKey)}` : base;
}

/** The formats a QR code can be downloaded as. */
export type QrImageFormat = 'png' | 'svg';

/**
 * Filename for a downloaded QR code: `<name>_QR.<format>`.
 *
 * Only the name goes in. The medium and location were in here as well, which
 * buried the one part anyone actually scans a folder for behind two fields that
 * repeat across most codes.
 *
 * Extracted rather than inlined for the same reason as qrTargetUrl: a bulk-print
 * view will need exactly this, and the two must not drift.
 */
export function qrFileName(name: string, format: QrImageFormat): string {
	// 'QR' is passed as a part rather than appended, so the separator collapsing
	// in slugForFilename applies to it too — a blank name gives "QR.png", not
	// "_QR.png".
	return `${slugForFilename(name, 'QR')}.${format}`;
}

/** On-screen preview. */
export function qrPreviewDataUrl(text: string): Promise<string> {
	return QRCodeLib.toDataURL(text, {
		width: 300,
		margin: 2,
		errorCorrectionLevel: 'H',
	});
}

/**
 * Geometry shared by both download formats — deliberately not prefixed per
 * format. The PNG and the SVG have to come out at the same size with the same
 * margins, or "the same image in another format" stops being true and swapping
 * one for the other in a poster file means redoing the placement.
 */
const QR_SIZE = 640;
const PADDING = 32;
const CAPTION_LINE_HEIGHT = 34;
const CAPTION_FONT_SIZE = 24;
/**
 * Font stack for the caption. Only the SVG needs it spelled out — a data file is
 * opened somewhere other than a browser, so the chain has to name real fonts
 * rather than rely on `system-ui` resolving.
 */
const CAPTION_FONT_FAMILY =
	"system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif";
/**
 * Top edge of a caption line to its baseline, ~0.8em at the sizes used here. The
 * canvas path sets textBaseline='top' and has no need for it; the SVG path
 * positions text on the alphabetic baseline and does — see qrSvgString.
 */
const CAPTION_BASELINE_OFFSET = Math.round(CAPTION_FONT_SIZE * 0.8);

/**
 * The single place either format's page size is decided.
 *
 * `qrSize` is passed in rather than assumed to equal QR_SIZE so the margin comes
 * out at exactly PADDING on all four sides of whatever the renderer actually
 * produced — the canvas renderer floors its own dimensions internally.
 */
function qrImageLayout(qrSize: number, lineCount: number) {
	const width = qrSize + PADDING * 2;
	return {
		width,
		height:
			qrSize +
			PADDING * 2 +
			(lineCount ? lineCount * CAPTION_LINE_HEIGHT + PADDING / 2 : 0),
		/** Top edge of the first caption line. */
		captionTop: qrSize + PADDING + PADDING / 2,
		/** A caption line wider than this gets an ellipsis. */
		maxTextWidth: width - PADDING * 2,
	};
}

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

/** Font shorthand for a caption line, shared by the measuring and canvas paths. */
function captionFont(emphasis: boolean | undefined): string {
	return `${emphasis ? '600 ' : ''}${CAPTION_FONT_SIZE}px ${CAPTION_FONT_FAMILY}`;
}

/**
 * A context kept solely for measureText.
 *
 * The SVG path has no canvas of its own but still needs text widths to decide
 * where to truncate, and it has to agree with the PNG path or the two formats
 * truncate at different points. Null where no 2D context exists (jsdom, which
 * implements none) — an untruncated caption is a far better failure than no SVG at
 * all, and it is what makes qrSvgString unit-testable.
 *
 * Resolved once: whether a context is obtainable cannot change during a session,
 * and a fresh canvas per caption line is pure waste.
 */
let cachedMeasureContext: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
	if (cachedMeasureContext === undefined) {
		try {
			cachedMeasureContext = document.createElement('canvas').getContext('2d');
		} catch {
			cachedMeasureContext = null;
		}
	}
	return cachedMeasureContext;
}

/** Shortens a caption line to fit the image width, with an ellipsis. */
function fitText(
	ctx: CanvasRenderingContext2D | null,
	text: string,
	maxWidth: number,
): string {
	// No way to measure means no way to know where to cut. See measureContext.
	if (!ctx) return text;
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
		width: QR_SIZE,
		margin: 2,
		errorCorrectionLevel: 'H',
	});

	const lines = captionLines.filter((line) => line.text);
	const layout = qrImageLayout(qrCanvas.width, lines.length);
	const canvas = document.createElement('canvas');
	canvas.width = layout.width;
	canvas.height = layout.height;

	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');

	// Explicit white fill: a transparent PNG prints as nothing useful, and QR
	// scanners need the quiet zone to actually be light.
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(qrCanvas, PADDING, PADDING);

	if (lines.length) {
		ctx.fillStyle = '#000000';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		let y = layout.captionTop;
		for (const line of lines) {
			ctx.font = captionFont(line.emphasis);
			ctx.fillText(
				fitText(ctx, line.text, layout.maxTextWidth),
				canvas.width / 2,
				y,
			);
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

/** Escapes a caption for an SVG text node. A name may legitimately contain `&`. */
function escapeXmlText(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Renders a QR code to an SVG document, laid out identically to qrPngBlob.
 *
 * The point of the vector form is print: a 640px PNG placed on an A1 poster is
 * enlarged past its resolution, and softened module edges cost real scan
 * reliability at distance. This output stays sharp at any size and drops straight
 * into Illustrator or Inkscape.
 *
 * The caption is emitted as live <text>, which makes it editable in a vector
 * editor but leaves its glyphs to whatever font that machine resolves from
 * CAPTION_FONT_FAMILY. Only the caption is affected; the code itself is paths.
 */
export async function qrSvgString(
	text: string,
	captionLines: QrCaptionLine[] = [],
): Promise<string> {
	// The library hands back a complete <svg> element — xmlns, viewBox in module
	// units, shape-rendering="crispEdges", and width/height equal to QR_SIZE
	// verbatim. Nesting that element and giving it an x/y is valid SVG 1.1 and
	// understood by browsers and vector editors alike, so this rides on the
	// library's own path generation instead of re-deriving modules into <rect>s.
	const qrSvg = (
		await QRCodeLib.toString(text, {
			type: 'svg',
			width: QR_SIZE,
			margin: 2,
			errorCorrectionLevel: 'H',
		})
	).trim();

	const lines = captionLines.filter((line) => line.text);
	const layout = qrImageLayout(QR_SIZE, lines.length);
	const ctx = measureContext();

	const caption = lines.map((line, index) => {
		if (ctx) ctx.font = captionFont(line.emphasis);
		// Positioned on the default alphabetic baseline rather than with
		// dominant-baseline="text-before-edge", which browsers honour but vector
		// editors interpret inconsistently. An explicit number renders the same
		// everywhere.
		const y =
			layout.captionTop + CAPTION_BASELINE_OFFSET + index * CAPTION_LINE_HEIGHT;
		const weight = line.emphasis ? ' font-weight="600"' : '';
		return (
			`<text x="${layout.width / 2}" y="${y}" text-anchor="middle" ` +
			`font-family="${CAPTION_FONT_FAMILY}" font-size="${CAPTION_FONT_SIZE}"${weight} ` +
			`fill="#000000">${escapeXmlText(fitText(ctx, line.text, layout.maxTextWidth))}</text>`
		);
	});

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
		// Same reason as the canvas fill above: the quiet zone has to actually be
		// light, and a transparent SVG prints as nothing.
		`<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`,
		qrSvg.replace('<svg ', `<svg x="${PADDING}" y="${PADDING}" `),
		...caption,
		'</svg>',
	].join('\n');
}

/** The downloadable file for either format, ready for downloadBlob. */
export async function qrImageBlob(
	format: QrImageFormat,
	text: string,
	captionLines: QrCaptionLine[] = [],
): Promise<Blob> {
	if (format === 'png') return qrPngBlob(text, captionLines);
	// charset is spelled out because captions are routinely Japanese and a
	// consumer that guesses latin-1 renders them as mojibake.
	return new Blob([await qrSvgString(text, captionLines)], {
		type: 'image/svg+xml;charset=utf-8',
	});
}
