import { eq, or } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { getConnInfo } from 'hono/cloudflare-workers';
import { html } from 'hono/html';
import type { HonoEnv } from '../auth';
import { getDb, schema } from '../db';
import { parseFallbackMap, resolveFallbackUrl } from '../fallback';
import { logEvent, logFailure } from '../log';
import { isBotUserAgent, wantsLinkPreview } from '../user-agent';

const forwardApp = new Hono<HonoEnv>();

/**
 * Keywords already reported as missing from FALLBACK_DESTINATIONS.
 *
 * Module scope, so the warning below is emitted at most once per isolate. Logging
 * it on every scan would flood Workers Logs for an unconfigured project — the
 * point is to notice the gap, not to narrate it.
 */
const reportedMissingKeywords = new Set<string>();

// GET /?id=<qrId>&p=<fallbackKey> — scan a QR code: look it up, log the access,
// redirect.
//
// `id` is either a QRCodes.id (a UUID, on flyers printed before short codes
// existed) or a QRCodes.short_code. Both are accepted for the lifetime of the
// app: paper cannot be reissued, so neither form may ever stop resolving.
//
// This is the only hot path in the app: every person who scans a printed poster
// goes through it, in bursts. It is deliberately one D1 read on the critical path
// — see the join and the waitUntil below.
forwardApp.get('/', async (c) => {
	const { id, p: fallbackKey } = c.req.query();
	const userAgent = c.req.header('User-Agent') || 'unknown';

	if (!id) return c.text('Not found', 404);

	const isLinkPreviewBot = wantsLinkPreview(userAgent);
	const db = getDb(c.env.DB);

	// `target` stays undefined for "no such QR code" and dbUnavailable flips for
	// "could not ask". Keeping them apart matters: `.get()` returns undefined
	// rather than throwing when a row is missing, so the 404 branches below mean
	// exactly what they did before, and only a genuine failure reaches the
	// fallback.
	let target:
		| {
				/**
				 * The row's own id, which is not necessarily what was scanned. The
				 * access-log insert below needs this rather than the query parameter:
				 * AccessLogs.qr_id is a foreign key into QRCodes(id), so writing a
				 * short code there would fail the constraint and lose the scan.
				 */
				id: string;
				projectId: string;
				location: string;
				projectName: string | null;
				destinationUrl: string | null;
		  }
		| undefined;
	let dbUnavailable = false;

	try {
		if (c.env.SIMULATE_DB_FAILURE) {
			// Local-testing escape hatch. Without it the fallback path — the whole
			// point of this handler's new branch — cannot be exercised by hand, since
			// the local database is embedded and cannot be "turned off". Logged on
			// every use so it cannot sit unnoticed in a deployed environment.
			logEvent('db_failure_simulated', { qrId: id });
			throw new Error('SIMULATE_DB_FAILURE is set');
		}

		// One round trip instead of two. A leftJoin (rather than an inner join) so
		// that "QR code missing" and "project missing" stay distinguishable, which
		// the two 404 branches below rely on.
		target = await db
			.select({
				id: schema.qrCodes.id,
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
			// One OR rather than a shape test on `id`, and rather than a second query.
			// A shape test ("36 chars with hyphens is a UUID") would be wrong: ids are
			// arbitrary TEXT, and the load-test harness seeds them as `lt-qr-001-001`.
			// A second query would double the subrequests on the hottest path in the
			// app. Both columns are indexed — id is the primary key, short_code has a
			// unique index — so this stays two index probes, not a scan.
			.where(or(eq(schema.qrCodes.id, id), eq(schema.qrCodes.shortCode, id)))
			.get();
	} catch (error) {
		dbUnavailable = true;
		logFailure('scan_db_unavailable', error, { qrId: id, key: fallbackKey });
	}

	if (dbUnavailable) {
		return serveFallback(c, { qrId: id, fallbackKey });
	}

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

	// Self-check on the healthy path. A keyword missing from the config only shows
	// up as a degraded redirect during an outage, which is the worst possible time
	// to discover it — so notice it now, while everything works.
	warnIfKeywordUnconfigured(c, fallbackKey, id);

	const { remote } = getConnInfo(c);

	// Record the hit — including crawler hits, flagged rather than dropped, so a
	// refined classifier can recount them later.
	const write = db
		.insert(schema.accessLogs)
		.values({
			// target.id, not the scanned `id`: the latter may be a short code, which
			// the qr_id foreign key would reject. Logging the row's own id also keeps
			// scan history joinable regardless of which URL form was printed.
			qrId: target.id,
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
				projectId: target?.projectId,
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

type ForwardContext = Context<HonoEnv>;

/**
 * Answers a scan without touching the database.
 *
 * Reached only when the lookup itself failed. The destination comes from
 * configuration alone, so it works while D1 is unreachable — which, on the Free
 * plan, most plausibly means a daily quota ran out rather than an outage.
 */
function serveFallback(
	c: ForwardContext,
	{ qrId, fallbackKey }: { qrId: string; fallbackKey?: string },
) {
	const target = resolveFallbackUrl(
		fallbackKey,
		parseFallbackMap(c.env.FALLBACK_DESTINATIONS),
		c.env.FALLBACK_URL,
	);

	// The scan is genuinely lost, not merely deferred: AccessLogs.project_id is NOT
	// NULL and qr_id is a foreign key into QRCodes, so without a readable database
	// there is no valid row to write. Counted here so the size of the gap is known
	// afterwards.
	logEvent('scan_unlogged_due_to_db_failure', { qrId, key: fallbackKey });

	if (!target) {
		logEvent('scan_fallback_unavailable', { qrId, key: fallbackKey });
		// A readable page rather than the bare "Internal Server Error" this path used
		// to produce.
		return c.html(
			html`<!DOCTYPE html>
				<html lang="ja">
					<head>
						<meta charset="utf-8" />
						<meta name="viewport" content="width=device-width, initial-scale=1.0" />
						<title>一時的にアクセスできません</title>
					</head>
					<body
						style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.7;"
					>
						<h1 style="font-size: 1.25rem;">一時的にアクセスできません</h1>
						<p>
							現在このQRコードの転送先を取得できません。少し時間をおいて、もう一度読み取ってください。
						</p>
					</body>
				</html>`,
			503,
			{ 'Cache-Control': 'no-store' },
		);
	}

	logEvent('scan_served_from_fallback', {
		qrId,
		key: fallbackKey,
		tier: target.tier,
	});

	// no-store is load-bearing here, more so than on the healthy path: a cached
	// fallback redirect would keep sending people to the fallback long after D1
	// recovered.
	c.header('Cache-Control', 'no-store, max-age=0');
	return c.redirect(target.url, 302);
}

/** Logs once per isolate when a scanned keyword has no configured destination. */
function warnIfKeywordUnconfigured(
	c: ForwardContext,
	fallbackKey: string | undefined,
	qrId: string,
) {
	const key = fallbackKey ?? '';
	if (reportedMissingKeywords.has(key)) return;

	const map = parseFallbackMap(c.env.FALLBACK_DESTINATIONS);
	if (key && map[key]) return;

	reportedMissingKeywords.add(key);
	logEvent('scan_fallback_not_configured', {
		qrId,
		key: fallbackKey ?? null,
		// Distinguishes "this QR predates the keyword" from "the keyword is simply
		// not in FALLBACK_DESTINATIONS", which need different fixes.
		reason: key ? 'keyword_missing_from_config' : 'qr_has_no_keyword',
		hasStaticFallback: Boolean(c.env.FALLBACK_URL),
	});
}

export default forwardApp;
