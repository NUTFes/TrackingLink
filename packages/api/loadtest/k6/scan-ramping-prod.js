import { check } from 'k6';
import http from 'k6/http';
import {
	BASE_URL,
	NO_REDIRECT,
	randomHumanAgent,
	randomQrId,
} from './lib/config.js';

/**
 * P1 — the production run. Roughly 9,000 requests.
 *
 * Ramps 5 → 200 rps rather than firing one big burst, because a ramp shows *where*
 * it starts to degrade while a step function only tells you that it did. A single
 * instantaneous burst from one machine is also not measurable: ephemeral ports,
 * TLS handshake CPU and the uplink saturate before the Worker does, so the number
 * you get describes your laptop.
 *
 * Before running:
 *   1. Check D1 rows-written for today is near zero (quota resets 00:00 UTC / 09:00 JST).
 *   2. Take a backup: wrangler d1 export trackinglink-db --remote --output=backup.sql
 *   3. Point BASE_URL at production and set qr ids that exist there.
 *
 * Budget: ~9,000 requests = ~9,000 D1 writes = ~9% of the Free daily quota.
 * Deleting those rows afterwards costs the same again, because D1 counts deleted
 * rows as written — recreating the database is the zero-write cleanup.
 *
 * While it runs, watch: Workers Metrics (5xx, CPU p99), Workers Logs
 * (access_log_insert_failed / 1101 / 1102 / 1015), and Security → Events, so
 * Cloudflare's own abuse protection is not mistaken for an application failure.
 */
export const options = {
	scenarios: {
		ramp: {
			executor: 'ramping-arrival-rate',
			startRate: 5,
			timeUnit: '1s',
			preAllocatedVUs: 50,
			maxVUs: 400,
			stages: [
				{ target: 200, duration: '60s' },
				{ target: 200, duration: '60s' },
				{ target: 5, duration: '15s' },
			],
		},
	},
	thresholds: {
		http_req_failed: ['rate<0.005'],
		// Real network + real D1, so these are latency budgets rather than CPU ones.
		http_req_duration: ['p(95)<300', 'p(99)<800'],
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

export function handleSummary(data) {
	const issued = data.metrics.http_reqs.values.count;
	console.log(`
Requests issued: ${issued}

Reconcile 1:1 against the access log — this is what verifies that moving the
INSERT into waitUntil did not start silently dropping writes under load:

  wrangler d1 execute trackinglink-db --remote --command \\
    "SELECT COUNT(*) FROM AccessLogs WHERE accessed_at > '<start-of-run-iso>'"

Remember the daily D1 write budget: this run consumed about ${issued} of 100,000.
`);
	return {};
}
