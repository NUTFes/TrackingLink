/**
 * Short codes: the identifier a printed QR code carries instead of a UUID.
 *
 * The scan URL used to be `/?id=<uuid>&p=<keyword>`. Measured against the
 * deployed host, at error-correction level H:
 *
 *   103 chars  57x57  /?id=550e8400-e29b-41d4-a716-446655440000&p=instagram
 *    74 chars  49x49  /?id=q7mfe3x&p=instagram
 *
 * Fewer modules means physically larger modules at the same printed size, which
 * is what decides whether a poster still reads from across a corridor or in bad
 * light. That is the whole reason this module exists — it buys nothing else.
 *
 * A short code does NOT replace QRCodes.id, and adding one must never change an
 * existing row's id: AccessLogs.qr_id is a foreign key into QRCodes(id) with ON
 * DELETE CASCADE, and the id is already baked into flyers that are on walls. The
 * scan endpoint resolves `id = ? OR short_code = ?` so both forms keep working
 * forever — see migrations/0004_add_qrcode_short_code.sql.
 *
 * Pure and dependency-free, so the alphabet and the length can be tested without
 * a database or a request context.
 */

/**
 * The 32 characters a short code may contain.
 *
 * The digits 0 and 1 and the letters l and o are omitted: during an event a code
 * gets read aloud and transcribed by hand, and 0/o and 1/l are the pairs people
 * get wrong. `i` stays — with both 1 and l gone there is nothing left for it to be
 * confused with — and dropping it as well would leave 31 characters, which is what
 * would actually hurt: the uniform bit-masking in generateShortCode depends on the
 * alphabet dividing 256 exactly.
 *
 * Lowercase only because SQLite compares TEXT case-sensitively by default. A
 * mixed-case code would make the printed URL case-sensitive, so `/?id=Q7mfe3x`
 * would 404 while `/?id=q7mfe3x` resolved — a failure nobody would suspect while
 * holding a correctly-printed poster.
 *
 * Every character here is an unreserved URL character, which is load-bearing
 * rather than incidental: the web app interpolates the code into the scan URL
 * raw, without encodeURIComponent (see qrTargetUrl in
 * packages/web/src/lib/qr.ts). A character needing percent-encoding would either
 * corrupt the URL or, once encoded, cost three characters of payload and push the
 * symbol back up a version — undoing the point of shortening it.
 */
export const SHORT_CODE_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

/**
 * 7 characters, i.e. 32^7 ≈ 3.4e10 possible codes.
 *
 * Chosen for the keyspace, not for the symbol: measured against the deployed
 * host, every length from 5 to 10 encodes to the same 49x49 symbol, so the 6th
 * and 7th characters are free in print terms. Spending them buys enough headroom
 * that the create path's collision retry should never fire at this app's scale,
 * while staying short enough to read aloud.
 */
export const SHORT_CODE_LENGTH = 7;

/**
 * How many codes to try before giving up on an insert.
 *
 * At 32^7 codes against a few thousand rows a single collision is already
 * implausible, so five in a row means the generator is broken rather than that we
 * were unlucky. Bounded rather than open-ended because retrying forever would
 * hold a request open instead of surfacing that.
 */
export const SHORT_CODE_ATTEMPTS = 5;

/**
 * Thrown when every attempt collided. Its own type so the caller can answer with
 * a specific code instead of a generic 500.
 */
export class ShortCodeExhaustedError extends Error {
	constructor(readonly attempts: number) {
		super(`could not mint a unique short code in ${attempts} attempts`);
		this.name = 'ShortCodeExhaustedError';
	}
}

/**
 * Runs `insert` with a fresh short code, retrying while `isCollision` says the
 * failure was this column's unique index.
 *
 * Insert-and-retry rather than "SELECT then insert": a check first would still
 * race two concurrent creates, so the unique index has to be the arbiter anyway,
 * and in the overwhelmingly common no-collision case this costs one write.
 *
 * Errors `isCollision` rejects are rethrown untouched — that is what keeps a
 * duplicate-name violation from being mistaken for a code collision and retried
 * five times before failing with the wrong message.
 *
 * Split out from the route so the retry can be tested without a database.
 */
export async function insertWithShortCode<T>(
	insert: (shortCode: string) => Promise<T>,
	isCollision: (error: unknown) => boolean,
	attempts = SHORT_CODE_ATTEMPTS,
): Promise<{ shortCode: string; result: T }> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		const shortCode = generateShortCode();
		try {
			return { shortCode, result: await insert(shortCode) };
		} catch (error) {
			if (!isCollision(error)) throw error;
		}
	}
	throw new ShortCodeExhaustedError(attempts);
}

/**
 * Mints a short code. Uniqueness is the database's job, not this function's —
 * callers insert against the unique index and retry on a collision.
 */
export function generateShortCode(): string {
	const bytes = new Uint8Array(SHORT_CODE_LENGTH);
	// getRandomValues, not Math.random: these end up printed and effectively
	// permanent, and Math.random is both biased and seedable across isolates.
	crypto.getRandomValues(bytes);

	let code = '';
	for (const byte of bytes) {
		// The alphabet is exactly 32 long and 256 is a whole multiple of 32, so
		// taking the low 5 bits is uniform. With any other alphabet size this would
		// silently over-represent the first few characters.
		code += SHORT_CODE_ALPHABET[byte & 31];
	}
	return code;
}
