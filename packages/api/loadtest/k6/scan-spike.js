import { check } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import {
	BASE_URL,
	NO_REDIRECT,
	randomHumanAgent,
	randomQrId,
} from './lib/config.js';

/**
 * S2 — scan spike. LOCAL ONLY. The highest-value scenario here.
 *
 * D1 is SQLite with a single writer per database, and every scan inserts into the
 * same AccessLogs table. The assumption is that concurrent writes *serialise*
 * rather than fail. This is the only scenario that tests that assumption, and it
 * is precisely the question raised in review on PR #1.
 *
 * Note that spreading load across projects does NOT relieve write contention —
 * one table, one writer. Do not expect it to.
 *
 * Local only: 500 rps for 60s is ~30,000 D1 writes, which is 30% of the Workers
 * Free daily quota and is not refundable.
 */
const writeConflicts = new Counter('d1_write_conflicts');

export const options = {
	scenarios: {
		spike: {
			executor: 'ramping-arrival-rate',
			startRate: 5,
			timeUnit: '1s',
			preAllocatedVUs: 100,
			maxVUs: 1000,
			stages: [
				{ target: 500, duration: '30s' }, // ramp, so the breaking point is visible
				{ target: 500, duration: '60s' }, // hold
				{ target: 5, duration: '15s' }, // recover
			],
		},
	},
	thresholds: {
		http_req_failed: ['rate<0.005'],
		http_req_duration: ['p(99)<1000'],
		// The actual pass/fail criterion: zero SQLite write conflicts.
		d1_write_conflicts: ['count==0'],
		'http_req_failed{expected_response:false}': ['rate<0.005'],
	},
};

export default function () {
	const res = http.get(`${BASE_URL}/?id=${randomQrId()}`, {
		...NO_REDIRECT,
		headers: { 'User-Agent': randomHumanAgent() },
	});

	// A 5xx whose body mentions locking is the signature we are hunting.
	if (res.status >= 500) {
		const body = res.body || '';
		if (/SQLITE_BUSY|database is locked|write conflict/i.test(body)) {
			writeConflicts.add(1);
		}
	}

	check(res, {
		'no 5xx': (r) => r.status < 500,
		302: (r) => r.status === 302,
	});
}

export function handleSummary() {
	console.log(`
Also check Workers Logs for the signatures this cannot see from the client side:

  access_log_insert_failed   (a waitUntil write that lost)
  1101 / 1102                (uncaught throw / CPU exceeded)

and reconcile the row count against http_reqs, as in scan-sustained.js.
`);
	return {};
}
