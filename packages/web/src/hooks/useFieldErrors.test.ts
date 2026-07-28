import { describe, expect, it } from 'vitest';
import { validateFallbackKey, validateHttpUrl } from './useFieldErrors';

/**
 * The fallback keyword is printed into QR codes, so the set of characters
 * accepted here has to match the API's exactly — a key the form accepts but the
 * API rejects is a save that fails after the user has already decided.
 */
describe('validateFallbackKey', () => {
	const ok = (value: string) => expect(validateFallbackKey(value)).toBeNull();
	const rejected = (value: string) =>
		expect(validateFallbackKey(value)).toBe('validation.fallbackKey');

	it('accepts underscores, which social handles need', () => {
		// The X account is x.com/nut_fes.
		ok('nut_fes');
		ok('a_b_c');
	});

	it('accepts the existing keywords', () => {
		ok('instagram');
		ok('web');
		ok('x');
		ok('my-shop');
		ok('a1');
	});

	// The character class must be written [a-z0-9_-] with the hyphen last.
	// [a-z0-9-_] parses `9-_` as a range spanning ':' through '_', which would
	// wave through uppercase and punctuation.
	it('still rejects everything outside the class', () => {
		for (const value of [
			'A',
			'Insta',
			'a b',
			'a.b',
			'a:b',
			'a@b',
			'a^b',
			'@',
		]) {
			rejected(value);
		}
	});

	it('requires an alphanumeric first character', () => {
		rejected('_leading');
		rejected('-leading');
		// Trailing is fine — only the first character is constrained.
		ok('trailing_');
		ok('trailing-');
	});

	it('rejects an empty value', () => {
		// The field is optional, but blank is handled by not validating at all;
		// reaching here with '' means a required-field rule was expected.
		rejected('');
	});

	it('rejects non-ASCII, which would inflate the printed QR', () => {
		rejected('インスタ');
	});
});

describe('validateHttpUrl', () => {
	it('accepts http and https', () => {
		expect(validateHttpUrl('https://x.com/nut_fes')).toBeNull();
		expect(validateHttpUrl('http://example.com')).toBeNull();
	});

	// zod's .url() accepts these, which is how they became a stored-XSS route.
	it('rejects other schemes', () => {
		for (const value of [
			'javascript:alert(1)',
			'data:text/html,<script>',
			'file:///etc/passwd',
			'not a url',
		]) {
			expect(validateHttpUrl(value)).not.toBeNull();
		}
	});
});
