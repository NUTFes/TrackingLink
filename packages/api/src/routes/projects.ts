import { count, desc, eq, inArray } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import * as z from 'zod';
import type { HonoEnv } from '../auth';
import { getDb, schema } from '../db';
import { ErrorCodes, fail } from '../errors';
import { Permissions, hasPermission } from '../permissions';

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

const createProjectBodySchema = z.object({
	projectName: z.string().min(1, 'Project name is required').max(NAME_MAX),
	destinationUrl: httpUrl,
});

const updateProjectBodySchema = z.object({
	projectName: z.string().min(1).max(NAME_MAX).optional(),
	destinationUrl: httpUrl.optional(),
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
	return c.json({ data: qrCodes, total: totalRows[0]?.total ?? 0 });
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

	const db = getDb(c.env.DB);
	await db.insert(schema.projects).values({
		projectId,
		name: projectName,
		destinationUrl,
		createdAt,
		adminUserId: user?.sub ?? null,
	});

	return c.json(
		{ projectId, name: projectName, destinationUrl, createdAt },
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
	return c.json({ data: qrCodes, total: totalRows[0]?.total ?? 0 });
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

// GET /projects/:id/access-logs/csv — full access log as a CSV download.
// Gated by CSV_EXPORT_ENABLED so it can ship disabled and be turned on later.
projectsApp.get('/:id/access-logs/csv', async (c) => {
	// The README documented ANALYTICS as required here; the check was missing.
	const denied = denyUnlessPermitted(
		c,
		Permissions.TRACKING_LINK_ANALYTICS,
		'TRACKING_LINK_ANALYTICS',
	);
	if (denied) return denied;

	if (c.env.CSV_EXPORT_ENABLED !== 'true') {
		return fail(c, 403, ErrorCodes.CSV_EXPORT_DISABLED);
	}

	const projectId = c.req.param('id');
	const db = getDb(c.env.DB);
	const logs = await db
		.select({
			accessedAt: schema.accessLogs.accessedAt,
			name: schema.qrCodes.name,
			medium: schema.qrCodes.medium,
			location: schema.qrCodes.location,
			userAgent: schema.accessLogs.userAgent,
			ipAddress: schema.accessLogs.ipAddress,
		})
		.from(schema.accessLogs)
		.leftJoin(schema.qrCodes, eq(schema.accessLogs.qrId, schema.qrCodes.id))
		.where(eq(schema.accessLogs.projectId, projectId))
		.orderBy(desc(schema.accessLogs.accessedAt), desc(schema.accessLogs.id))
		.all();

	const header = ['日時', '名前', '媒体', '場所', 'User Agent', 'IPアドレス'];
	const rows = logs.map((log) => [
		log.accessedAt,
		log.name ?? '',
		log.medium ?? '',
		log.location ?? '',
		log.userAgent ?? '',
		log.ipAddress ?? '',
	]);
	const csv = [header, ...rows].map(toCsvRow).join('\r\n');

	return c.body(`﻿${csv}`, 200, {
		'Content-Type': 'text/csv; charset=utf-8',
		'Content-Disposition': `attachment; filename="access-logs-${projectId}.csv"`,
	});
});

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
	const qrId = crypto.randomUUID();
	const createdAt = new Date().toISOString();

	const db = getDb(c.env.DB);
	try {
		await db.insert(schema.qrCodes).values({
			id: qrId,
			projectId,
			name,
			medium,
			location: location ?? '',
			createdAt,
			creatorId: user?.sub ?? null,
		});
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			// One QR code per named item within a project. `fields` lets the web app
			// mark the offending input rather than making the user guess.
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
