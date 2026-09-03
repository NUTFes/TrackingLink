// Deploys the Worker with the current commit baked in as GIT_SHA.
//
// Exists because `/healthz` reports `version: c.env.GIT_SHA ?? 'dev'`, and until
// this script there was nothing setting GIT_SHA — so production answered
// `{"ok":true,"version":"dev"}` forever and the health check could not tell you
// which commit was actually running. Knowing that is the entire point of putting
// a version in a liveness probe; see docs/load-test-report-2026-07-27.md §5.4.
//
// Why a Node script rather than `wrangler deploy --var GIT_SHA:$(git rev-parse ...)`
// in package.json: pnpm runs scripts through cmd.exe on Windows, where `$(...)`
// is not command substitution but a literal string. The var would have been set
// to the text "$(git rev-parse --short HEAD)" on exactly the machine this project
// is deployed from.
//
// Usage:
//   pnpm deploy                 (from packages/api)
//   pnpm deploy:api             (from the repository root)
//   pnpm deploy -- --dry-run    (extra arguments are passed through to wrangler)
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Windows needs `shell: true` to launch wrangler.CMD at all. Copied from
 * scripts/backfill-short-codes.mjs so both scripts fail the same way.
 */
const useShell = process.platform === 'win32';

// join() rather than a slash-separated literal: with shell:true the command runs
// through cmd.exe, which does not accept forward slashes as path separators and
// answers `'node_modules' is not recognized`.
const wranglerBin = join(
	'node_modules',
	'.bin',
	useShell ? 'wrangler.CMD' : 'wrangler',
);

function git(args) {
	const result = spawnSync('git', args, { encoding: 'utf8', shell: useShell });
	if (result.status !== 0) return null;
	return (result.stdout ?? '').trim();
}

/**
 * The identifier `/healthz` will report.
 *
 * `-dirty` is not decoration. This deploys from a laptop rather than from CI, so
 * shipping uncommitted work is normal and a bare SHA would be a claim the running
 * code equals that commit — which is the one thing you must not get wrong while
 * reading a health check during an incident.
 *
 * Returns null when git cannot answer (no git, no repository, no commits). The
 * deploy still goes ahead without the variable and `/healthz` falls back to
 * "dev", because refusing to deploy over a missing version label would be worse
 * than deploying with the label this project already had.
 */
function resolveVersion() {
	const sha = git(['rev-parse', '--short', 'HEAD']);
	if (!sha) return null;
	const status = git(['status', '--porcelain']);
	return status ? `${sha}-dirty` : sha;
}

const passthrough = process.argv.slice(2);
const version = resolveVersion();
const argv = ['deploy', '--minify'];

if (version) {
	argv.push('--var', `GIT_SHA:${version}`);
	console.log(`Deploying as GIT_SHA=${version}`);
} else {
	console.warn(
		'Could not determine the commit; deploying without GIT_SHA. /healthz will report "dev".',
	);
}

// `--var` merges with the `vars` block in wrangler.jsonc rather than replacing
// it, so FALLBACK_DESTINATIONS and friends survive. Verified with
// `wrangler deploy --dry-run`, which lists every binding it would upload.
argv.push(...passthrough);

const result = spawnSync(wranglerBin, argv, {
	stdio: 'inherit',
	shell: useShell,
});

process.exit(result.status ?? 1);
