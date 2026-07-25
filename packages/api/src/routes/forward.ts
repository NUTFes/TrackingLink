import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getConnInfo } from 'hono/cloudflare-workers';
import { html } from 'hono/html';
import type { HonoEnv } from '../auth';
import { getDb, schema } from '../db';
import { logFailure } from '../log';
import { isBotUserAgent, wantsLinkPreview } from '../user-agent';

const forwardApp = new Hono<HonoEnv>();

// GET /?id=<qrId> — scan a QR code: look it up, log the access, redirect.
//
// This is the only hot path in the app: every person who scans a printed poster
// goes through it, in bursts. It is deliberately one D1 read (a primary-key
// lookup) on the critical path — see the join and the waitUntil below.
forwardApp.get('/', async (c) => {
	const { id } = c.req.query();
	const userAgent = c.req.header('User-Agent') || 'unknown';

	if (!id) return c.text('Not found', 404);

	const db = getDb(c.env.DB);

	// One round trip instead of two. A leftJoin (rather than an inner join) so
	// that "QR code missing" and "project missing" stay distinguishable, which
	// the two 404 branches below rely on.
	const target = await db
		.select({
			projectId: schema.qrCodes.projectId,
			location: schema.qrCodes.location,
			projectName: schema.projects.name,
			destinationUrl: schema.projects.destinationUrl,
		})
		.from(schema.qrCodes)
		.leftJoin(
			schema.projects,
			eq(schema.qrCodes.projectId, schema.projects.projectId),
		)
		.where(eq(schema.qrCodes.id, id))
		.get();

	const isLinkPreviewBot = wantsLinkPreview(userAgent);

	if (!target) {
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

	// destination_url is NOT NULL, so a null here means the leftJoin found no
	// matching project rather than a project with no URL.
	if (!target.destinationUrl) return c.text('Project not found', 404);

	const { remote } = getConnInfo(c);

	// Record the hit — including crawler hits, flagged rather than dropped, so a
	// refined classifier can recount them later.
	const write = db
		.insert(schema.accessLogs)
		.values({
			qrId: id,
			projectId: target.projectId,
			accessedAt: new Date().toISOString(),
			userAgent,
			ipAddress: remote.address ?? null,
			isBot: isBotUserAgent(userAgent) ? 1 : 0,
		})
		.then(() => undefined)
		.catch((error: unknown) => {
			// Swallowed on purpose: a lost analytics row must never cost the visitor
			// a 500. Emitted as a structured event so dropped writes are countable
			// in Workers Logs rather than invisible.
			logFailure('access_log_insert_failed', error, {
				qrId: id,
				projectId: target.projectId,
			});
		});

	// D1 writes go to the primary and are the slowest of the queries here, while
	// the visitor does not care about them at all — so they come off the response
	// path. The trade-off is that a failed write is no longer visible to the
	// client; LOG_WRITE_MODE=sync forces the old behaviour back without a deploy
	// if the numbers ever look wrong mid-event.
	if (c.env.LOG_WRITE_MODE === 'sync') {
		await write;
	} else {
		try {
			c.executionCtx.waitUntil(write);
		} catch {
			// No execution context (e.g. app.request() in a test) — fall back to
			// awaiting rather than dropping the write.
			await write;
		}
	}

	if (isLinkPreviewBot) {
		const accessedAt = new Date().toISOString();
		return c.html(
			html`<!DOCTYPE html>
				<html lang="en">
					<head prefix="og: http://ogp.me/ns#">
						<meta name="viewport" content="width=device-width, initial-scale=1.0" />
						<meta property="og:title" content="${target.projectName} QR code" />
						<meta
							property="og:description"
							content="${accessedAt} · location: ${target.location}"
						/>
					</head>
				</html>`,
			200,
			{ 'Cache-Control': 'no-store' },
		);
	}

	// 302, not 301. A permanent redirect is cached indefinitely by browsers and
	// in-app webviews, which would (a) hide every repeat scan from the same
	// device, undercounting the campaign, and (b) pin visitors to an old
	// destination forever after an edit to the project. no-store makes that
	// explicit for intermediaries that get creative.
	c.header('Cache-Control', 'no-store, max-age=0');
	return c.redirect(target.destinationUrl, 302);
});

export default forwardApp;
