import { describe, expect, it } from 'vitest';
import {
	QR_CAPTION_DEFAULTS,
	deriveFallbackKey,
	qrCaptionLines,
	qrPngFileName,
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

describe('qrPngFileName', () => {
	it('is "<name>_QR.png"', () => {
		expect(qrPngFileName('造形大ポスター')).toBe('造形大ポスター_QR.png');
	});

	// The medium and location were dropped from the filename on purpose.
	it('carries the name only', () => {
		expect(qrPngFileName('看板A')).toBe('看板A_QR.png');
	});

	it('collapses whitespace rather than leaving it in the path', () => {
		expect(qrPngFileName('造形大　ポスター')).toBe('造形大_ポスター_QR.png');
	});

	it('strips characters no filesystem accepts', () => {
		expect(qrPngFileName('a/b:c*d')).toBe('abcd_QR.png');
	});

	// name is required by the API, so this is defence rather than a real case —
	// but a leading underscore would look like a broken filename.
	it('does not leave a stray separator when the name is blank', () => {
		expect(qrPngFileName('')).toBe('QR.png');
		expect(qrPngFileName('///')).toBe('QR.png');
	});
});
