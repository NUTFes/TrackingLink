// Generates SQL + a qrids manifest for the load tests.
//
// D1 constraints this works around (see docs/load-testing.md):
//  - ~100 bound parameters per query      -> emit literal values, no placeholders
//  - per-statement SQL size               -> 500 rows per INSERT
//  - BEGIN/COMMIT unsupported via the API -> no explicit transactions
//  - workerd falls over on a ~4MB file    -> split into small files (measured)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROWS_PER_STATEMENT = 500;
// Kept low on purpose: 500 rows x 92 statements in one file reproducibly failed
// with `kj/table.c++:57: HashIndex detected hash table inconsistency`.
const STATEMENTS_PER_FILE = 10;

const PROJECT_COUNT = 25; // > PAGE_SIZE, so pagination bugs are observable
const QR_PER_PROJECT = 10;

/** SQL string literal. */
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Realistic user agents. The same pool the bot classifier is asserted against —
 * note `Line/` (a real person in LINE's in-app browser) sitting right next to
 * `line-poker` (LINE's preview crawler), which is exactly the pair that must not
 * be conflated.
 */
const USER_AGENTS = [
	// people
	[
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
		0,
	],
	[
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
		0,
	],
	[
		'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/13.15.0',
		0,
	],
	[
		'Mozilla/5.0 (Linux; Android 13; SO-52C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 Line/14.2.1',
		0,
	],
	// crawlers
	['facebookexternalhit/1.1;line-poker/0.1', 1],
	['Twitterbot/1.0', 1],
	['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 1],
	['Discordbot/2.0; +https://discordapp.com', 1],
];

/** Deterministic PRNG, so a run is reproducible without Math.random. */
function makeRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

/**
 * Zipf-ish weights: one project takes ~60% of all scans and, within it, one QR
 * code takes ~30%. Uniform data flatters index selectivity and makes p95 look
 * better than it will be in the field.
 */
function weightedPick(random, items, weights) {
	const total = weights.reduce((sum, w) => sum + w, 0);
	let roll = random() * total;
	for (const [index, weight] of weights.entries()) {
		roll -= weight;
		if (roll <= 0) return items[index];
	}
	return items[items.length - 1];
}

function parseArgs(argv) {
	const args = { logs: 100_000, out: 'loadtest/.out', seed: 42 };
	for (const arg of argv) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		if (key === 'logs') args.logs = Number(value);
		else if (key === 'out') args.out = value;
		else if (key === 'seed') args.seed = Number(value);
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const random = makeRandom(args.seed);

rmSync(args.out, { recursive: true, force: true });
mkdirSync(args.out, { recursive: true });

const files = [];
const write = (name, sql) => {
	writeFileSync(join(args.out, name), `${sql}\n`);
	files.push(name);
};

// --- projects + QR codes -----------------------------------------------------
const projects = Array.from({ length: PROJECT_COUNT }, (_, i) => ({
	id: `lt-project-${String(i + 1).padStart(3, '0')}`,
	name: `負荷テスト企画${i + 1}`,
}));

const qrCodes = [];
for (const [projectIndex, project] of projects.entries()) {
	for (let i = 1; i <= QR_PER_PROJECT; i++) {
		qrCodes.push({
			id: `lt-qr-${String(projectIndex + 1).padStart(3, '0')}-${String(i).padStart(3, '0')}`,
			projectId: project.id,
			// Unique per project, matching idx_qrcodes_project_name.
			name: `ポスター${String(i).padStart(2, '0')}`,
			medium: i % 3 === 0 ? 'チラシ' : 'ポスター',
			// A third have no location, exercising the optional case.
			location: i % 3 === 0 ? '' : `${i}F掲示板`,
		});
	}
}

write(
	'000-cleanup.sql',
	[
		"DELETE FROM AccessLogs WHERE project_id LIKE 'lt-project-%';",
		"DELETE FROM QRCodes   WHERE project_id LIKE 'lt-project-%';",
		"DELETE FROM Projects  WHERE project_id LIKE 'lt-project-%';",
	].join('\n'),
);

write(
	'010-projects.sql',
	`INSERT INTO Projects (project_id, name, destination_url, created_at) VALUES\n${projects
		.map(
			(p, i) =>
				`(${q(p.id)}, ${q(p.name)}, ${q(`https://example.com/lt/${i + 1}`)}, ${q(
					`2026-07-${String((i % 20) + 1).padStart(2, '0')}T09:00:00.000Z`,
				)})`,
		)
		.join(',\n')};`,
);

write(
	'020-qrcodes.sql',
	`INSERT INTO QRCodes (id, project_id, name, medium, location, created_at) VALUES\n${qrCodes
		.map(
			(qr) =>
				`(${q(qr.id)}, ${q(qr.projectId)}, ${q(qr.name)}, ${q(qr.medium)}, ${q(
					qr.location,
				)}, ${q('2026-07-01T09:00:00.000Z')})`,
		)
		.join(',\n')};`,
);

// --- access logs -------------------------------------------------------------
// Project weights: first project dominates.
const projectWeights = projects.map((_, i) =>
	i === 0 ? 60 : 40 / (PROJECT_COUNT - 1),
);
// Within a project, the first QR code dominates.
const qrWeights = Array.from({ length: QR_PER_PROJECT }, (_, i) =>
	i === 0 ? 30 : 70 / (QR_PER_PROJECT - 1),
);

/**
 * Three days, with a diurnal curve plus one sharp 10-minute spike on day 2 —
 * standing in for a stage announcement. This is what the
 * (project_id, accessed_at) index range-scans.
 */
function randomTimestamp() {
	const day = 5 + Math.floor(random() * 3); // 2026-07-05..07
	if (day === 6 && random() < 0.15) {
		const second = Math.floor(random() * 600);
		const mm = String(Math.floor(second / 60)).padStart(2, '0');
		const ss = String(second % 60).padStart(2, '0');
		return `2026-07-06T12:${mm}:${ss}.000Z`;
	}
	// Weight the afternoon, when a festival is busy.
	const hour = 9 + Math.floor(random() ** 0.6 * 11);
	const minute = Math.floor(random() * 60);
	const second = Math.floor(random() * 60);
	const ms = Math.floor(random() * 1000);
	return `2026-07-0${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(ms).padStart(3, '0')}Z`;
}

const rows = [];
for (let i = 0; i < args.logs; i++) {
	const project = weightedPick(random, projects, projectWeights);
	const offset = weightedPick(
		random,
		Array.from({ length: QR_PER_PROJECT }, (_, k) => k),
		qrWeights,
	);
	const qr = qrCodes.find(
		(candidate) =>
			candidate.projectId === project.id &&
			candidate.name === `ポスター${String(offset + 1).padStart(2, '0')}`,
	);
	const [userAgent, isBot] =
		USER_AGENTS[Math.floor(random() * USER_AGENTS.length)];
	// Campus /16 plus carrier ranges, with repeats — real scans repeat per device.
	const ip =
		random() < 0.6
			? `10.42.${Math.floor(random() * 256)}.${Math.floor(random() * 254) + 1}`
			: `203.0.${Math.floor(random() * 100)}.${Math.floor(random() * 254) + 1}`;

	rows.push(
		`(${q(qr.id)}, ${q(project.id)}, ${q(randomTimestamp())}, ${q(userAgent)}, ${q(ip)}, ${isBot})`,
	);
}

const statements = [];
for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
	statements.push(
		`INSERT INTO AccessLogs (qr_id, project_id, accessed_at, user_agent, ip_address, is_bot) VALUES\n${rows
			.slice(i, i + ROWS_PER_STATEMENT)
			.join(',\n')};`,
	);
}
for (let i = 0; i < statements.length; i += STATEMENTS_PER_FILE) {
	const index = String(Math.floor(i / STATEMENTS_PER_FILE)).padStart(4, '0');
	write(
		`030-logs-${index}.sql`,
		statements.slice(i, i + STATEMENTS_PER_FILE).join('\n'),
	);
}

// --- manifest for k6 ---------------------------------------------------------
// Weight column so k6 can reproduce the same skew the data has, rather than
// hammering one id (which would make the isolate cache look far better than it is).
writeFileSync(
	join(args.out, 'qrids.json'),
	JSON.stringify(
		{
			projectIds: projects.map((p) => p.id),
			qrIds: qrCodes.map((qr) => qr.id),
			weightedQrIds: qrCodes.flatMap((qr) => {
				const projectIndex = projects.findIndex((p) => p.id === qr.projectId);
				const qrIndex = Number(qr.name.replace('ポスター', '')) - 1;
				const copies = Math.max(
					1,
					Math.round(projectWeights[projectIndex] * qrWeights[qrIndex] * 0.5),
				);
				return Array.from({ length: copies }, () => qr.id);
			}),
		},
		null,
		2,
	),
);

console.log(
	`seeded plan: ${projects.length} projects, ${qrCodes.length} QR codes, ${args.logs} access logs`,
);
console.log(`  ${files.length} SQL files + qrids.json in ${args.out}`);
console.log('  apply with: node loadtest/seed/run.mjs --target=local');
