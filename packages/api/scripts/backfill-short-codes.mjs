// Assigns a short code to every QRCodes row that does not have one yet.
//
// Pairs with migrations/0004_add_qrcode_short_code.sql. That migration adds
// short_code as a nullable column — it has to be nullable, because SQL alone
// cannot invent a value that satisfies the alphabet and the unique index — so
// every row that existed before it lands with no code. This script fills them in.
//
// It is not optional. The admin UI renders only the short URL, so a row left
// without a code falls back to the 36-character UUID form and prints the 57x57
// symbol that the whole change exists to avoid. Real, already-printed QR codes are
// affected: production held 13 rows when this was written, and a local
// development database typically holds a couple of hundred.
//
// Backfilling does NOT invalidate anything already in print. The scan endpoint
// resolves `id = ? OR short_code = ?`, so a poster carrying the UUID keeps
// working after its row gains a short code — the two are additional handles on
// the same row, and neither is ever reassigned.
//
// Why codes are generated here in JavaScript rather than in SQL: SQLite's
// randomblob()/hex() emits hex, which contains 0 and 1 — characters the alphabet
// deliberately omits so a code can be read aloud — and it has no way to react to
// a unique-index collision. Generating them here uses the same alphabet and the
// same bounded retry as the create path.
//
// Usage:
//   node scripts/backfill-short-codes.mjs --local
//   node scripts/backfill-short-codes.mjs --remote
//   node scripts/backfill-short-codes.mjs --local --dry-run
//
// Safe to run twice: it only ever touches rows WHERE short_code IS NULL, so a
// second run reports 0 updated and writes nothing.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Kept identical to SHORT_CODE_ALPHABET / SHORT_CODE_LENGTH in src/short-code.ts.
 *
 * Duplicated rather than imported because this file is run by plain `node`, which
 * cannot import a TypeScript module, and adding a build step for one 8-line
 * function would cost more than it saves. src/short-code.test.ts imports both and
 * asserts they agree, so the two cannot drift silently — if you change one, that
 * test fails.
 */
export const SHORT_CODE_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
export const SHORT_CODE_LENGTH = 7;

/** @returns {string} */
export function generateShortCode() {
	const bytes = new Uint8Array(SHORT_CODE_LENGTH);
	crypto.getRandomValues(bytes);
	let code = '';
	for (const byte of bytes) {
		// 256 is a whole multiple of 32, so the low 5 bits are uniform.
		code += SHORT_CODE_ALPHABET[byte & 31];
	}
	return code;
}

/** Matches SHORT_CODE_ATTEMPTS in src/routes/projects.ts. */
const ATTEMPTS_PER_ROW = 5;

const DB_NAME = 'trackinglink-db';

function parseArgs(argv) {
	const args = { target: '', db: DB_NAME, dryRun: false };
	for (const arg of argv) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		if (key === 'local' || key === 'remote') args.target = key;
		else if (key === 'dry-run') args.dryRun = true;
		else if (key === 'db') args.db = value ?? DB_NAME;
		else {
			console.error(`unknown argument: ${arg}`);
			process.exit(1);
		}
	}
	return args;
}

const wranglerBin = join(
	'node_modules',
	'.bin',
	process.platform === 'win32' ? 'wrangler.CMD' : 'wrangler',
);

/**
 * Windows needs `shell: true` to launch wrangler.CMD at all, and a shell splits
 * arguments on spaces — so `--command=SELECT id FROM QRCodes` arrives as ten
 * arguments and wrangler rejects it. Quoting has to be explicit here; the SQL
 * built below only ever uses single quotes, so wrapping in double quotes is safe.
 */
const useShell = process.platform === 'win32';

function quoteArg(arg) {
	if (!useShell || !/[\s"]/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Runs one `wrangler d1 execute` and returns its combined output.
 *
 * Failure detection copies loadtest/seed/run.mjs deliberately: a bare /error/i
 * also matches wrangler's own "update to prevent critical errors" version notice,
 * which makes every run look broken. `[ERROR]` is wrangler's actual marker.
 */
function d1(args, extra) {
	const argv = ['d1', 'execute', args.db, `--${args.target}`, ...extra];
	const result = spawnSync(wranglerBin, argv.map(quoteArg), {
		encoding: 'utf8',
		shell: useShell,
	});
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	if (result.status !== 0 || /\[ERROR\]/.test(output)) {
		throw new Error(`wrangler d1 execute failed:\n${output}`);
	}
	return output;
}

/**
 * Pulls the result rows out of `wrangler d1 execute --json` output.
 *
 * Wrangler prints a version banner and other chatter around the JSON, so the
 * payload is located rather than assumed to be the whole of stdout.
 */
function queryRows(args, sql) {
	const output = d1(args, [`--command=${sql}`, '--json']);
	const start = output.indexOf('[');
	const end = output.lastIndexOf(']');
	if (start === -1 || end <= start) {
		throw new Error(`could not find JSON in wrangler output:\n${output}`);
	}
	const parsed = JSON.parse(output.slice(start, end + 1));
	return parsed.flatMap((entry) => entry.results ?? []);
}

/** Doubles single quotes — ids are arbitrary TEXT, not necessarily UUIDs. */
function sqlQuote(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!args.target) {
		console.error(
			[
				'Specify --local or --remote.',
				'',
				'  node scripts/backfill-short-codes.mjs --local',
				'  node scripts/backfill-short-codes.mjs --remote',
			].join('\n'),
		);
		process.exit(1);
	}

	// Same hazard as the loadtest seeder: workerd holding the local database makes
	// writes fail in a confusing way.
	if (args.target === 'local') {
		console.log(
			'NOTE: stop `wrangler dev` first — workerd holds the local DB.\n',
		);
	}

	const pending = queryRows(
		args,
		'SELECT id FROM QRCodes WHERE short_code IS NULL ORDER BY id',
	);

	if (pending.length === 0) {
		console.log('Every QR code already has a short code — nothing to do.');
		return;
	}

	// Read the codes already in use so collisions are resolved before writing
	// rather than by absorbing a failed statement. The unique index remains the
	// real arbiter; this just makes a collision cost nothing.
	const taken = new Set(
		queryRows(
			args,
			'SELECT short_code FROM QRCodes WHERE short_code IS NOT NULL',
		).map((row) => row.short_code),
	);

	console.log(
		`${pending.length} QR code(s) without a short code; ${taken.size} code(s) already in use.`,
	);

	const updates = [];
	for (const row of pending) {
		let code = '';
		for (let attempt = 0; attempt < ATTEMPTS_PER_ROW; attempt++) {
			const candidate = generateShortCode();
			if (!taken.has(candidate)) {
				code = candidate;
				break;
			}
		}
		if (!code) {
			// Impossible at 32^7 codes against this many rows, so treat it as a broken
			// generator rather than bad luck and stop before writing anything.
			throw new Error(
				`could not find a free short code for ${row.id} in ${ATTEMPTS_PER_ROW} attempts; check generateShortCode.`,
			);
		}
		taken.add(code);
		// `AND short_code IS NULL` makes each statement individually idempotent, so
		// a partially-applied run can be repeated without overwriting a code that
		// has already been printed.
		updates.push(
			`UPDATE QRCodes SET short_code = ${sqlQuote(code)} WHERE id = ${sqlQuote(row.id)} AND short_code IS NULL;`,
		);
	}

	if (args.dryRun) {
		console.log(`\n--dry-run: would apply ${updates.length} update(s).`);
		for (const statement of updates.slice(0, 5)) console.log(`  ${statement}`);
		if (updates.length > 5) console.log(`  … ${updates.length - 5} more`);
		return;
	}

	// One wrangler invocation for the whole batch. Per-row invocations would be
	// correct but take minutes for a few hundred rows, since each spawn pays
	// wrangler's startup cost.
	const dir = mkdtempSync(join(tmpdir(), 'tl-shortcode-'));
	const sqlPath = join(dir, 'backfill.sql');
	try {
		writeFileSync(sqlPath, `${updates.join('\n')}\n`, 'utf8');
		d1(args, [`--file=${sqlPath}`]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	const [remaining] = queryRows(
		args,
		'SELECT COUNT(*) AS n FROM QRCodes WHERE short_code IS NULL',
	);
	const left = Number(remaining?.n ?? 0);

	console.log(
		`\nUpdated ${updates.length} row(s) in ${args.db} (${args.target}).`,
	);
	if (left > 0) {
		console.error(
			`${left} row(s) still have no short code — re-run this script; it only touches NULLs.`,
		);
		process.exit(1);
	}
	console.log('All QR codes now have a short code.');
}

// Importable for tests without running the backfill.
const invokedDirectly =
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
	main().catch((error) => {
		console.error(`\n${error.message}`);
		process.exit(1);
	});
}
