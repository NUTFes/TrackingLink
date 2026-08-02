import { describe, expect, it } from 'vitest';
import { validateFallbackKey, validateHttpUrl } from './useFieldErrors';

/**
 * The rule has to match the API's exactly — a keyword the form accepts but the
 * API rejects is a save that fails after the user has already decided. What the
 * API checks is membership of FALLBACK_DESTINATIONS, not the characters used: a
 * well-formed keyword the Worker was never told about resolves to nothing on the
 * one day the fallback matters.
 */
describe('validateFallbackKey', () => {
	// Mirrors wrangler.jsonc, plus a Japanese keyword — configured is configured,
	// and the old character-set rule would have refused this one outright.
	const configured = ['instagram', 'web', 'x', 'nut_fes', 'インスタ'];

	const ok = (
		value: string,
		options?: Parameters<typeof validateFallbackKey>[2],
	) => expect(validateFallbackKey(value, configured, options)).toBeNull();
	const rejected = (
		value: string,
		options?: Parameters<typeof validateFallbackKey>[2],
	) =>
		expect(validateFallbackKey(value, configured, options)).toBe(
			'validation.fallbackKey',
		);

	it('accepts a keyword that is in the configuration', () => {
		ok('instagram');
		ok('web');
		// The X account is x.com/nut_fes, so underscores still have to pass.
		ok('nut_fes');
		ok('インスタ');
	});

	it('rejects a keyword that is not in the configuration', () => {
		// Every one of these would have passed the old character-set rule and then
		// silently done nothing during an outage.
		rejected('my-shop');
		rejected('a1');
		rejected('insta');
	});

	it('accepts an empty value, which means the site-wide fallback', () => {
		ok('');
	});

	it('skips the check when the list could not be loaded', () => {
		// The field degrades to free text in that state, so there is nothing to
		// compare against; the server is the real gate.
		ok('anything-at-all', { listUnavailable: true });
		ok('インスタ', { listUnavailable: true });
	});

	it('accepts an unchanged stored keyword that is no longer configured', () => {
		// It is already printed on posters, and refusing it would block an edit to an
		// unrelated field on that project.
		ok('gone', { storedKey: 'gone' });
	});

	it('rejects changing an orphaned keyword to another unconfigured one', () => {
		rejected('also-gone', { storedKey: 'gone' });
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
