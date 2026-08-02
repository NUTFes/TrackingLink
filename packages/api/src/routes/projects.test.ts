import { describe, expect, it } from 'vitest';
import { parseFallbackMap } from '../fallback';
import {
	createProjectBodySchema,
	isFallbackKeyAllowed,
	updateProjectBodySchema,
} from './projects';

/**
 * What a project body has to satisfy before it reaches D1.
 *
 * The handlers themselves need real D1 and a request context, so they are
 * exercised through `wrangler dev --local`. These two pieces are pure, and they
 * are the pair that is easy to get wrong in opposite directions: the schema used
 * to enforce a character set that said nothing about whether a keyword actually
 * resolves, and the membership check has to stay lenient enough that a keyword
 * already printed on posters can still be saved after someone removes it from the
 * configuration.
 */

// Includes a Japanese keyword, which the old character-set rule refused outright,
// and the underscore handle the X account uses.
const CONFIGURED = parseFallbackMap({
	instagram: 'https://www.instagram.com/nutfes',
	web: 'https://www.nutfes.net/',
	nut_fes: 'https://x.com/nut_fes',
	インスタ: 'https://www.instagram.com/nutfes',
});

const VALID_BODY = {
	projectName: '造形大祭2026',
	destinationUrl: 'https://www.nutfes.net/',
};

/** Mirrors the create handler: parse the body, then check the keyword. */
function createAccepts(fallbackKey?: string): boolean {
	const parsed = createProjectBodySchema.safeParse({
		...VALID_BODY,
		...(fallbackKey === undefined ? {} : { fallbackKey }),
	});
	if (!parsed.success) return false;
	return isFallbackKeyAllowed(parsed.data.fallbackKey ?? '', CONFIGURED);
}

/** Mirrors the update handler, including the stored value it compares against. */
function updateAccepts(fallbackKey: string, stored: string): boolean {
	const parsed = updateProjectBodySchema.safeParse({ fallbackKey });
	if (!parsed.success) return false;
	return isFallbackKeyAllowed(
		parsed.data.fallbackKey ?? '',
		CONFIGURED,
		stored,
	);
}

describe('project fallbackKey validation', () => {
	it('accepts a keyword that is in the configuration', () => {
		expect(createAccepts('instagram')).toBe(true);
		expect(createAccepts('nut_fes')).toBe(true);
	});

	it('accepts a blank keyword, which means the site-wide static fallback', () => {
		expect(createAccepts('')).toBe(true);
		// Omitted entirely is the same thing: the write path stores ''.
		expect(createAccepts(undefined)).toBe(true);
	});

	it('rejects a keyword that is not in the configuration', () => {
		// Character-set-legal and completely inert: it would resolve to nothing on
		// the one day the fallback is needed.
		expect(createAccepts('not-configured')).toBe(false);
	});

	it('accepts a non-ASCII keyword once it is configured', () => {
		// This is the behaviour change. The old rule rejected it on principle; what
		// matters is that FALLBACK_DESTINATIONS has an entry for it. The cost of a
		// keyword like this to the printed symbol is now the config author's call —
		// see the note in wrangler.jsonc.
		expect(createAccepts('インスタ')).toBe(true);
	});

	it('still rejects a keyword longer than the column allows', () => {
		// The one rule that stayed in the schema, because it bounds the row and the
		// printed payload rather than describing what a keyword means.
		const tooLong = createProjectBodySchema.safeParse({
			...VALID_BODY,
			fallbackKey: 'a'.repeat(41),
		});
		expect(tooLong.success).toBe(false);
		const atLimit = createProjectBodySchema.safeParse({
			...VALID_BODY,
			fallbackKey: 'a'.repeat(40),
		});
		expect(atLimit.success).toBe(true);
	});

	it('accepts an unchanged stored keyword that is no longer configured', () => {
		// The regression this exemption exists for: the keyword is already printed on
		// posters, so an edit to the project name must not be refused because of a
		// field the user never touched.
		expect(updateAccepts('gone', 'gone')).toBe(true);
	});

	it('rejects changing an orphaned keyword to another unconfigured one', () => {
		expect(updateAccepts('also-gone', 'gone')).toBe(false);
	});

	it('lets an orphaned keyword be cleared or moved to a configured one', () => {
		expect(updateAccepts('', 'gone')).toBe(true);
		expect(updateAccepts('web', 'gone')).toBe(true);
	});

	it('does not treat prototype property names as configured', () => {
		// `'constructor' in map` is true for any object literal, which would wave
		// through a keyword resolving to nothing.
		expect(isFallbackKeyAllowed('constructor', CONFIGURED)).toBe(false);
		expect(isFallbackKeyAllowed('toString', CONFIGURED)).toBe(false);
	});
});
