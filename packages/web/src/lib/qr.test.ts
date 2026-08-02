import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
	QR_CAPTION_DEFAULTS,
	deriveFallbackKey,
	qrCaptionLines,
	qrFileName,
	qrSvgString,
	qrTargetUrl,
} from './qr';

/**
 * These two functions decide what gets physically printed. A mistake here is not
 * a bug you patch — it is a reprint.
 */

describe('deriveFallbackKey', () => {
	it('takes the first host label, dropping www.', () => {
		expect(
			deriveFallbackKey('https://www.instagram.com/nutfes_official/'),
		).toBe('instagram');
		expect(deriveFallbackKey('https://nutfes.net/')).toBe('nutfes');
	});

	it('handles multi-part suffixes without a public-suffix list', () => {
		expect(deriveFallbackKey('https://www.nutfes.ac.jp/')).toBe('nutfes');
		expect(deriveFallbackKey('https://example.co.jp/path')).toBe('example');
	});

	it('lowercases and narrows the host label to a plausible keyword', () => {
		// The API no longer restricts which characters a keyword may use — it checks
		// membership in FALLBACK_DESTINATIONS instead. This narrowing stays because
		// the output is only a *suggestion* matched against that list, and a
		// suggestion carrying the host's punctuation would never match an entry
		// anyone wrote by hand.
		expect(deriveFallbackKey('https://WWW.Insta_Gram.com/')).toBe('insta_gram');
		expect(deriveFallbackKey('https://my-shop.example.com/')).toBe('my-shop');
		expect(deriveFallbackKey('https://Insta!Gram.com/')).toBe('instagram');
	});

	// The X account is x.com/nut_fes: the handle carries the underscore, but the
	// key is derived from the host, so it comes out as plain "x".
	it('derives "x" for the X account', () => {
		expect(deriveFallbackKey('https://x.com/nut_fes')).toBe('x');
	});

	it('does not leave a leading hyphen or underscore', () => {
		// Cosmetic now rather than required: a suggestion starting with punctuation
		// reads like a mistake in the picker even though the API would accept it.
		expect(deriveFallbackKey('https://_foo.example.com/')).toBe('foo');
		expect(deriveFallbackKey('https://-foo.example.com/')).toBe('foo');
	});

	it('returns empty for anything unparseable rather than throwing', () => {
		// Called while the user is still typing a URL, so it sees partial input
		// constantly.
		for (const input of ['', 'not a url', 'https://', 'javascript:alert(1)']) {
			expect(deriveFallbackKey(input)).toBe('');
		}
	});

	it('caps the length to what the column accepts', () => {
		const long = `https://${'a'.repeat(80)}.com/`;
		expect(deriveFallbackKey(long).length).toBeLessThanOrEqual(40);
	});
});

describe('qrTargetUrl', () => {
	const UUID = '550e8400-e29b-41d4-a716-446655440000';

	it('includes the keyword when there is one', () => {
		expect(qrTargetUrl({ id: 'abc-123' }, 'instagram')).toMatch(
			/\/\?id=abc-123&p=instagram$/,
		);
	});

	it('omits &p= entirely when there is no keyword', () => {
		// A blank `&p=` is payload noise, and the Worker treats missing and blank
		// identically anyway.
		expect(qrTargetUrl({ id: 'abc-123' }, '')).toMatch(/\/\?id=abc-123$/);
		expect(qrTargetUrl({ id: 'abc-123' })).toMatch(/\/\?id=abc-123$/);
	});

	it('percent-encodes the keyword', () => {
		expect(qrTargetUrl({ id: 'abc' }, 'a b')).toContain('&p=a%20b');
	});

	// The reason the column exists: the short form is 74 characters and a 49x49
	// symbol, the UUID form 103 and 57x57.
	it('prefers the short code over the id', () => {
		expect(
			qrTargetUrl({ id: UUID, shortCode: 'q7mfe3x' }, 'instagram'),
		).toMatch(/\/\?id=q7mfe3x&p=instagram$/);
	});

	it('never puts the id in the URL when a short code is present', () => {
		const url = qrTargetUrl({ id: UUID, shortCode: 'q7mfe3x' }, 'instagram');
		expect(url).not.toContain(UUID);
	});

	it('falls back to the id when there is no short code', () => {
		// Deliberate, not dead code: the Worker resolves either form, so a long URL
		// still scans, whereas rendering nothing would produce an unusable poster.
		// Covers a response from an older API (absent), a row the backfill has not
		// reached (null), and a blank value.
		for (const qr of [
			{ id: UUID },
			{ id: UUID, shortCode: null },
			{ id: UUID, shortCode: '' },
		]) {
			expect(qrTargetUrl(qr, 'instagram')).toMatch(
				new RegExp(`/\\?id=${UUID}&p=instagram$`),
			);
		}
	});

	it('leaves a short code unencoded, so the printed URL is the short one', () => {
		// The alphabet in packages/api/src/short-code.ts is URL-safe precisely so this
		// interpolation can stay raw; percent-encoding here would add payload back.
		const url = qrTargetUrl({ id: UUID, shortCode: 'q7mfe3x' });
		expect(url).toContain('?id=q7mfe3x');
		expect(url).not.toContain('%');
	});
});

describe('qrCaptionLines', () => {
	const qr = { name: 'Poster A', medium: 'Poster', location: '1F' };

	it('prints nothing by default', () => {
		expect(QR_CAPTION_DEFAULTS).toEqual({
			includeName: false,
			includeMedium: false,
		});
		expect(qrCaptionLines(qr, QR_CAPTION_DEFAULTS)).toEqual([]);
	});

	it('prints only the name when only the name is selected', () => {
		expect(
			qrCaptionLines(qr, { includeName: true, includeMedium: false }),
		).toEqual([{ text: 'Poster A', emphasis: true }]);
	});

	it('carries the location along with the medium', () => {
		expect(
			qrCaptionLines(qr, { includeName: false, includeMedium: true }),
		).toEqual([{ text: 'Poster · 1F' }]);
	});

	// Emphasis follows the field, not the line's position — otherwise a
	// medium-only caption would print bold and read as a title.
	it('never emphasises the medium, even when it is the only line', () => {
		const [line] = qrCaptionLines(qr, {
			includeName: false,
			includeMedium: true,
		});
		expect(line?.emphasis).toBeUndefined();
	});

	it('puts the name first when both are selected', () => {
		expect(
			qrCaptionLines(qr, { includeName: true, includeMedium: true }),
		).toEqual([{ text: 'Poster A', emphasis: true }, { text: 'Poster · 1F' }]);
	});

	it('omits the separator when there is no location', () => {
		expect(
			qrCaptionLines(
				{ name: 'A', medium: 'Poster' },
				{ includeName: false, includeMedium: true },
			),
		).toEqual([{ text: 'Poster' }]);
	});

	// location is optional and may come back as null from the API.
	it('treats a null location as absent', () => {
		expect(
			qrCaptionLines(
				{ name: 'A', medium: 'Poster', location: null },
				{ includeName: false, includeMedium: true },
			),
		).toEqual([{ text: 'Poster' }]);
	});

	it('emits no line for a selected but empty field', () => {
		expect(
			qrCaptionLines(
				{ name: '', medium: '', location: '' },
				{ includeName: true, includeMedium: true },
			),
		).toEqual([]);
	});
});

describe('qrFileName', () => {
	it('is "<name>_QR.<format>"', () => {
		expect(qrFileName('造形大ポスター', 'png')).toBe('造形大ポスター_QR.png');
		expect(qrFileName('造形大ポスター', 'svg')).toBe('造形大ポスター_QR.svg');
	});

	// The medium and location were dropped from the filename on purpose.
	it('carries the name only', () => {
		expect(qrFileName('看板A', 'png')).toBe('看板A_QR.png');
	});

	it('collapses whitespace rather than leaving it in the path', () => {
		expect(qrFileName('造形大　ポスター', 'png')).toBe(
			'造形大_ポスター_QR.png',
		);
	});

	it('strips characters no filesystem accepts', () => {
		expect(qrFileName('a/b:c*d', 'svg')).toBe('abcd_QR.svg');
	});

	// name is required by the API, so this is defence rather than a real case —
	// but a leading underscore would look like a broken filename.
	it('does not leave a stray separator when the name is blank', () => {
		expect(qrFileName('', 'png')).toBe('QR.png');
		expect(qrFileName('///', 'svg')).toBe('QR.svg');
	});
});

/**
 * The SVG is assembled as a string rather than through the DOM, so the things that
 * can break it are structural: a caption containing `&`, a geometry that stops
 * matching the PNG, a QR that lands in the wrong place. All of that is checkable
 * without a canvas — which is the reason fitText tolerates a null context.
 */
describe('qrSvgString', () => {
	// Stubbed rather than left to jsdom: jsdom's own getContext returns null but
	// reports a "Not implemented" error to its virtual console on the way, which
	// lands in the test output looking like a failure. Stating it here also makes
	// the no-measurement branch a deliberate condition instead of a side effect —
	// captions therefore come out untruncated below, which is the documented
	// behaviour when text cannot be measured.
	beforeAll(() => {
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	});

	const URL_ = 'https://t.nutfes.net/?id=q7mfe3x&p=instagram';
	// QR_SIZE 640 + PADDING 32 on each side.
	const WIDTH = 704;
	// One caption line adds CAPTION_LINE_HEIGHT 34 + PADDING / 2.
	const CAPTION_BLOCK = 34 + 16;

	function attrs(svg: string): Record<string, string> {
		const open = svg.slice(0, svg.indexOf('>'));
		const found: Record<string, string> = {};
		for (const [, key, value] of open.matchAll(/([\w:-]+)="([^"]*)"/g)) {
			found[key] = value;
		}
		return found;
	}

	it('is a square page with no caption', async () => {
		const svg = await qrSvgString(URL_);
		expect(attrs(svg)).toMatchObject({
			xmlns: 'http://www.w3.org/2000/svg',
			width: String(WIDTH),
			height: String(WIDTH),
			viewBox: `0 0 ${WIDTH} ${WIDTH}`,
		});
		expect(svg).not.toContain('<text');
	});

	it('grows by one line height per caption line, matching the PNG layout', async () => {
		const one = await qrSvgString(URL_, [{ text: 'A' }]);
		const two = await qrSvgString(URL_, [{ text: 'A' }, { text: 'B' }]);
		expect(attrs(one).height).toBe(String(WIDTH + CAPTION_BLOCK));
		expect(attrs(two).height).toBe(String(WIDTH + CAPTION_BLOCK + 34));
		// The page never gets wider than the code plus its margins.
		expect(attrs(two).width).toBe(String(WIDTH));
	});

	it('ignores blank caption lines rather than leaving a gap', async () => {
		const svg = await qrSvgString(URL_, [{ text: '' }, { text: '' }]);
		expect(attrs(svg).height).toBe(String(WIDTH));
		expect(svg).not.toContain('<text');
	});

	// A transparent quiet zone prints as nothing and does not scan.
	it('paints the background white', async () => {
		expect(await qrSvgString(URL_)).toContain(
			`<rect width="${WIDTH}" height="${WIDTH}" fill="#ffffff"/>`,
		);
	});

	it('nests the code at the padding offset, keeping its own viewBox', async () => {
		const svg = await qrSvgString(URL_);
		const nested = svg.slice(svg.indexOf('<svg', 1));
		expect(attrs(nested)).toMatchObject({
			x: '32',
			y: '32',
			width: '640',
			height: '640',
			'shape-rendering': 'crispEdges',
		});
		expect(attrs(nested).viewBox).toMatch(/^0 0 \d+ \d+$/);
	});

	it('emphasises only the line that asked for it', async () => {
		const svg = await qrSvgString(URL_, [
			{ text: 'Poster A', emphasis: true },
			{ text: 'Poster · 1F' },
		]);
		const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];
		expect(texts.map((match) => match[1])).toEqual(['Poster A', 'Poster · 1F']);
		expect(texts[0]?.[0]).toContain('font-weight="600"');
		expect(texts[1]?.[0]).not.toContain('font-weight');
	});

	// Baselines are explicit numbers rather than dominant-baseline, which vector
	// editors interpret inconsistently — so the second line has to sit exactly one
	// line height below the first.
	it('spaces caption baselines by one line height', async () => {
		const svg = await qrSvgString(URL_, [{ text: 'A' }, { text: 'B' }]);
		const ys = [...svg.matchAll(/<text x="352" y="(\d+)"/g)].map((match) =>
			Number(match[1]),
		);
		expect(ys).toHaveLength(2);
		expect((ys[1] as number) - (ys[0] as number)).toBe(34);
	});

	it('escapes a caption that would otherwise break the document', async () => {
		const svg = await qrSvgString(URL_, [{ text: 'A & B <test>' }]);
		expect(svg).toContain('>A &amp; B &lt;test&gt;</text>');
		const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
		expect(parsed.querySelector('parsererror')).toBeNull();
	});

	it('parses as SVG for every caption count', async () => {
		for (const lines of [
			[],
			[{ text: '造形大ポスター', emphasis: true }],
			[{ text: '造形大ポスター', emphasis: true }, { text: 'ポスター · 1F' }],
		]) {
			const parsed = new DOMParser().parseFromString(
				await qrSvgString(URL_, lines),
				'image/svg+xml',
			);
			expect(parsed.querySelector('parsererror')).toBeNull();
			expect(parsed.documentElement.tagName).toBe('svg');
		}
	});
});
