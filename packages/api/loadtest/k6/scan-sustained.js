import { check } from 'k6';
import http from 'k6/http';
import {
	BASE_URL,
	NO_REDIRECT,
	randomHumanAgent,
	randomQrId,
} from './lib/config.js';

/**
 * S1 — sustained scan load. LOCAL ONLY.
 *
 * `constant-arrival-rate`, not a fixed VU count: QR scanning is an arrival-rate
 * phenomenon (people scan at the same rate whether or not the server is slow).
 * A closed-model tool self-throttles when latency rises and so hides the exact
 * degradation this is looking for.
 *
 * 50 rps for 5 minutes is roughly 10x the expected real peak, so passing means
 * genuine headroom.
 */
export const options = {
	scenarios: {
		sustained: {
			executor: 'constant-arrival-rate',
			rate: 50,
			timeUnit: '1s',
			duration: '5m',
			preAllocatedVUs: 50,
			maxVUs: 300,
		},
	},
	thresholds: {
		http_req_failed: ['rate<0.001'],
		// Local D1 is sub-millisecond, so this is a CPU/logic budget, not a network
		// one. Compare the CPU time in the Cloudflare dashboard for the real number.
		http_req_duration: ['p(95)<50', 'p(99)<200'],
		checks: ['rate>0.999'],
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
	});
}

// Printed from teardown rather than handleSummary on purpose: returning a value
// from handleSummary *replaces* k6's own stdout summary, which silently hid every
// metric this scenario exists to produce.
export function teardown() {
	console.log(
		[
			'',
			'Reconcile the access-log writes against http_reqs in the summary below.',
			'This is the real integration test for moving the INSERT into waitUntil —',
			'the delta should equal the request count exactly:',
			'',
			'  wrangler d1 execute trackinglink-db --local \\',
			'    --command "SELECT COUNT(*) FROM AccessLogs"',
			'',
		].join('\n'),
	);
}
