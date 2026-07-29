import { describe, expect, it } from 'vitest';
// The backfill script carries its own copy of the generator because plain `node`
// cannot import a .ts module. These tests are what stop the two from drifting.
import {
	SHORT_CODE_ALPHABET as SCRIPT_ALPHABET,
	SHORT_CODE_LENGTH as SCRIPT_LENGTH,
	generateShortCode as scriptGenerateShortCode,
} from '../scripts/backfill-short-codes.mjs';
import { isShortCodeCollision } from './routes/projects';
import {
	SHORT_CODE_ALPHABET,
	SHORT_CODE_ATTEMPTS,
	SHORT_CODE_LENGTH,
	ShortCodeExhaustedError,
	generateShortCode,
	insertWithShortCode,
} from './short-code';

/**
 * A short code ends up printed on paper and is then permanent. Every property
 * asserted here is one that, if broken, is only discovered after a print run:
 * a code that needs percent-encoding, a character that cannot be transcribed, or
 * a length that changes the symbol size.
 */

const SAMPLE_SIZE = 2000;
const samples = Array.from({ length: SAMPLE_SIZE }, () => generateShortCode());

describe('SHORT_CODE_ALPHABET', () => {
	it('is 32 characters, so the low 5 bits of a byte map onto it without bias', () => {
		expect(SHORT_CODE_ALPHABET).toHaveLength(32);
	});

	it('contains no duplicates', () => {
		expect(new Set(SHORT_CODE_ALPHABET).size).toBe(SHORT_CODE_ALPHABET.length);
	});

	it('omits the characters that get misread when a code is read aloud', () => {
		// 0/o and 1/l. Their absence is why the alphabet is 32 rather than 36 — which
		// is also what makes the bit-masking uniform, so this cannot be "fixed" by
		// dropping more characters.
		for (const char of ['0', '1', 'l', 'o']) {
			expect(SHORT_CODE_ALPHABET).not.toContain(char);
		}
	});

	it('keeps `i`, which would otherwise leave 31 characters', () => {
		// Pinned deliberately: `i` looks droppable alongside 1 and l, but removing it
		// breaks the `byte & 31` mapping and biases the generator. If `i` ever has to
		// go, the generator needs rejection sampling first.
		expect(SHORT_CODE_ALPHABET).toContain('i');
	});

	it('is lowercase only, so the printed URL is not case-sensitive', () => {
		// SQLite compares TEXT case-sensitively by default: with a mixed-case
		// alphabet, `/?id=Q7mfe3x` would 404 while `/?id=q7mfe3x` resolved.
		expect(SHORT_CODE_ALPHABET).toBe(SHORT_CODE_ALPHABET.toLowerCase());
	});
});

describe('generateShortCode', () => {
	it(`is ${SHORT_CODE_LENGTH} characters`, () => {
		for (const code of samples) expect(code).toHaveLength(SHORT_CODE_LENGTH);
	});

	it('uses only characters from the alphabet', () => {
		for (const code of samples) {
			for (const char of code) expect(SHORT_CODE_ALPHABET).toContain(char);
		}
	});

	it('needs no percent-encoding to sit in a URL', () => {
		// packages/web/src/lib/qr.ts interpolates the code into the scan URL raw —
		// only the fallback keyword is passed through encodeURIComponent. A code that
		// changed under encoding would produce a QR pointing at a URL that does not
		// resolve, discovered only after printing.
		for (const code of samples) {
			expect(encodeURIComponent(code)).toBe(code);
		}
	});

	it('round-trips through URL parsing unchanged', () => {
		// The end-to-end version of the check above: what the Worker reads out of
		// `?id=` must be exactly what was generated.
		for (const code of samples.slice(0, 200)) {
			const url = new URL(`https://example.com/?id=${code}&p=instagram`);
			expect(url.searchParams.get('id')).toBe(code);
		}
	});

	it('does not repeat itself', () => {
		// Not a uniqueness guarantee — that is the database's job — but 2000 codes
		// colliding would mean the generator is broken (e.g. a fixed seed).
		expect(new Set(samples).size).toBe(SAMPLE_SIZE);
	});

	it('reaches every character in the alphabet across enough samples', () => {
		// Catches an off-by-one in the bit masking, which would silently make part of
		// the alphabet unreachable and shrink the keyspace.
		const seen = new Set(samples.join(''));
		expect(seen.size).toBe(SHORT_CODE_ALPHABET.length);
	});
});

/** The two messages SQLite actually produces for QRCodes' two unique indexes. */
const SHORT_CODE_VIOLATION = new Error(
	'D1_ERROR: UNIQUE constraint failed: QRCodes.short_code: SQLITE_CONSTRAINT',
);
const NAME_VIOLATION = new Error(
	'D1_ERROR: UNIQUE constraint failed: QRCodes.project_id, QRCodes.name: SQLITE_CONSTRAINT',
);

describe('isShortCodeCollision', () => {
	it('recognises a short-code violation', () => {
		expect(isShortCodeCollision(SHORT_CODE_VIOLATION)).toBe(true);
	});

	it('does not mistake a duplicate name for a collision', () => {
		// The failure this guard exists to prevent: a name clash retried five times
		// and then reported as a short-code problem, leaving the user with no idea
		// that their chosen name was taken.
		expect(isShortCodeCollision(NAME_VIOLATION)).toBe(false);
	});

	it('ignores unrelated failures', () => {
		for (const error of [
			new Error('D1_ERROR: no such table: QRCodes'),
			new Error('NOT NULL constraint failed: QRCodes.name'),
			new Error('network error'),
			'a string',
			null,
			undefined,
		]) {
			expect(isShortCodeCollision(error)).toBe(false);
		}
	});
});

describe('insertWithShortCode', () => {
	it('passes a valid code to the insert and reports the one that stuck', async () => {
		const seen: string[] = [];
		const { shortCode, result } = await insertWithShortCode(async (code) => {
			seen.push(code);
			return `row:${code}`;
		}, isShortCodeCollision);
		expect(seen).toEqual([shortCode]);
		expect(result).toBe(`row:${shortCode}`);
		expect(shortCode).toHaveLength(SHORT_CODE_LENGTH);
	});

	it('retries with a *fresh* code after a collision', async () => {
		// Retrying with the same code would loop until the attempt budget ran out and
		// then fail, which is indistinguishable from a broken generator.
		const seen: string[] = [];
		const { shortCode } = await insertWithShortCode(async (code) => {
			seen.push(code);
			if (seen.length < 3) throw SHORT_CODE_VIOLATION;
			return 'ok';
		}, isShortCodeCollision);

		expect(seen).toHaveLength(3);
		expect(new Set(seen).size).toBe(3);
		expect(shortCode).toBe(seen[2]);
	});

	it(`gives up after ${SHORT_CODE_ATTEMPTS} attempts`, async () => {
		let calls = 0;
		await expect(
			insertWithShortCode(async () => {
				calls++;
				throw SHORT_CODE_VIOLATION;
			}, isShortCodeCollision),
		).rejects.toThrow(ShortCodeExhaustedError);
		expect(calls).toBe(SHORT_CODE_ATTEMPTS);
	});

	it('rethrows a duplicate name immediately instead of retrying it', async () => {
		// Retrying a name clash would waste four writes and then report the wrong
		// error to the user.
		let calls = 0;
		await expect(
			insertWithShortCode(async () => {
				calls++;
				throw NAME_VIOLATION;
			}, isShortCodeCollision),
		).rejects.toThrow(/QRCodes\.project_id/);
		expect(calls).toBe(1);
	});

	it('rethrows anything unrelated without retrying', async () => {
		let calls = 0;
		await expect(
			insertWithShortCode(async () => {
				calls++;
				throw new Error('D1_ERROR: database is locked');
			}, isShortCodeCollision),
		).rejects.toThrow('database is locked');
		expect(calls).toBe(1);
	});
});

describe('the backfill script generator', () => {
	// Backfilled and freshly-created codes have to be indistinguishable: they are
	// the same kind of identifier, printed the same way, and any difference would
	// mean the alphabet guarantees above hold for only some rows.
	it('shares the alphabet and length with src/short-code.ts', () => {
		expect(SCRIPT_ALPHABET).toBe(SHORT_CODE_ALPHABET);
		expect(SCRIPT_LENGTH).toBe(SHORT_CODE_LENGTH);
	});

	it('produces codes indistinguishable from the create path', () => {
		const pattern = new RegExp(
			`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`,
		);
		for (let i = 0; i < 500; i++) {
			expect(scriptGenerateShortCode()).toMatch(pattern);
		}
	});
});
