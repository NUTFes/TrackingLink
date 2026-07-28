// Creates a small, clearly-labelled test dataset in a *deployed* environment via
// the admin API, and writes the qrids manifest the k6 scenarios read.
//
// Why this exists: loadtest/.out/qrids.json is produced by generate.mjs from
// locally-seeded ids like `lt-qr-001-001`, which do not exist in production. A
// production run pointed at that manifest would measure nothing but 404s.
//
// Why the API rather than SQL: seeding production by executing SQL means opening
// a write path to the real database from a laptop. Going through the API uses the
// same code path real users do, needs only the admin password, and is trivially
// reversible — every object created here is deleted by `--cleanup`.
//
// Usage:
//   node loadtest/seed/seed-remote.mjs \
//     --base=https://trackinglink.<subdomain>.workers.dev \
//     --password=<ADMIN_PASSWORD> \
//     --projects=5 --qrs=10
//
//   node loadtest/seed/seed-remote.mjs --base=... --password=... --cleanup
//
// The password can also come from ADMIN_PASSWORD in the environment, which keeps
// it out of your shell history.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Every object created here carries this prefix so cleanup can find them and a
 * human reading the admin UI can tell at a glance that they are not real.
 */
const MARKER = '[loadtest]';

function parseArgs(argv) {
	const args = {
		base: '',
		password: process.env.ADMIN_PASSWORD ?? '',
		projects: 5,
		qrs: 10,
		out: 'loadtest/.out',
		cleanup: false,
	};
	for (const arg of argv) {
		const [rawKey, value] = arg.replace(/^--/, '').split('=');
		if (rawKey === 'cleanup') args.cleanup = true;
		else if (rawKey === 'projects' || rawKey === 'qrs')
			args[rawKey] = Number(value);
		else if (rawKey in args) args[rawKey] = value ?? '';
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.base || !args.password) {
	console.error(
		[
			'Missing --base or --password.',
			'',
			'  node loadtest/seed/seed-remote.mjs \\',
			'    --base=https://trackinglink.<subdomain>.workers.dev \\',
			'    --password=<ADMIN_PASSWORD>',
			'',
			'ADMIN_PASSWORD in the environment works too.',
		].join('\n'),
	);
	process.exit(1);
}

const base = args.base.replace(/\/$/, '');

/** Refuses to touch anything that is not clearly a loadtest object. */
function assertIsTestObject(name) {
	if (!name.startsWith(MARKER)) {
		throw new Error(
			`Refusing to act on "${name}" — it does not carry the ${MARKER} prefix. This guard is what stops a cleanup run from deleting real projects.`,
		);
	}
}

async function login() {
	const res = await fetch(`${base}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ password: args.password }),
	});
	if (!res.ok) {
		throw new Error(
			`Login failed (${res.status}). Check --base and --password.${res.status === 429 ? ' Rate limited — wait a minute.' : ''}`,
		);
	}
	return (await res.json()).token;
}

async function api(token, path, init = {}) {
	const res = await fetch(`${base}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...(init.headers ?? {}),
		},
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${body}`);
	}
	return res.status === 204 ? null : res.json();
}

/** Every loadtest project currently on the server. */
async function listTestProjects(token) {
	const found = [];
	for (let page = 1; ; page++) {
		const body = await api(token, `/projects?page=${page}&limit=50`);
		const rows = body.data ?? [];
		found.push(...rows.filter((p) => p.name.startsWith(MARKER)));
		if (rows.length < 50) break;
	}
	return found;
}

async function cleanup(token) {
	const projects = await listTestProjects(token);
	if (projects.length === 0) {
		console.log(`No ${MARKER} projects found — nothing to clean up.`);
		return;
	}
	console.log(`Deleting ${projects.length} ${MARKER} project(s)…`);
	for (const project of projects) {
		assertIsTestObject(project.name);
		// QR codes and access logs go with it via ON DELETE CASCADE.
		await api(token, `/projects/${project.projectId}`, { method: 'DELETE' });
		console.log(`  deleted ${project.name}`);
	}
	console.log(
		'\nNote: deleted rows still count against the D1 daily write quota — ' +
			'D1 bills rows written, not net change.',
	);
}

async function seed(token) {
	const existing = await listTestProjects(token);
	if (existing.length > 0) {
		console.error(
			`${existing.length} ${MARKER} project(s) already exist. Run with --cleanup first, or they will skew the results.`,
		);
		process.exit(1);
	}

	// Mirrors the local seed: one destination keyword per project, alternating, so
	// the fallback path is exercised by whichever ids the scenarios pick.
	const keywords = ['instagram', 'web'];
	const projects = [];
	const qrIds = [];

	for (let p = 1; p <= args.projects; p++) {
		const project = await api(token, '/projects', {
			method: 'POST',
			body: JSON.stringify({
				projectName: `${MARKER} 負荷テスト企画${p}`,
				// example.com is reserved by RFC 2606 — a redirect target that cannot
				// accidentally send load at anyone's real site.
				destinationUrl: `https://example.com/loadtest/${p}`,
				fallbackKey: keywords[(p - 1) % keywords.length],
			}),
		});
		projects.push(project.projectId);
		process.stdout.write(`  ${project.projectName ?? project.name ?? ''}`);

		for (let q = 1; q <= args.qrs; q++) {
			const qr = await api(token, `/projects/${project.projectId}/qrcodes`, {
				method: 'POST',
				body: JSON.stringify({
					name: `ポスター${String(q).padStart(2, '0')}`,
					medium: q % 3 === 0 ? 'チラシ' : 'ポスター',
					location: q % 3 === 0 ? '' : `${q}F掲示板`,
				}),
			});
			qrIds.push({ id: qr.id, projectIndex: p - 1 });
		}
		console.log(` — ${args.qrs} QR codes`);
	}

	// Same Zipf-ish skew as the local manifest: hammering one id would give the
	// Worker's in-isolate cache a hit rate it will never see in the field.
	const weighted = [];
	for (const { id, projectIndex } of qrIds) {
		const copies = projectIndex === 0 ? 12 : 2;
		for (let i = 0; i < copies; i++) weighted.push(id);
	}

	const manifestPath = join(args.out, 'qrids.json');
	mkdirSync(dirname(manifestPath), { recursive: true });

	// Keep the local manifest recoverable — overwriting it silently would break
	// the local scenarios with ids that only exist in production.
	let previous = null;
	try {
		previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch {
		/* nothing to preserve */
	}
	if (previous && !previous.remote) {
		writeFileSync(
			join(args.out, 'qrids.local.json'),
			JSON.stringify(previous, null, 2),
		);
		console.log('\n  saved the previous local manifest to qrids.local.json');
	}

	writeFileSync(
		manifestPath,
		JSON.stringify(
			{
				remote: true,
				base,
				generatedFor: MARKER,
				projectIds: projects,
				qrIds: qrIds.map((q) => q.id),
				weightedQrIds: weighted,
			},
			null,
			2,
		),
	);

	const created = args.projects * args.qrs + args.projects;
	console.log(
		[
			'',
			`Created ${args.projects} projects and ${args.projects * args.qrs} QR codes`,
			`(~${created} D1 writes of the 100,000/day budget).`,
			'',
			`Manifest written to ${manifestPath}.`,
			'',
			'Next:',
			`  BASE_URL=${base} k6 run loadtest/k6/scan-ramping-prod.js`,
			'',
			'Afterwards:',
			'  node loadtest/seed/seed-remote.mjs --base=... --password=... --cleanup',
		].join('\n'),
	);
}

const token = await login();
if (args.cleanup) {
	await cleanup(token);
} else {
	await seed(token);
}
