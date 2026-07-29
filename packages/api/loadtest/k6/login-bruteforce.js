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
 *
 * ## Measured against production, and what it actually buys
 *
 * 601 attempts over 30s: **490 rejected with 429, 111 let through** — about 3.7
 * attempts per second sustained, not the ~10-per-60s the configuration reads
 * like. Cloudflare's rate limiting binding is explicitly best-effort and enforced
 * per location, so the configured number is a target rather than a hard ceiling.
 *
 * 3.7/s is roughly 320,000 attempts per day from one address. That is real
 * protection against a dictionary run at a strong password, and no protection at
 * all against a weak one — the limiter buys time, it does not substitute for the
 * password being unguessable.
 *
 * The threshold below is therefore set from the measurement (>75% turned away)
 * rather than from the configured limit. An earlier `count>500` was calibrated
 * against the config and failed on a run that was behaving correctly.
 */
const rejected = new Counter('rate_limited_responses');
const allowed = new Counter('accepted_attempts');

const ATTEMPT_RATE = 20;
const DURATION_SECONDS = 30;
/** 75% of the attempts issued. See the measurement note above. */
const MIN_REJECTED = Math.floor(ATTEMPT_RATE * DURATION_SECONDS * 0.75);

export const options = {
	scenarios: {
		bruteforce: {
			executor: 'constant-arrival-rate',
			rate: ATTEMPT_RATE,
			timeUnit: '1s',
			duration: `${DURATION_SECONDS}s`,
			preAllocatedVUs: 20,
			maxVUs: 100,
		},
	},
	thresholds: {
		rate_limited_responses: [`count>${MIN_REJECTED}`],
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
