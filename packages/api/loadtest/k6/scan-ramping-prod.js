import { check } from 'k6';
import http from 'k6/http';
import {
	BASE_URL,
	NO_REDIRECT,
	randomHumanAgent,
	randomQrId,
} from './lib/config.js';

/**
 * P1 — the production run. Roughly 3,000 requests.
 *
 * ## Why 50 rps and not more
 *
 * This is deliberately sized to the *expected* peak rather than to an attack.
 * Realistic worst case for the event is a stage announcement producing on the
 * order of 50 rps for a short burst; normal load is around 5 rps.
 *
 * That distinction matters legally, not just technically. Cloudflare's DDoS
 * testing guidance requires contacting them beforehand when the property is
 * hosted on Cloudflare or when traffic passes through Cloudflare before reaching
 * it — and a Worker on *.workers.dev is *both*. The usual escape hatch of
 * allow-listing the test source or grey-clouding a subdomain to hit the origin
 * directly does not exist here, because there is no origin: the Worker is the
 * thing, running on Cloudflare's edge.
 *
 * At 50 rps this is capacity testing against traffic the system is expected to
 * see. Going meaningfully above that turns it into an attack simulation, so open
 * a support ticket first if you want a bigger number.
 *
 * Ramping rather than firing one burst, because a ramp shows *where* degradation
 * starts while a step function only says that it did. A single instantaneous
 * burst from one machine is also not measurable: ephemeral ports, TLS handshake
 * CPU and the uplink saturate before Cloudflare does, so the number describes
 * your laptop.
 *
 * ## Before running
 *
 *   1. Check today's D1 rows-written is near zero (quota resets 00:00 UTC / 09:00 JST).
 *   2. Back up: wrangler d1 export trackinglink-db --remote --output=backup.sql
 *   3. Seed ids that actually exist in the target:
 *        node loadtest/seed/seed-remote.mjs --base=<url> --password=<pw>
 *      The default manifest holds locally-seeded ids, and pointing this at
 *      production without reseeding measures nothing but 404s.
 *
 * Budget: ~3,000 requests = ~3,000 D1 writes = ~3% of the Free daily quota.
 * Deleting them afterwards costs the same again — D1 bills rows written, not net
 * change.
 *
 * While it runs, watch Workers Metrics (5xx, CPU p99), Workers Logs
 * (access_log_insert_failed / 1101 / 1102 / 1015) and Security → Events, so that
 * Cloudflare's own abuse protection is not mistaken for an application failure.
 */
export const options = {
	scenarios: {
		ramp: {
			executor: 'ramping-arrival-rate',
			startRate: 5,
			timeUnit: '1s',
			preAllocatedVUs: 30,
			maxVUs: 200,
			stages: [
				{ target: 50, duration: '60s' },
				{ target: 50, duration: '60s' },
				{ target: 5, duration: '15s' },
			],
			gracefulStop: '15s',
		},
	},
	thresholds: {
		http_req_failed: ['rate<0.005'],
		// Wall-clock budgets, generous on purpose: they include the round trip to
		// the nearest colo and a D1 read whose latency depends on where the
		// database's primary lives. The number that actually reflects the code is
		// CPU time per request in the Cloudflare dashboard — check that too.
		http_req_duration: ['p(95)<500', 'p(99)<1000'],
		checks: ['rate>0.99'],
	},
};

export default function () {
	const res = http.get(`${BASE_URL}/?id=${randomQrId()}`, {
		...NO_REDIRECT,
		headers: { 'User-Agent': randomHumanAgent() },
	});

	check(res, {
		302: (r) => r.status === 302,
		'no-store': (r) => (r.headers['Cache-Control'] || '').includes('no-store'),
		// 429/1015 here is Cloudflare's abuse protection, not the app.
		'not rate limited by the edge': (r) =>
			r.status !== 429 && r.status !== 1015,
	});
}

// See the note in scan-sustained.js: handleSummary would suppress k6's summary.
export function teardown() {
	console.log(
		[
			'',
			'Reconcile 1:1 against the access log. This is what verifies that moving the',
			'INSERT into waitUntil did not start silently dropping writes under load:',
			'',
			'  wrangler d1 execute trackinglink-db --remote \\',
			'    --command "SELECT COUNT(*) FROM AccessLogs WHERE accessed_at > \'<run-start-iso>\'"',
			'',
			'Compare against http_reqs below, and subtract it from the 100,000/day D1',
			'write budget before running anything else today.',
			'',
		].join('\n'),
	);
}
