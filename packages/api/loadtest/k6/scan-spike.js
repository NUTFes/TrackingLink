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
 * S2 — scan spike. LOCAL ONLY.
 *
 * D1 is SQLite with a single writer per database, and every scan inserts into the
 * same AccessLogs table, so the question is whether concurrent writes *serialise*
 * or start erroring. That is the question raised in review on PR #1.
 *
 * Note that spreading load across projects does NOT relieve write contention —
 * one table, one writer. Do not expect it to.
 *
 * ## What this scenario can and cannot tell you
 *
 * Measured: the local runtime saturates at roughly 20 requests/second. Under a
 * 500 rps demand it queued, served each request in ~12s on average, and dropped
 * ~30k iterations it never managed to start — while returning **zero 5xx and zero
 * write conflicts**.
 *
 * So this answers "does the write path produce SQLITE_BUSY when completely
 * saturated" (no) but it says **nothing about production throughput**. Local D1 is
 * one SQLite file behind a single-threaded workerd; production D1 is a different
 * system. Latency and throughput numbers from here are properties of miniflare on
 * a laptop, not of Cloudflare.
 *
 * Thresholds are therefore only on correctness. Asserting p99 latency or a failure
 * rate here would fail on every run for reasons that have nothing to do with the
 * code, and a test that always fails gets ignored.
 *
 * Local only: at the demanded rate this is ~30,000 D1 writes, 30% of the Workers
 * Free daily quota, and deletes count as writes too.
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
			// Without this, k6 waits out the slowest in-flight request — which was
			// over four minutes once the local runtime was saturated.
			gracefulStop: '15s',
		},
	},
	thresholds: {
		// Correctness only. See the note above on why latency is not asserted.
		d1_write_conflicts: ['count==0'],
		checks: ['rate>0.99'],
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

// See the note in scan-sustained.js: handleSummary would suppress k6's summary.
export function teardown() {
	console.log(
		[
			'',
			'Client-side metrics cannot see these — check Workers Logs too:',
			'  access_log_insert_failed   (a waitUntil write that lost)',
			'  1101 / 1102                (uncaught throw / CPU exceeded)',
			'',
			'If http_req_failed is high while d1_write_conflicts is 0, suspect the load',
			'generator rather than D1: one machine cannot always sustain 500 rps, and a',
			'saturated client shows up as timeouts, not as database errors.',
			'',
		].join('\n'),
	);
}
