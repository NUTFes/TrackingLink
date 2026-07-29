// Applies the generated SQL to a D1 database, one file at a time.
//
// All orchestration lives here rather than in npm-script shell chains: `&&`,
// `$(...)` and single-quoted JSON all break on Windows, which is where this is
// actually run.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
	const args = {
		target: 'local',
		out: 'loadtest/.out',
		logs: null,
		db: 'trackinglink-db',
	};
	for (const arg of argv) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		if (key in args) args[key] = value ?? true;
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.target !== 'local' && args.target !== 'remote') {
	console.error(`unknown --target=${args.target} (expected local or remote)`);
	process.exit(1);
}

if (args.target === 'remote') {
	console.error(
		[
			'Refusing to seed --target=remote.',
			'',
			'Bulk-seeding production burns the D1 daily write quota (and deleted rows',
			'count as writes too, so cleaning up costs the same again). Seed locally and',
			'create a handful of rows through the API for the production run — see',
			'docs/load-testing.md section 4.4.',
		].join('\n'),
	);
	process.exit(1);
}

if (!existsSync(args.out)) {
	console.error(`${args.out} not found — run generate.mjs first`);
	process.exit(1);
}

// Seeding while `wrangler dev` holds the local D1 reproducibly fails with a
// workerd HashIndex error, and the failure is confusing. Warn up front.
console.log(
	'NOTE: stop `wrangler dev` before seeding — workerd fails if it holds the DB.\n',
);

const files = readdirSync(args.out)
	.filter((name) => name.endsWith('.sql'))
	.sort();

const wrangler = process.platform === 'win32' ? 'wrangler.CMD' : 'wrangler';
const wranglerPath = join('node_modules', '.bin', wrangler);

let applied = 0;
for (const file of files) {
	process.stdout.write(`  ${file} … `);
	const result = spawnSync(
		wranglerPath,
		[
			'd1',
			'execute',
			args.db,
			`--${args.target}`,
			`--file=${join(args.out, file)}`,
		],
		{ encoding: 'utf8', shell: process.platform === 'win32' },
	);

	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	// Deliberately narrow. A bare /error/i also matches wrangler's own
	// "update to prevent critical errors" version notice, which made every run
	// look like a failure. `[ERROR]` is wrangler's actual failure marker, and the
	// HashIndex check catches the workerd crash that exits 0 with a broken DB.
	const failed =
		result.status !== 0 ||
		/\[ERROR\]/.test(output) ||
		/HashIndex detected/.test(output);
	if (failed) {
		console.log('FAILED');
		console.error(output.split('\n').slice(-15).join('\n'));
		console.error(
			`\nApplied ${applied}/${files.length} files. Fix the cause and re-run; 000-cleanup.sql makes a full re-run safe.`,
		);
		process.exit(1);
	}
	console.log('ok');
	applied++;
}

console.log(`\napplied ${applied} files to ${args.db} (${args.target})`);
