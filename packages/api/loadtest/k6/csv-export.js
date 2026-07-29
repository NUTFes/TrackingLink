import { check } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';
import { BASE_URL, authHeader, projectIds } from './lib/config.js';

/**
 * S4 — CSV export.
 *
 * The assertion that proves streaming works is that **time to first byte stays
 * roughly flat as the row count grows**. Total duration obviously scales with
 * size; TTFB should not, because the response starts before the rows are read.
 *
 * Requires CSV_EXPORT_ENABLED=true, e.g.
 *   wrangler dev --local --var CSV_EXPORT_ENABLED:true
 */
const ttfb = new Trend('csv_time_to_first_byte', true);
const total = new Trend('csv_total_duration', true);

export const options = {
	vus: 1,
	iterations: 3,
	thresholds: {
		// Flat, and fast, regardless of how many rows follow.
		csv_time_to_first_byte: ['p(95)<2000'],
		csv_total_duration: ['p(95)<30000'],
		checks: ['rate==1.0'],
	},
};

export function setup() {
	return { headers: authHeader() };
}

export default function (data) {
	const { headers } = data;
	// The seed skews most traffic to the first project, so this is the big one.
	const projectId = projectIds[0];

	const res = http.get(`${BASE_URL}/projects/${projectId}/access-logs/csv`, {
		headers,
		timeout: '120s',
	});

	if (res.status === 403) {
		check(res, {
			'403 means the flag is off, not a crash': (r) =>
				r.json('code') === 'CSV_EXPORT_DISABLED',
		});
		console.log(
			'CSV export disabled — re-run with --var CSV_EXPORT_ENABLED:true to exercise it',
		);
		return;
	}

	ttfb.add(res.timings.waiting);
	total.add(res.timings.duration);

	if (res.status === 413) {
		// Over the row cap. The point is that it says so with real numbers instead
		// of running the Worker out of CPU and returning a bare 500.
		check(res, {
			'over-cap returns 413, not 500': (r) => r.status === 413,
			'413 reports the actual and maximum counts': (r) =>
				typeof r.json('meta.total') === 'number' &&
				typeof r.json('meta.max') === 'number',
		});
		console.log(
			`over cap: ${res.json('meta.total')} rows vs max ${res.json('meta.max')} — narrow with ?from=&to=`,
		);
		return;
	}

	const body = res.body || '';
	const lines = body.split('\r\n').filter((line) => line.length > 0);

	check(res, {
		200: (r) => r.status === 200,
		// Streaming is asserted through the timings, not the Transfer-Encoding
		// header: k6's Go HTTP client strips `chunked` from the header map once it
		// has decoded it, so the header is not observable from here (curl -D does
		// show it). What *is* observable — and is the property that matters — is that
		// the first byte arrives long before the last one, i.e. the response starts
		// before all the rows have been read out of D1. A buffered implementation
		// would have TTFB ≈ total.
		'streamed: first byte arrives well before the last': (r) =>
			lines.length < 2000 || r.timings.waiting < r.timings.duration * 0.5,
		'UTF-8 BOM for Excel': () => body.charCodeAt(0) === 0xfeff,
		'CRLF line endings (RFC 4180)': () => body.includes('\r\n'),
		'has the bot column': () => lines[0].includes('ボット'),
		'filename is derived from the project name': (r) =>
			!/access-logs-[0-9a-f-]{36}\.csv/.test(
				r.headers['Content-Disposition'] || '',
			),
		'newest row first': () => {
			if (lines.length < 3) return true;
			return lines[1].slice(0, 24) >= lines[lines.length - 1].slice(0, 24);
		},
	});

	console.log(
		`rows: ${lines.length - 1}, ttfb: ${Math.round(res.timings.waiting)}ms, total: ${Math.round(res.timings.duration)}ms`,
	);

	// A narrowed range must return strictly fewer rows.
	const narrowed = http.get(
		`${BASE_URL}/projects/${projectId}/access-logs/csv?from=2026-07-05&to=2026-07-05`,
		{ headers, timeout: '120s' },
	);
	if (narrowed.status === 200) {
		const narrowedLines = (narrowed.body || '')
			.split('\r\n')
			.filter((l) => l.length > 0);
		check(narrowed, {
			'date range narrows the result': () =>
				narrowedLines.length < lines.length,
		});
	}
}
