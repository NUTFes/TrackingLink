import { describe, expect, it } from 'vitest';
import { parseFallbackMap, resolveFallbackUrl } from './fallback';

/**
 * This is the code path that only runs when D1 is already broken, so it will never
 * be exercised by ordinary use — which is exactly why it is worth unit testing.
 * A mistake here stays invisible until the one moment it matters.
 */

const INSTAGRAM = 'https://www.instagram.com/nutfes_official/';
const SITE = 'https://www.nutfes.net/';

describe('parseFallbackMap', () => {
	it('reads a plain object', () => {
		expect(parseFallbackMap({ instagram: INSTAGRAM })).toEqual({
			instagram: INSTAGRAM,
		});
	});

	it('reads the same config given as a JSON string', () => {
		// wrangler.jsonc `vars` is JSON, so the value arrives as an object or a
		// string depending on how it was quoted. Both spellings must work.
		expect(parseFallbackMap(JSON.stringify({ instagram: INSTAGRAM }))).toEqual({
			instagram: INSTAGRAM,
		});
	});

	it('returns an empty map for anything unset or unusable, without throwing', () => {
		// Throwing here would turn a config typo into a 500 for every visitor — the
		// exact failure this module exists to prevent.
		for (const input of [
			undefined,
			null,
			'',
			'   ',
			'not json',
			42,
			[],
			true,
		]) {
			expect(parseFallbackMap(input)).toEqual({});
		}
	});

	it('drops entries whose URL is not http(s)', () => {
		const map = parseFallbackMap({
			evil: 'javascript:alert(1)',
			data: 'data:text/html,<script>x</script>',
			file: 'file:///etc/passwd',
			ok: INSTAGRAM,
		});
		expect(map).toEqual({ ok: INSTAGRAM });
	});

	it('drops non-string values and over-long keys', () => {
		const map = parseFallbackMap({
			nested: { url: INSTAGRAM },
			number: 1,
			['a'.repeat(41)]: INSTAGRAM,
			ok: INSTAGRAM,
		});
		expect(map).toEqual({ ok: INSTAGRAM });
	});
});

describe('resolveFallbackUrl', () => {
	const map = { instagram: INSTAGRAM };

	it('prefers the keyword entry', () => {
		expect(resolveFallbackUrl('instagram', map, SITE)).toEqual({
			url: INSTAGRAM,
			tier: 'keyword',
		});
	});

	it('falls back to the site-wide URL when the keyword is not configured', () => {
		expect(resolveFallbackUrl('shop', map, SITE)).toEqual({
			url: SITE,
			tier: 'static',
		});
	});

	it('falls back to the site-wide URL for a QR code printed before &p= existed', () => {
		expect(resolveFallbackUrl(undefined, map, SITE)).toEqual({
			url: SITE,
			tier: 'static',
		});
		expect(resolveFallbackUrl('', map, SITE)).toEqual({
			url: SITE,
			tier: 'static',
		});
	});

	it('returns null when nothing is configured, so the caller can answer 503', () => {
		expect(resolveFallbackUrl('instagram', {}, undefined)).toBeNull();
		expect(resolveFallbackUrl(undefined, {}, '')).toBeNull();
	});

	it('refuses a non-http(s) site-wide fallback rather than redirecting to it', () => {
		expect(resolveFallbackUrl('shop', map, 'javascript:alert(1)')).toBeNull();
	});

	it('refuses a non-http(s) keyword entry even in a hand-built map', () => {
		// parseFallbackMap already filters these out, so this only arises if a caller
		// builds the map itself. Validating here too means no caller can introduce a
		// redirect to another scheme, and the site-wide fallback still answers.
		expect(
			resolveFallbackUrl('evil', { evil: 'javascript:alert(1)' }, SITE),
		).toEqual({ url: SITE, tier: 'static' });
	});
});
