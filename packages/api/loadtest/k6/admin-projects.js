import { check } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';
import { BASE_URL, authHeader } from './lib/config.js';

/**
 * S3 — admin dashboard against a large access log.
 *
 * Run this BEFORE the fix as well: `GET /projects` used to GROUP BY over all of
 * AccessLogs and all of QRCodes on every request regardless of page, so the
 * before/after numbers are the evidence that scoping the aggregation to the
 * page's ids was worth doing.
 *
 * Latency alone is not the assertion. A warm page cache hides a full scan, so the
 * number that matters is rows read per request — visible in the Cloudflare
 * dashboard, or via `meta.rows_read` when querying D1 directly.
 */
const page1 = new Trend('admin_page1_duration', true);
const deepPage = new Trend('admin_page3_duration', true);

export const options = {
	scenarios: {
		dashboard: {
			executor: 'constant-vus',
			vus: 5,
			duration: '1m',
		},
	},
	thresholds: {
		http_req_failed: ['rate==0'],
		http_req_duration: ['p(95)<200'],
		checks: ['rate==1.0'],
	},
};

export function setup() {
	return { headers: authHeader() };
}

export default function (data) {
	const { headers } = data;

	const first = http.get(`${BASE_URL}/projects?page=1&limit=10`, { headers });
	page1.add(first.timings.duration);
	check(first, { 'page 1 is 200': (r) => r.status === 200 });

	const third = http.get(`${BASE_URL}/projects?page=3&limit=10`, { headers });
	deepPage.add(third.timings.duration);
	check(third, { 'page 3 is 200': (r) => r.status === 200 });

	// Correctness, not just speed: paging must not repeat or drop rows. This is
	// what catches a missing ORDER BY, which latency never would.
	if (first.status === 200 && third.status === 200) {
		const ids1 = first.json('data').map((p) => p.projectId);
		const ids3 = third.json('data').map((p) => p.projectId);
		check(
			{},
			{
				'page 1 and page 3 do not overlap': () =>
					ids1.filter((id) => ids3.includes(id)).length === 0,
			},
		);
	}

	// The limit is capped at 50 for this endpoint, because the aggregation binds
	// one parameter per project id and D1 allows about 100 per query.
	const overLimit = http.get(`${BASE_URL}/projects?page=1&limit=500`, {
		headers,
	});
	check(overLimit, {
		'limit is clamped rather than rejected': (r) =>
			r.status === 200 && r.json('data').length <= 50,
	});
}
