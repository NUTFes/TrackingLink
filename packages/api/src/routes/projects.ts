import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	gte,
	inArray,
	lt,
	lte,
	or,
} from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import * as z from 'zod';
import type { HonoEnv } from '../auth';
import { getDb, schema } from '../db';
import { ErrorCodes, fail } from '../errors';
import { parseFallbackMap } from '../fallback';
import { logEvent } from '../log';
import { Permissions, hasPermission } from '../permissions';
import { ShortCodeExhaustedError, insertWithShortCode } from '../short-code';

// Length caps keep a single row (and therefore the database, and the CSV export)
// bounded. Without them a 10k-character name is accepted and then wrecks every
// table that renders it.
const NAME_MAX = 200;
const URL_MAX = 2048;

// z.string().url() accepts *any* parseable URL, including `javascript:`,
// `data:`, `vbscript:` and `file:` (verified against zod 3.25). That value is
// then 302-redirected to by the Worker and rendered as `<a href>` in the admin
// UI, which makes it a stored-XSS / open-redirect vector reachable by anyone who
// can create or edit a project — and the admin session holds the API token.
const httpUrl = z
	.string()
	.url()
	.max(URL_MAX)
	.refine((value) => {
		try {
			const { protocol } = new URL(value);
			return protocol === 'http:' || protocol === 'https:';
		} catch {
			return false;
		}
	}, 'Only http(s) URLs are allowed');

/**
 * Keyword baked into this project's QR codes as `&p=<key>`, resolved against the
 * FALLBACK_DESTINATIONS var when D1 is unreachable (see src/fallback.ts).
 *
 * ASCII-only on purpose: a Japanese keyword is percent-encoded at 9 characters per
 * character, which grows the printed symbol from 57x57 to 61x61 modules. Optional
 * — '' means the admin UI derives one from the destination host instead.
 */
const FALLBACK_KEY_MAX = 40;
const fallbackKey = z
	.string()
	.max(FALLBACK_KEY_MAX)
	.regex(
		// Underscore is allowed because social handles use it — the X account is
		// x.com/nut_fes — and it costs nothing to carry: `_` is unreserved in RFC
		// 3986, so encodeURIComponent leaves it alone, and the QR payload is
		// already in byte mode (lowercase letters are absent from QR's
		// alphanumeric set), so it is the same 8 bits as any other character.
		// Hyphen stays last in the class: `[a-z0-9-_]` would read `9-_` as a range
		// and quietly admit uppercase and punctuation.
		/^$|^[a-z0-9][a-z0-9_-]*$/,
		'Use lowercase letters, digits, hyphens and underscores only',
	);

const createProjectBodySchema = z.object({
	projectName: z.string().min(1, 'Project name is required').max(NAME_MAX),
	destinationUrl: httpUrl,
	fallbackKey: fallbackKey.optional(),
});

const updateProjectBodySchema = z.object({
	projectName: z.string().min(1).max(NAME_MAX).optional(),
	destinationUrl: httpUrl.optional(),
	fallbackKey: fallbackKey.optional(),
});

const createQRCodeBodySchema = z.object({
	projectId: z.string().min(1, 'projectId is required'),
	name: z.string().min(1, 'name is required').max(NAME_MAX),
	medium: z.string().min(1, 'medium is required').max(NAME_MAX),
	// Optional: staff record where an item is posted only when it is useful.
	// Stored as '' when absent — see the note on schema.qrCodes.location.
	location: z.string().max(NAME_MAX).optional(),
});

const updateQRCodeBodySchema = z.object({
	name: z.string().min(1).max(NAME_MAX).optional(),
	medium: z.string().min(1).max(NAME_MAX).optional(),
	location: z.string().max(NAME_MAX).optional(),
});

/**
 * Pagination params.
 *
 * `maxLimit` is per-endpoint because /projects fans out into an `inArray` over
 * the page's ids, and D1 caps a query at roughly 100 bound parameters.
 */
function parsePagination(
	query: Record<string, string | undefined>,
	maxLimit = 100,
) {
	const page = Math.max(1, Number(query.page ?? '1') || 1);
	const limit = Math.min(
		Math.max(1, Number(query.limit ?? '10') || 10),
		maxLimit,
	);
	const offset = (page - 1) * limit;
	return { page, limit, offset };
}

// Half of D1's ~100 bound-parameter ceiling, so the aggregation below has room
// to spare.
const PROJECTS_MAX_LIMIT = 50;

// True if `error` is a SQLite UNIQUE constraint violation, regardless of the
// exact wrapper D1's driver throws it in.
function isUniqueConstraintError(error: unknown): boolean {
	return (
		error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
	);
}

/**
 * True if the violated constraint was specifically the short-code index.
 *
 * QRCodes carries two unique indexes — (project_id, name) and short_code — and
 * they need opposite handling: a name clash is the user's to fix (409), a short
 * code clash is ours to retry silently. SQLite names the offending columns in the
 * message ("UNIQUE constraint failed: QRCodes.short_code"), which is the only
 * signal available to tell them apart.
 *
 * Getting this wrong is not hypothetical: without the column check, creating a
 * second QR code with a name already in use would be treated as a collision,
 * retried five times, and then reported as "could not allocate a short code"
 * instead of "that name is taken".
 *
 * Exported for tests — the two messages are the whole contract.
 */
export function isShortCodeCollision(error: unknown): boolean {
	return (
		isUniqueConstraintError(error) &&
		error instanceof Error &&
		/QRCodes\.short_code/i.test(error.message)
	);
}

/**
 * Returns a 403 response when the caller lacks `permission`, or null to proceed.
 *
 * Every read and write below is gated. Previously only DELETE and the QR code
 * mutations checked, while the README documented otherwise — harmless while a
 * single admin login grants ALL_PERMISSIONS, but it silently leaks the moment a
 * lesser-privileged token exists, which is the entire point of the Verifier
 * seam.
 */
function denyUnlessPermitted(
	c: Context<HonoEnv>,
	permission: number,
	permissionName: string,
) {
	const user = c.get('user');
	if (!hasPermission(user?.permissions ?? 0, permission)) {
		return fail(c, 403, ErrorCodes.PERMISSION_REQUIRED, {
			message: `${permissionName} permission required`,
			meta: { required: permissionName },
		});
	}
	return null;
}

const projectsApp = new Hono<HonoEnv>();

/**
 * Scan counts for the QR codes on one page, as `{ [qrId]: count }`.
 *
 * Scoped to the ids being rendered, never the whole table — the same rule the
 * project list follows. It costs one query backed by idx_access_logs_qr_id, and
 * the rows it scans are only those belonging to the visible codes.
 *
 * ## Why this is counted rather than stored
 *
 * A `QRCodes.scan_count` column incremented on every redirect would make this
 * free to display, but it would add a second D1 write per scan. On the Free plan
 * writes are the binding limit (100k/day) while reads are not (5M/day) — so
 * caching the count in a column would halve the number of scans the event can
 * record in order to save a resource there is 50x more of. Wrong direction.
 *
 * Cost, for the record: reads scale with (logs belonging to the visible codes) x
 * (page views). At 20k logs all belonging to one page that is 20k rows per view,
 * i.e. ~250 views/day against the quota — fine for an admin screen, and the
 * reason this is not wired to a poll or a keystroke.
 */
async function scanCountsByQrId(
	db: ReturnType<typeof getDb>,
	qrIds: string[],
): Promise<Record<string, number>> {
	if (qrIds.length === 0) return {};
	const rows = await db
		.select({ qrId: schema.accessLogs.qrId, scanCount: count() })
		.from(schema.accessLogs)
		.where(inArray(schema.accessLogs.qrId, qrIds))
		.groupBy(schema.accessLogs.qrId)
		.all();
	return Object.fromEntries(rows.map((row) => [row.qrId, row.scanCount]));
}

// GET /projects/qrcodes — paginated QR codes across every project
projectsApp.get('/qrcodes', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_VIEW,
		'TRACKING_LINK_VIEW',
	);
	if (denied) return denied;

	const { limit, offset } = parsePagination(c.req.query());
	const db = getDb(c.env.DB);
	const [qrCodes, totalRows] = await Promise.all([
		db
			.select()
			.from(schema.qrCodes)
			.orderBy(desc(schema.qrCodes.createdAt), desc(schema.qrCodes.id))
			.limit(limit)
			.offset(offset)
			.all(),
		db.select({ total: count() }).from(schema.qrCodes),
	]);
	const scanCounts = await scanCountsByQrId(
		db,
		qrCodes.map((qr) => qr.id),
	);
	return c.json({
		data: qrCodes.map((qr) => ({
			...qr,
			scanCount: scanCounts[qr.id] ?? 0,
		})),
		total: totalRows[0]?.total ?? 0,
	});
});

// GET /projects/qrcodes/:id — a single QR code
projectsApp.get('/qrcodes/:id', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_VIEW,
		'TRACKING_LINK_VIEW',
	);
	if (denied) return denied;

	const qrId = c.req.param('id');
	const db = getDb(c.env.DB);
	const qrCode = await db
		.select()
		.from(schema.qrCodes)
		.where(eq(schema.qrCodes.id, qrId))
		.get();
	if (!qrCode) return fail(c, 404, ErrorCodes.QR_CODE_NOT_FOUND);
	return c.json(qrCode);
});

// GET /projects/fallback-destinations — the keywords a project may be assigned
//
// Registered before `/:id` so the literal path wins the route match.
//
// Exists because the admin UI cannot read FALLBACK_DESTINATIONS itself — it is a
// Worker binding, not something the browser can see. Serving the list turns the
// keyword field from free text into a picker, which removes the whole class of
// "typed a keyword that is not in the config, so the fallback silently does
// nothing" mistakes, and means adding or removing a destination in wrangler.jsonc
// updates the form with no code change.
projectsApp.get('/fallback-destinations', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_VIEW,
		'TRACKING_LINK_VIEW',
	);
	if (denied) return denied;

	const map = parseFallbackMap(c.env.FALLBACK_DESTINATIONS);
	// Sorted so the dropdown order does not depend on how the JSON happened to be
	// written.
	const data = Object.entries(map)
		.map(([key, url]) => ({ key, url }))
		.sort((a, b) => a.key.localeCompare(b.key));

	return c.json({
		data,
		// Lets the UI say "if the database is unreachable, scans go here instead"
		// rather than leaving the no-keyword case unexplained.
		staticFallbackUrl: c.env.FALLBACK_URL ?? null,
	});
});

// GET /projects — paginated project list with access and QR code counts
projectsApp.get('/', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_VIEW,
		'TRACKING_LINK_VIEW',
	);
	if (denied) return denied;

	const { limit, offset } = parsePagination(c.req.query(), PROJECTS_MAX_LIMIT);
	const db = getDb(c.env.DB);

	// ORDER BY is not cosmetic: without it D1 returns rows in whatever order it
	// likes, so a freshly created project need not appear on page 1 (users
	// conclude the create failed and make another), and rows can repeat or vanish
	// between pages. ISO-8601 sorts chronologically as text; project_id breaks
	// same-millisecond ties so paging is deterministic.
	const [rows, totalRows] = await Promise.all([
		db
			.select()
			.from(schema.projects)
			.orderBy(desc(schema.projects.createdAt), desc(schema.projects.projectId))
			.limit(limit)
			.offset(offset)
			.all(),
		db.select({ total: count() }).from(schema.projects),
	]);

	// Scoped to the current page's ids. This used to GROUP BY over *all* of
	// AccessLogs and *all* of QRCodes on every request regardless of page — a
	// full scan of the largest table in the system to render ten rows.
	const projectIds = rows.map((row) => row.projectId);
	const [accessCounts, qrCounts] = projectIds.length
		? await Promise.all([
				db
					.select({
						projectId: schema.accessLogs.projectId,
						accessCount: count(),
					})
					.from(schema.accessLogs)
					.where(inArray(schema.accessLogs.projectId, projectIds))
					.groupBy(schema.accessLogs.projectId)
					.all(),
				db
					.select({ projectId: schema.qrCodes.projectId, qrCodeCount: count() })
					.from(schema.qrCodes)
					.where(inArray(schema.qrCodes.projectId, projectIds))
					.groupBy(schema.qrCodes.projectId)
					.all(),
			])
		: [[], []];

	const accessCountMap = Object.fromEntries(
		accessCounts.map((row) => [row.projectId, row.accessCount]),
	);
	const qrCountMap = Object.fromEntries(
		qrCounts.map((row) => [row.projectId, row.qrCodeCount]),
	);
	return c.json({
		data: rows.map((p) => ({
			id: p.projectId,
			projectId: p.projectId,
			name: p.name,
			destinationUrl: p.destinationUrl,
			fallbackKey: p.fallbackKey,
			createdAt: p.createdAt,
			adminUserId: p.adminUserId,
			accessCount: accessCountMap[p.projectId] ?? 0,
			qrCodeCount: qrCountMap[p.projectId] ?? 0,
		})),
		total: totalRows[0]?.total ?? 0,
	});
});

// POST /projects — create a project
projectsApp.post('/', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_EDIT,
		'TRACKING_LINK_EDIT',
	);
	if (denied) return denied;

	const parsed = createProjectBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			fields: Object.keys(parsed.error.flatten().fieldErrors),
			details: parsed.error.flatten(),
		});
	}
	const { projectName, destinationUrl } = parsed.data;
	const user = c.get('user');
	const projectId = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	// Passed explicitly rather than relying on the column default, because Drizzle
	// deliberately keeps the field required — see the note on schema.projects.
	const key = parsed.data.fallbackKey ?? '';

	const db = getDb(c.env.DB);
	await db.insert(schema.projects).values({
		projectId,
		name: projectName,
		destinationUrl,
		fallbackKey: key,
		createdAt,
		adminUserId: user?.sub ?? null,
	});

	return c.json(
		{
			projectId,
			name: projectName,
			destinationUrl,
			fallbackKey: key,
			createdAt,
		},
		201,
	);
});

// GET /projects/:id — a single project
projectsApp.get('/:id', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_VIEW,
		'TRACKING_LINK_VIEW',
	);
	if (denied) return denied;

	const projectId = c.req.param('id');
	const db = getDb(c.env.DB);
	const project = await db
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.projectId, projectId))
		.get();
	if (!project) return fail(c, 404, ErrorCodes.PROJECT_NOT_FOUND);
	return c.json({
		id: project.projectId,
		projectId: project.projectId,
		name: project.name,
		destinationUrl: project.destinationUrl,
		fallbackKey: project.fallbackKey,
		createdAt: project.createdAt,
		adminUserId: project.adminUserId,
	});
});

// PUT /projects/:id — update a project
projectsApp.put('/:id', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_EDIT,
		'TRACKING_LINK_EDIT',
	);
	if (denied) return denied;

	const projectId = c.req.param('id');
	const parsed = updateProjectBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			fields: Object.keys(parsed.error.flatten().fieldErrors),
			details: parsed.error.flatten(),
		});
	}

	// `!== undefined` rather than truthiness, so "field omitted" and "field set
	// to a blank string" stay distinguishable. Both of these have .min(1) so they
	// cannot actually be blanked, but the QR code handler below relies on the
	// same shape to let a location be cleared.
	const values: Partial<typeof schema.projects.$inferInsert> = {};
	if (parsed.data.projectName !== undefined)
		values.name = parsed.data.projectName;
	if (parsed.data.destinationUrl !== undefined)
		values.destinationUrl = parsed.data.destinationUrl;
	// `!== undefined` so that fallbackKey: '' clears the keyword; a truthiness check
	// would silently ignore that, as it did for qrCodes.location.
	if (parsed.data.fallbackKey !== undefined)
		values.fallbackKey = parsed.data.fallbackKey;
	if (Object.keys(values).length === 0) {
		return fail(c, 400, ErrorCodes.NO_FIELDS_TO_UPDATE);
	}

	const db = getDb(c.env.DB);
	const result = await db
		.update(schema.projects)
		.set(values)
		.where(eq(schema.projects.projectId, projectId));
	if (result.meta.changes === 0)
		return fail(c, 404, ErrorCodes.PROJECT_NOT_FOUND);
	return c.json({ message: 'Project updated' });
});

// DELETE /projects/:id — delete a project (QR codes and their access logs cascade)
projectsApp.delete('/:id', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_DELETE,
		'TRACKING_LINK_DELETE',
	);
	if (denied) return denied;

	const projectId = c.req.param('id');
	const db = getDb(c.env.DB);
	const result = await db
		.delete(schema.projects)
		.where(eq(schema.projects.projectId, projectId));
	if (result.meta.changes === 0)
		return fail(c, 404, ErrorCodes.PROJECT_NOT_FOUND);
	return c.json({ message: 'Project deleted' });
});

// GET /projects/:id/qrcodes — paginated QR codes for a project
projectsApp.get('/:id/qrcodes', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_VIEW,
		'TRACKING_LINK_VIEW',
	);
	if (denied) return denied;

	const projectId = c.req.param('id');
	const { limit, offset } = parsePagination(c.req.query());
	const db = getDb(c.env.DB);
	const [qrCodes, totalRows] = await Promise.all([
		db
			.select()
			.from(schema.qrCodes)
			.where(eq(schema.qrCodes.projectId, projectId))
			.orderBy(desc(schema.qrCodes.createdAt), desc(schema.qrCodes.id))
			.limit(limit)
			.offset(offset)
			.all(),
		db
			.select({ total: count() })
			.from(schema.qrCodes)
			.where(eq(schema.qrCodes.projectId, projectId)),
	]);
	const scanCounts = await scanCountsByQrId(
		db,
		qrCodes.map((qr) => qr.id),
	);
	return c.json({
		data: qrCodes.map((qr) => ({
			...qr,
			scanCount: scanCounts[qr.id] ?? 0,
		})),
		total: totalRows[0]?.total ?? 0,
	});
});

// GET /projects/:id/access-logs — paginated, newest-first raw access log
projectsApp.get('/:id/access-logs', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_ANALYTICS,
		'TRACKING_LINK_ANALYTICS',
	);
	if (denied) return denied;

	const projectId = c.req.param('id');
	const { limit, offset } = parsePagination(c.req.query());
	const db = getDb(c.env.DB);
	const [logs, totalRows] = await Promise.all([
		db
			.select({
				id: schema.accessLogs.id,
				qrId: schema.accessLogs.qrId,
				projectId: schema.accessLogs.projectId,
				accessedAt: schema.accessLogs.accessedAt,
				ipAddress: schema.accessLogs.ipAddress,
				isBot: schema.accessLogs.isBot,
				location: schema.qrCodes.location,
			})
			.from(schema.accessLogs)
			.leftJoin(schema.qrCodes, eq(schema.accessLogs.qrId, schema.qrCodes.id))
			.where(eq(schema.accessLogs.projectId, projectId))
			// accessed_at is not unique — two scans can land in the same
			// millisecond — so id breaks the tie and keeps paging stable.
			.orderBy(desc(schema.accessLogs.accessedAt), desc(schema.accessLogs.id))
			.limit(limit)
			.offset(offset)
			.all(),
		db
			.select({ total: count() })
			.from(schema.accessLogs)
			.where(eq(schema.accessLogs.projectId, projectId)),
	]);
	return c.json({
		data: logs.map((log) => ({ ...log, location: log.location ?? 'unknown' })),
		total: totalRows[0]?.total ?? 0,
	});
});

// Default ceiling on one export. The old implementation loaded every row and
// built a single string in memory: at 100k rows that blows the Workers Free 10ms
// CPU budget (error 1102) and approaches the 128MB isolate limit, so one click on
// a busy project could take the Worker down.
//
// Overridable via the CSV_MAX_ROWS var so the limit can be raised or lowered from
// the dashboard without a deploy. If you raise it, raise CSV_PAGE_SIZE too — the
// two are tied to the subrequest budget below.
const DEFAULT_MAX_CSV_ROWS = 50_000;
// Rows per D1 query while streaming. One query is one subrequest, so the cap
// above costs at most 25 — half of the Workers Free ceiling of 50, leaving room
// for the count and project lookups. Raise both together or not at all.
const CSV_PAGE_SIZE = 2_000;

/**
 * Reads a boolean-ish env var.
 *
 * Accepts a real boolean as well as the string form, because `vars` in
 * wrangler.jsonc is JSON: writing `"CSV_EXPORT_ENABLED": true` instead of
 * `"true"` is an easy mistake, and a strict `=== 'true'` would then silently
 * keep the feature off with no hint as to why. Anything unrecognised is off.
 */
function isFlagEnabled(value: unknown): boolean {
	return value === true || value === 'true' || value === '1';
}

const csvQuerySchema = z.object({
	// Compared as text against the stored ISO-8601 UTC timestamps, which sort
	// chronologically. A bare date is widened to cover the whole UTC day.
	from: z.string().min(4).max(40).optional(),
	to: z.string().min(4).max(40).optional(),
});

/** Widens a bare `YYYY-MM-DD` to the start or end of that UTC day. */
function normalizeBound(value: string, edge: 'start' | 'end'): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	return edge === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

/**
 * Most projects one request may combine.
 *
 * Bounds the `IN (...)` list, but the limit that matters is CSV_MAX_ROWS below,
 * which is applied to the *combined* total rather than per project — otherwise
 * ticking ten boxes would authorise ten times the row budget in a single click,
 * and on the Free plan that is 10% of the daily read quota gone at once.
 */
const MAX_CSV_PROJECTS = 50;

const bulkCsvQuerySchema = csvQuerySchema.extend({
	// Comma-separated so the whole thing stays a GET: the browser has to navigate
	// to it (or fetch and save a blob) and a POST cannot be a plain download.
	projectIds: z
		.string()
		.min(1)
		.max(MAX_CSV_PROJECTS * 40),
});

// GET /projects/access-logs/csv?projectIds=a,b,c — one CSV covering several
// projects, for the checkbox selection in the admin UI.
//
// Two path segments, so it cannot be swallowed by `/:id` (one segment) or by
// `/qrcodes/:id` (first segment is literal).
projectsApp.get('/access-logs/csv', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_ANALYTICS,
		'TRACKING_LINK_ANALYTICS',
	);
	if (denied) return denied;

	if (!isFlagEnabled(c.env.CSV_EXPORT_ENABLED)) {
		return fail(c, 403, ErrorCodes.CSV_EXPORT_DISABLED);
	}

	const parsedQuery = bulkCsvQuerySchema.safeParse(c.req.query());
	if (!parsedQuery.success) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			details: parsedQuery.error.flatten(),
		});
	}

	const projectIds = [
		...new Set(
			parsedQuery.data.projectIds
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean),
		),
	];
	if (projectIds.length === 0) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			details: { formErrors: ['projectIds is empty'], fieldErrors: {} },
		});
	}
	if (projectIds.length > MAX_CSV_PROJECTS) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			meta: { count: projectIds.length, max: MAX_CSV_PROJECTS },
		});
	}

	const from = parsedQuery.data.from
		? normalizeBound(parsedQuery.data.from, 'start')
		: undefined;
	const to = parsedQuery.data.to
		? normalizeBound(parsedQuery.data.to, 'end')
		: undefined;

	const db = getDb(c.env.DB);
	const rangeFilter = and(
		inArray(schema.accessLogs.projectId, projectIds),
		...(from ? [gte(schema.accessLogs.accessedAt, from)] : []),
		...(to ? [lte(schema.accessLogs.accessedAt, to)] : []),
	);

	const [projects, countRows] = await Promise.all([
		db
			.select({
				projectId: schema.projects.projectId,
				name: schema.projects.name,
			})
			.from(schema.projects)
			.where(inArray(schema.projects.projectId, projectIds))
			.all(),
		db.select({ total: count() }).from(schema.accessLogs).where(rangeFilter),
	]);
	// Every id has to exist. Silently skipping unknown ones would produce a file
	// that looks complete but is missing a project the user ticked.
	if (projects.length !== projectIds.length) {
		return fail(c, 404, ErrorCodes.PROJECT_NOT_FOUND, {
			meta: {
				requested: projectIds.length,
				found: projects.length,
			},
		});
	}
	const projectNames = Object.fromEntries(
		projects.map((project) => [project.projectId, project.name]),
	);

	const maxRows =
		Number(c.env.CSV_MAX_ROWS ?? DEFAULT_MAX_CSV_ROWS) || DEFAULT_MAX_CSV_ROWS;
	const total = countRows[0]?.total ?? 0;
	if (total > maxRows) {
		return fail(c, 413, ErrorCodes.TOO_MANY_ROWS, {
			meta: { total, max: maxRows },
		});
	}

	// プロジェクト leads, because in a combined file it is the column that says
	// which project a row belongs to — the single-project export has no need of it.
	const header = [
		'プロジェクト',
		'日時',
		'名前',
		'媒体',
		'場所',
		'ボット',
		'User Agent',
		'IPアドレス',
	];
	const encoder = new TextEncoder();
	// Ordered by project first, then time descending within each project. Not a
	// global chronological sort: the only index available is
	// (project_id, accessed_at DESC), and ordering across projects by time alone
	// would force SQLite to sort the whole matched set in memory — 50k rows of that
	// inside a Worker is how you hit the 10ms CPU limit. Grouping by project also
	// happens to be the more useful layout in a spreadsheet.
	let cursor: { projectId: string; accessedAt: string; id: number } | null =
		null;
	let done = false;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(`﻿${toCsvRow(header)}\r\n`));
		},
		async pull(controller) {
			if (done) {
				controller.close();
				return;
			}
			const rows = await db
				.select({
					id: schema.accessLogs.id,
					projectId: schema.accessLogs.projectId,
					accessedAt: schema.accessLogs.accessedAt,
					isBot: schema.accessLogs.isBot,
					userAgent: schema.accessLogs.userAgent,
					ipAddress: schema.accessLogs.ipAddress,
					name: schema.qrCodes.name,
					medium: schema.qrCodes.medium,
					location: schema.qrCodes.location,
				})
				.from(schema.accessLogs)
				.leftJoin(schema.qrCodes, eq(schema.accessLogs.qrId, schema.qrCodes.id))
				.where(
					cursor
						? and(
								rangeFilter,
								// Three-column keyset matching the ORDER BY exactly: advance to
								// a later project, or stay in this one and move back in time.
								or(
									gt(schema.accessLogs.projectId, cursor.projectId),
									and(
										eq(schema.accessLogs.projectId, cursor.projectId),
										or(
											lt(schema.accessLogs.accessedAt, cursor.accessedAt),
											and(
												eq(schema.accessLogs.accessedAt, cursor.accessedAt),
												lt(schema.accessLogs.id, cursor.id),
											),
										),
									),
								),
							)
						: rangeFilter,
				)
				.orderBy(
					asc(schema.accessLogs.projectId),
					desc(schema.accessLogs.accessedAt),
					desc(schema.accessLogs.id),
				)
				.limit(CSV_PAGE_SIZE)
				.all();

			if (rows.length === 0) {
				controller.close();
				return;
			}

			controller.enqueue(
				encoder.encode(
					`${rows
						.map((log) =>
							toCsvRow([
								projectNames[log.projectId] ?? '',
								log.accessedAt,
								log.name ?? '',
								log.medium ?? '',
								log.location ?? '',
								log.isBot ? '1' : '0',
								log.userAgent ?? '',
								log.ipAddress ?? '',
							]),
						)
						.join('\r\n')}\r\n`,
				),
			);

			const last = rows[rows.length - 1];
			cursor = {
				projectId: last.projectId,
				accessedAt: last.accessedAt,
				id: last.id,
			};
			if (rows.length < CSV_PAGE_SIZE) done = true;
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': contentDisposition(
				// Requested order, not the order the IN(...) happened to return: the
				// filename names the first project and counts the rest, and SQLite
				// answers in rowid order, so without this the file gets named after
				// whichever selected project is oldest rather than the one at the top
				// of the user's selection.
				bulkCsvFilename(
					projectIds.map((id) => projectNames[id] ?? ''),
					from,
					to,
				),
			),
			'Cache-Control': 'no-store',
		},
	});
});

// GET /projects/:id/access-logs/csv — access log as a streamed CSV download.
// Gated by CSV_EXPORT_ENABLED so it can ship disabled and be turned on later.
projectsApp.get('/:id/access-logs/csv', async (c) => {
	// The README documented ANALYTICS as required here; the check was missing.
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_ANALYTICS,
		'TRACKING_LINK_ANALYTICS',
	);
	if (denied) return denied;

	if (!isFlagEnabled(c.env.CSV_EXPORT_ENABLED)) {
		return fail(c, 403, ErrorCodes.CSV_EXPORT_DISABLED);
	}

	const parsedQuery = csvQuerySchema.safeParse(c.req.query());
	if (!parsedQuery.success) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			details: parsedQuery.error.flatten(),
		});
	}
	const from = parsedQuery.data.from
		? normalizeBound(parsedQuery.data.from, 'start')
		: undefined;
	const to = parsedQuery.data.to
		? normalizeBound(parsedQuery.data.to, 'end')
		: undefined;

	const projectId = c.req.param('id');
	const db = getDb(c.env.DB);

	const rangeFilter = and(
		eq(schema.accessLogs.projectId, projectId),
		...(from ? [gte(schema.accessLogs.accessedAt, from)] : []),
		...(to ? [lte(schema.accessLogs.accessedAt, to)] : []),
	);

	const [project, countRows] = await Promise.all([
		db
			.select({ name: schema.projects.name })
			.from(schema.projects)
			.where(eq(schema.projects.projectId, projectId))
			.get(),
		db.select({ total: count() }).from(schema.accessLogs).where(rangeFilter),
	]);
	if (!project) return fail(c, 404, ErrorCodes.PROJECT_NOT_FOUND);

	const maxRows =
		Number(c.env.CSV_MAX_ROWS ?? DEFAULT_MAX_CSV_ROWS) || DEFAULT_MAX_CSV_ROWS;
	const total = countRows[0]?.total ?? 0;
	if (total > maxRows) {
		// 413 with the real numbers, so the client can say "narrow the range" and
		// show how far over the limit the request was — rather than a bare 500 once
		// the Worker ran out of CPU.
		return fail(c, 413, ErrorCodes.TOO_MANY_ROWS, {
			meta: { total, max: maxRows },
		});
	}

	const header = [
		'日時',
		'名前',
		'媒体',
		'場所',
		'ボット',
		'User Agent',
		'IPアドレス',
	];
	const encoder = new TextEncoder();
	// Keyset cursor on (accessed_at, id). OFFSET paging degrades quadratically
	// over a large table because SQLite has to walk and discard every skipped row;
	// a cursor turns each page into a bounded index range scan on
	// idx_access_logs_project_accessed_at.
	let cursor: { accessedAt: string; id: number } | null = null;
	let done = false;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			// UTF-8 BOM so Excel on Windows detects the encoding, and CRLF per
			// RFC 4180 — both preserved from the original implementation.
			controller.enqueue(encoder.encode(`﻿${toCsvRow(header)}\r\n`));
		},
		async pull(controller) {
			if (done) {
				controller.close();
				return;
			}
			const rows = await db
				.select({
					id: schema.accessLogs.id,
					accessedAt: schema.accessLogs.accessedAt,
					isBot: schema.accessLogs.isBot,
					userAgent: schema.accessLogs.userAgent,
					ipAddress: schema.accessLogs.ipAddress,
					name: schema.qrCodes.name,
					medium: schema.qrCodes.medium,
					location: schema.qrCodes.location,
				})
				.from(schema.accessLogs)
				.leftJoin(schema.qrCodes, eq(schema.accessLogs.qrId, schema.qrCodes.id))
				.where(
					cursor
						? and(
								rangeFilter,
								or(
									lt(schema.accessLogs.accessedAt, cursor.accessedAt),
									and(
										eq(schema.accessLogs.accessedAt, cursor.accessedAt),
										lt(schema.accessLogs.id, cursor.id),
									),
								),
							)
						: rangeFilter,
				)
				.orderBy(desc(schema.accessLogs.accessedAt), desc(schema.accessLogs.id))
				.limit(CSV_PAGE_SIZE)
				.all();

			if (rows.length === 0) {
				controller.close();
				return;
			}

			controller.enqueue(
				encoder.encode(
					`${rows
						.map((log) =>
							toCsvRow([
								log.accessedAt,
								log.name ?? '',
								log.medium ?? '',
								log.location ?? '',
								log.isBot ? '1' : '0',
								log.userAgent ?? '',
								log.ipAddress ?? '',
							]),
						)
						.join('\r\n')}\r\n`,
				),
			);

			const last = rows[rows.length - 1];
			cursor = { accessedAt: last.accessedAt, id: last.id };
			if (rows.length < CSV_PAGE_SIZE) done = true;
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': contentDisposition(
				csvFilename(project.name, from, to),
			),
			'Cache-Control': 'no-store',
		},
	});
});

/**
 * `アクセスログ_造形大祭2026ほか3件_2026-07-25.csv` for a multi-project export.
 *
 * Names the first project and counts the rest rather than joining them all: five
 * Japanese project names concatenated overruns what a downloads folder will show,
 * and the file already carries a プロジェクト column for the detail. A selection of
 * one is named exactly as the single-project export would name it, so ticking one
 * box and using the per-row button give the same file.
 */
function bulkCsvFilename(
	projectNames: string[],
	from?: string,
	to?: string,
): string {
	const [first, ...rest] = projectNames;
	const label = rest.length
		? `${first ?? ''}ほか${rest.length}件`
		: (first ?? 'project');
	return csvFilename(label, from, to);
}

/** `アクセスログ_造形大祭2026_2026-07-25.csv`, sanitised for a filesystem. */
function csvFilename(projectName: string, from?: string, to?: string): string {
	const safeName =
		projectName
			// Characters no filesystem accepts. Japanese is deliberately preserved —
			// the whole point is that the file is identifiable in a downloads folder.
			.replace(/[\\/:*?"<>|]/g, '')
			// Whitespace, including anything exotic, collapses to one underscore.
			.replace(/\s+/g, '_')
			.trim()
			.slice(0, 60) || 'project';
	const range = [from?.slice(0, 10), to?.slice(0, 10)]
		.filter(Boolean)
		.join('_');
	return `アクセスログ_${safeName}${range ? `_${range}` : ''}.csv`;
}

/**
 * Content-Disposition with both an ASCII fallback and an RFC 5987 UTF-8 form.
 * The old header interpolated a raw UUID, so every download was named
 * `access-logs-3f2b….csv`.
 *
 * The fallback is built by iterating rather than with a regex range so there are
 * no hex escapes for a formatter to mangle into literal control bytes: anything
 * outside printable ASCII, plus the quote that would end the header value,
 * becomes an underscore.
 */
function contentDisposition(filename: string): string {
	const ascii = Array.from(filename)
		.map((ch) => (ch >= ' ' && ch <= '~' && ch !== '"' ? ch : '_'))
		.join('');
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Escapes a row of values per RFC 4180: quote fields containing a comma,
// quote, or newline, doubling any embedded quotes.
function toCsvRow(values: (string | null)[]): string {
	return values
		.map((value) => {
			const v = value ?? '';
			return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
		})
		.join(',');
}

// POST /projects/:id/qrcodes — create a QR code for a project
projectsApp.post('/:id/qrcodes', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_EDIT,
		'TRACKING_LINK_EDIT',
	);
	if (denied) return denied;

	const user = c.get('user');
	const projectId = c.req.param('id');
	const parsed = createQRCodeBodySchema.safeParse({
		...(await c.req.json().catch(() => ({}))),
		projectId,
	});
	if (!parsed.success) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			fields: Object.keys(parsed.error.flatten().fieldErrors),
			details: parsed.error.flatten(),
		});
	}

	const { name, medium, location } = parsed.data;
	// The UUID stays: it is the primary key AccessLogs cascades from, and QR codes
	// already in print address rows by it. The short code is an additional handle,
	// and the one new posters carry — see ../short-code.ts.
	const qrId = crypto.randomUUID();
	const createdAt = new Date().toISOString();

	const db = getDb(c.env.DB);

	let shortCode: string;
	try {
		({ shortCode } = await insertWithShortCode(
			(candidate) =>
				db.insert(schema.qrCodes).values({
					id: qrId,
					projectId,
					name,
					medium,
					location: location ?? '',
					shortCode: candidate,
					createdAt,
					creatorId: user?.sub ?? null,
				}),
			isShortCodeCollision,
		));
	} catch (error) {
		if (error instanceof ShortCodeExhaustedError) {
			// Never expected to happen — see SHORT_CODE_ATTEMPTS. Logged because if it
			// ever does, the generator is at fault and nothing else would say so.
			logEvent('qr_short_code_exhausted', {
				projectId,
				attempts: error.attempts,
			});
			return fail(c, 503, ErrorCodes.SHORT_CODE_UNAVAILABLE);
		}
		if (isUniqueConstraintError(error)) {
			// One QR code per named item within a project. `fields` lets the web app
			// mark the offending input rather than making the user guess. Reached
			// rather than retried because isShortCodeCollision rejected it.
			return fail(c, 409, ErrorCodes.DUPLICATE_NAME, { fields: ['name'] });
		}
		throw error;
	}

	return c.json(
		{
			id: qrId,
			projectId,
			name,
			medium,
			location: location ?? '',
			shortCode,
			createdAt,
		},
		201,
	);
});

// PUT /projects/qrcodes/:id — update a QR code's name/medium/location
projectsApp.put('/qrcodes/:id', async (c) => {
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_EDIT,
		'TRACKING_LINK_EDIT',
	);
	if (denied) return denied;

	const qrId = c.req.param('id');
	const parsed = updateQRCodeBodySchema.safeParse(
		await c.req.json().catch(() => null),
	);
	if (!parsed.success) {
		return fail(c, 400, ErrorCodes.INVALID_BODY, {
			fields: Object.keys(parsed.error.flatten().fieldErrors),
			details: parsed.error.flatten(),
		});
	}

	// `!== undefined` so that location: '' clears the location. Truthiness checks
	// silently ignored it, which made an entered location impossible to remove.
	const values: Partial<typeof schema.qrCodes.$inferInsert> = {};
	if (parsed.data.name !== undefined) values.name = parsed.data.name;
	if (parsed.data.medium !== undefined) values.medium = parsed.data.medium;
	if (parsed.data.location !== undefined)
		values.location = parsed.data.location;
	if (Object.keys(values).length === 0) {
		return fail(c, 400, ErrorCodes.NO_FIELDS_TO_UPDATE);
	}

	const db = getDb(c.env.DB);
	try {
		const result = await db
			.update(schema.qrCodes)
			.set(values)
			.where(eq(schema.qrCodes.id, qrId));
		if (result.meta.changes === 0)
			return fail(c, 404, ErrorCodes.QR_CODE_NOT_FOUND);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			return fail(c, 409, ErrorCodes.DUPLICATE_NAME, { fields: ['name'] });
		}
		throw error;
	}
	return c.json({ message: 'QR code updated', qrId });
});

// DELETE /projects/qrcodes/:id — delete a QR code (its access logs cascade)
// TRACKING_LINK_DELETE can delete any QR code; TRACKING_LINK_EDIT only its own.
projectsApp.delete('/qrcodes/:id', async (c) => {
	const user = c.get('user');
	const userPermissions = user?.permissions ?? 0;
	const canDeleteAny = hasPermission(
		userPermissions,
		Permissions.TRACKING_LINK_DELETE,
	);
	const canEdit = hasPermission(
		userPermissions,
		Permissions.TRACKING_LINK_EDIT,
	);

	if (!canDeleteAny && !canEdit) {
		return fail(c, 403, ErrorCodes.PERMISSION_REQUIRED, {
			message: 'TRACKING_LINK_EDIT or TRACKING_LINK_DELETE permission required',
			meta: { required: 'TRACKING_LINK_EDIT|TRACKING_LINK_DELETE' },
		});
	}

	const qrId = c.req.param('id');
	const db = getDb(c.env.DB);
	const qr = await db
		.select()
		.from(schema.qrCodes)
		.where(eq(schema.qrCodes.id, qrId))
		.get();
	if (!qr) return fail(c, 404, ErrorCodes.QR_CODE_NOT_FOUND);
	if (!canDeleteAny && qr.creatorId !== user?.sub) {
		return fail(c, 403, ErrorCodes.NOT_OWNER);
	}

	// Access logs go with it via AccessLogs.qr_id ON DELETE CASCADE (added in
	// migration 0002), so there is no explicit delete here — one less D1 write.
	await db.delete(schema.qrCodes).where(eq(schema.qrCodes.id, qrId));
	return c.json({ message: 'QR code deleted', qrId });
});

export default projectsApp;
