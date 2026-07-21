import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getConnInfo } from 'hono/cloudflare-workers';
import { html } from 'hono/html';
import type { HonoEnv } from '../auth';
import { getDb, schema } from '../db';

const forwardApp = new Hono<HonoEnv>();

// GET /?id=<qrId> — scan a QR code: look it up, log the access, redirect.
forwardApp.get('/', async (c) => {
	const { id } = c.req.query();
	const userAgent = c.req.header('User-Agent') || 'unknown';

	if (!id) return c.text('Not found', 404);

	const db = getDb(c.env.DB);
	const qrCode = await db
		.select()
		.from(schema.qrCodes)
		.where(eq(schema.qrCodes.id, id))
		.get();

	const isLinkPreviewBot =
		userAgent.includes('facebook') || userAgent.includes('Discordbot');

	if (!qrCode) {
		if (isLinkPreviewBot) {
			return c.html(
				html`<!DOCTYPE html>
					<html lang="en">
						<head prefix="og: http://ogp.me/ns#">
							<meta name="viewport" content="width=device-width, initial-scale=1.0" />
							<meta property="og:title" content="This QR code could not be found." />
							<meta
								property="og:description"
								content="Check that the QR code is valid, or issue a new one."
							/>
						</head>
					</html>`,
				200,
				{ 'Cache-Control': 'no-store' },
			);
		}
		return c.text('QR code not found', 404);
	}

	const project = await db
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.projectId, qrCode.projectId))
		.get();
	if (!project) return c.text('Project not found', 404);

	const location = qrCode.location;

	if (isLinkPreviewBot) {
		const accessedAt = new Date().toISOString();
		return c.html(
			html`<!DOCTYPE html>
				<html lang="en">
					<head prefix="og: http://ogp.me/ns#">
						<meta name="viewport" content="width=device-width, initial-scale=1.0" />
						<meta property="og:title" content="${project.name} QR code" />
						<meta property="og:description" content="${accessedAt} · location: ${location}" />
					</head>
				</html>`,
			200,
			{ 'Cache-Control': 'no-store' },
		);
	}

	const { remote } = getConnInfo(c);

	try {
		await db.insert(schema.accessLogs).values({
			qrId: id,
			projectId: qrCode.projectId,
			accessedAt: new Date().toISOString(),
			userAgent,
			ipAddress: remote.address ?? null,
		});
	} catch (error) {
		console.error('[GET /] failed to insert access log:', error);
		// Don't block the redirect just because logging failed.
	}

	return c.redirect(project.destinationUrl, 301);
});

export default forwardApp;
