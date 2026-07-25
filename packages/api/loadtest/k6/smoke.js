import { check, fail } from 'k6';
import http from 'k6/http';
import { BASE_URL, NO_REDIRECT, authHeader, randomQrId } from './lib/config.js';

/**
 * S6 — behavioural smoke test. This is the CI gate.
 *
 * Thresholds are deliberately loose on timing and strict on behaviour: a shared
 * GitHub runner cannot produce stable latency numbers, so gating on those would
 * get the job disabled within a month. What it does gate is the set of
 * regressions that would be expensive to discover in the field.
 */
export const options = {
	vus: 1,
	iterations: 1,
	thresholds: {
		// `checks` is the gate, not http_req_failed: this scenario deliberately
		// provokes 404s, 401s and a 400, and every one of them is asserted below.
		checks: ['rate==1.0'],
		http_req_duration: ['p(95)<500'],
	},
};

// Without this, the intentional 4xx probes above are reported as
// `http_req_failed: 30%`, which reads as a broken service to anyone skimming the
// summary. 5xx is still counted as a failure, which is what we care about.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export default function () {
	// --- health ---------------------------------------------------------------
	const health = http.get(`${BASE_URL}/healthz`);
	check(health, {
		'/healthz is 200': (r) => r.status === 200,
		'/healthz reports ok': (r) => r.json('ok') === true,
	});

	const ready = http.get(`${BASE_URL}/readyz`);
	check(ready, { '/readyz reaches D1': (r) => r.status === 200 });

	// GET / without ?id= is a 404 by design — asserted so nobody points a monitor
	// at it and then wonders why it alerts forever.
	check(http.get(`${BASE_URL}/`), {
		'GET / without id is 404 (not a health target)': (r) => r.status === 404,
	});

	// --- scan path ------------------------------------------------------------
	const qrId = randomQrId();
	const scan = http.get(`${BASE_URL}/?id=${qrId}`, {
		...NO_REDIRECT,
		headers: { 'User-Agent': 'k6-smoke-human/1.0 Safari/604.1' },
	});
	check(scan, {
		// 302, not 301: a permanent redirect is cached forever, which hides repeat
		// scans and pins visitors to a stale destination.
		'scan returns 302': (r) => r.status === 302,
		'scan sets Cache-Control: no-store': (r) =>
			(r.headers['Cache-Control'] || '').includes('no-store'),
		'scan sets a Location': (r) => Boolean(r.headers.Location),
	});

	check(http.get(`${BASE_URL}/?id=definitely-not-a-real-id`, NO_REDIRECT), {
		'unknown id is 404': (r) => r.status === 404,
	});

	// A preview crawler gets OG metadata rather than a redirect.
	const bot = http.get(`${BASE_URL}/?id=${qrId}`, {
		...NO_REDIRECT,
		headers: { 'User-Agent': 'Twitterbot/1.0' },
	});
	check(bot, {
		'crawler gets 200 HTML': (r) => r.status === 200,
		'crawler gets og:title': (r) => (r.body || '').includes('og:title'),
	});

	// LINE's in-app browser is a person, and must never be treated as a crawler.
	const line = http.get(`${BASE_URL}/?id=${qrId}`, {
		...NO_REDIRECT,
		headers: {
			'User-Agent':
				'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/13.15.0',
		},
	});
	check(line, {
		'LINE in-app browser is treated as a human (302)': (r) => r.status === 302,
	});

	// --- auth -----------------------------------------------------------------
	check(http.get(`${BASE_URL}/projects`), {
		'unauthenticated /projects is 401': (r) => r.status === 401,
		'401 carries a machine-readable code': (r) =>
			r.json('code') === 'UNAUTHORIZED',
	});

	const headers = authHeader();

	// --- admin API ------------------------------------------------------------
	const page1 = http.get(`${BASE_URL}/projects?page=1&limit=5`, { headers });
	const page2 = http.get(`${BASE_URL}/projects?page=2&limit=5`, { headers });
	check(page1, { '/projects is 200': (r) => r.status === 200 });

	if (page1.status === 200 && page2.status === 200) {
		const ids1 = page1.json('data').map((p) => p.projectId);
		const ids2 = page2.json('data').map((p) => p.projectId);
		const overlap = ids1.filter((id) => ids2.includes(id));
		check(
			{ overlap },
			{
				// Catches a missing ORDER BY: without one, D1 can repeat or drop rows
				// between pages, and a freshly created project may not be on page 1.
				'pagination does not repeat rows across pages': () =>
					overlap.length === 0,
			},
		);

		const createdAt = ids1.length
			? page1.json('data').map((p) => p.createdAt)
			: [];
		const sortedDesc = [...createdAt].sort().reverse();
		check(
			{ createdAt },
			{
				'projects are newest-first': () =>
					JSON.stringify(createdAt) === JSON.stringify(sortedDesc),
			},
		);
	} else {
		fail(`could not read both pages: ${page1.status}/${page2.status}`);
	}

	// --- URL validation -------------------------------------------------------
	const badUrl = http.post(
		`${BASE_URL}/projects`,
		JSON.stringify({
			projectName: 'smoke-xss',
			destinationUrl: 'javascript:alert(1)',
		}),
		{ headers: { ...headers, 'Content-Type': 'application/json' } },
	);
	check(badUrl, {
		// The admin UI renders destinationUrl as an <a href>, so accepting this is a
		// stored-XSS vector into the session that holds the API token.
		'javascript: destination URL is rejected': (r) => r.status === 400,
	});

	// --- CSV export -----------------------------------------------------------
	const someProject = page1.json('data')[0];
	if (someProject) {
		const csv = http.get(
			`${BASE_URL}/projects/${someProject.projectId}/access-logs/csv`,
			{ headers },
		);
		check(csv, {
			// 200 when the flag is on, 403 when off. Either is fine; a 500 is not.
			'CSV export answers 200 or 403': (r) =>
				r.status === 200 || r.status === 403,
		});
		if (csv.status === 200) {
			check(csv, {
				'CSV starts with a UTF-8 BOM (Excel)': (r) =>
					r.body.charCodeAt(0) === 0xfeff,
				'CSV has the bot column': (r) => (r.body || '').includes('ボット'),
				'CSV filename is not a raw UUID': (r) =>
					!/filename="access-logs-[0-9a-f-]{36}\.csv"/.test(
						r.headers['Content-Disposition'] || '',
					),
			});
		}
	}
}
