/**
 * True only for http(s) URLs.
 *
 * Shared because two different places need exactly this guarantee and getting
 * either wrong is an open redirect:
 *
 *  - `destinationUrl` on a project. zod's `.string().url()` accepts `javascript:`,
 *    `data:`, `vbscript:` and `file:` (verified against zod 3.25), and that value
 *    is both 302-redirected to by the Worker and rendered as `<a href>` in the
 *    admin UI — whose origin holds the API token.
 *  - the fallback destinations in FALLBACK_DESTINATIONS / FALLBACK_URL. Those come
 *    from our own config rather than from a user, but a pasted `javascript:` in a
 *    var would be redirected to just the same, so it is checked too.
 */
export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}
