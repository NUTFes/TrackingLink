import { check } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { BASE_URL, PASSWORD } from './lib/config.js';

/**
 * S5 — login brute force.
 *
 * Run it before the fix too: the attempts/second it achieves against an
 * unprotected single shared password *is* the justification for adding the
 * limiter.
 *
 * The limiter is keyed on CF-Connecting-IP, so an attacker throttles their own
 * address and cannot lock the real admin out. It is also per-colo rather than
 * global, which is ample for an admin panel but is not a defence against a
 * distributed attacker.
 */
const rejected = new Counter('rate_limited_responses');
const allowed = new Counter('accepted_attempts');

export const options = {
	scenarios: {
		bruteforce: {
			executor: 'constant-arrival-rate',
			rate: 20,
			timeUnit: '1s',
			duration: '30s',
			preAllocatedVUs: 20,
			maxVUs: 100,
		},
	},
	thresholds: {
		// With a 10/60s limit, the overwhelming majority of 600 attempts must be
		// turned away.
		rate_limited_responses: ['count>500'],
	},
};

const json = { headers: { 'Content-Type': 'application/json' } };

export default function () {
	const res = http.post(
		`${BASE_URL}/auth/login`,
		JSON.stringify({ password: `wrong-${Math.random()}` }),
		json,
	);

	if (res.status === 429) {
		rejected.add(1);
		check(res, {
			'429 carries RATE_LIMITED': (r) => r.json('code') === 'RATE_LIMITED',
		});
	} else {
		allowed.add(1);
		check(res, {
			// Never 200 for a wrong password, and never a 500.
			'wrong password is 401': (r) => r.status === 401,
			'401 is INVALID_PASSWORD, not UNAUTHORIZED': (r) =>
				r.json('code') === 'INVALID_PASSWORD',
		});
	}
}

export function teardown() {
	// The limiter must not have permanently locked out the legitimate password —
	// only throttled this source for the window.
	const res = http.post(
		`${BASE_URL}/auth/login`,
		JSON.stringify({ password: PASSWORD }),
		json,
	);
	console.log(
		`\nCorrect password immediately after the burst: ${res.status} (429 is expected from the same IP inside the window; it must succeed once it rolls)`,
	);
}
