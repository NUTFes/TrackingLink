import { describe, expect, it } from 'vitest';
import { deriveFallbackKey, qrTargetUrl } from './qr';

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

	it('lowercases and strips characters the API would reject', () => {
		// The API accepts ^[a-z0-9][a-z0-9-]*$, so a suggestion that fails validation
		// would be a self-inflicted form error.
		expect(deriveFallbackKey('https://WWW.Insta_Gram.com/')).toBe('instagram');
		expect(deriveFallbackKey('https://my-shop.example.com/')).toBe('my-shop');
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
	it('includes the keyword when there is one', () => {
		expect(qrTargetUrl('abc-123', 'instagram')).toMatch(
			/\/\?id=abc-123&p=instagram$/,
		);
	});

	it('omits &p= entirely when there is no keyword', () => {
		// A blank `&p=` is payload noise, and the Worker treats missing and blank
		// identically anyway.
		expect(qrTargetUrl('abc-123', '')).toMatch(/\/\?id=abc-123$/);
		expect(qrTargetUrl('abc-123')).toMatch(/\/\?id=abc-123$/);
	});

	it('percent-encodes the keyword', () => {
		expect(qrTargetUrl('abc', 'a b')).toContain('&p=a%20b');
	});
});
