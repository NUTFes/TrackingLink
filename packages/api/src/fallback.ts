import { isHttpUrl } from './url';

/**
 * Where to send a scan when D1 cannot be reached.
 *
 * The scan endpoint normally reads the destination URL out of the database on
 * every request. When that read throws — most plausibly because a Free-plan daily
 * quota ran out, which leaves the Worker serving traffic while every D1 call
 * fails — it used to fall through to the global error handler and answer with a
 * bare 500. Every printed poster would go dead simultaneously.
 *
 * QR codes therefore carry `&p=<keyword>`, and this module maps that keyword to a
 * URL taken purely from configuration, touching no database.
 *
 * Why a keyword instead of the destination URL itself: a URL that can be
 * recovered from the QR has to *be* in the QR, which costs roughly its own length
 * in payload. No cryptography avoids that — a hash is one-way so it cannot be
 * reversed whatever key the Worker holds, and authenticated encryption produces
 * ciphertext longer than the plaintext. Measured, that grew the symbol from 53x53
 * to 69x69 modules; a keyword costs 4 modules. It also means the parameter can
 * only ever select from a list the operator wrote, so no attacker-supplied
 * destination is reachable and no signature is needed.
 *
 * These functions are pure so the resolution order can be tested directly.
 */

/** Longest keyword accepted, matching the column and form limits. */
const MAX_KEY_LENGTH = 40;

export interface FallbackTarget {
	url: string;
	/** Which tier answered — surfaced in logs to show how degraded the response was. */
	tier: 'keyword' | 'static';
}

/**
 * Reads the FALLBACK_DESTINATIONS var into a keyword → URL map.
 *
 * Accepts an object as well as a JSON string, for the same reason
 * `isFlagEnabled` accepts a boolean: `vars` in wrangler.jsonc is JSON, so whether
 * the value ends up a string or an object depends on how it was quoted, and a
 * strict reader would silently ignore one of the two spellings.
 *
 * Entries that are not usable are dropped rather than throwing, because throwing
 * here would turn a config typo into a 500 for every visitor — the exact failure
 * this module exists to prevent. A dropped entry behaves like a missing one, and
 * the caller's `scan_fallback_not_configured` log surfaces it.
 */
export function parseFallbackMap(raw: unknown): Record<string, string> {
	let source: unknown = raw;

	if (typeof source === 'string') {
		const trimmed = source.trim();
		if (!trimmed) return {};
		try {
			source = JSON.parse(trimmed);
		} catch {
			return {};
		}
	}

	if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

	const map: Record<string, string> = {};
	for (const [key, value] of Object.entries(
		source as Record<string, unknown>,
	)) {
		if (!key || key.length > MAX_KEY_LENGTH) continue;
		if (typeof value !== 'string') continue;
		// A `javascript:` entry in a var would be redirected to just like any other.
		if (!isHttpUrl(value)) continue;
		map[key] = value;
	}
	return map;
}

/**
 * Picks a destination: the keyword's own entry, then the site-wide fallback.
 *
 * Returns null when neither is configured, which the caller turns into a 503 with
 * an explanation rather than a redirect to nowhere.
 */
export function resolveFallbackUrl(
	key: string | undefined,
	map: Record<string, string>,
	staticFallback: string | undefined,
): FallbackTarget | null {
	if (key) {
		const forKeyword = map[key];
		// Re-checked even though parseFallbackMap already filters: validating at both
		// layers costs one call and means no caller — including a future one building
		// the map by hand — can introduce a redirect to a non-http(s) scheme.
		if (forKeyword && isHttpUrl(forKeyword)) {
			return { url: forKeyword, tier: 'keyword' };
		}
	}

	// Covers QR codes printed before `&p=` existed, keywords missing from the
	// config, and entries dropped for being unusable.
	if (staticFallback && isHttpUrl(staticFallback)) {
		return { url: staticFallback, tier: 'static' };
	}

	return null;
}
