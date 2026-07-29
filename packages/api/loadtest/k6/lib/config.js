import { SharedArray } from 'k6/data';
import http from 'k6/http';

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8789';
export const PASSWORD = __ENV.ADMIN_PASSWORD || 'dev-admin-password';

/**
 * QR ids weighted to match the skew in the seeded data.
 *
 * Hammering a single id would give the Worker's in-isolate cache a hit rate it
 * will never see in the field, so every scan scenario samples from here instead.
 */
export const qrIds = new SharedArray('qrIds', () => {
	const manifest = JSON.parse(open('../../.out/qrids.json'));
	return manifest.weightedQrIds;
});

export const projectIds = new SharedArray('projectIds', () => {
	const manifest = JSON.parse(open('../../.out/qrids.json'));
	return manifest.projectIds;
});

export function randomQrId() {
	return qrIds[Math.floor(Math.random() * qrIds.length)];
}

/** Logs in and returns an Authorization header. */
export function authHeader() {
	const res = http.post(
		`${BASE_URL}/auth/login`,
		JSON.stringify({ password: PASSWORD }),
		{ headers: { 'Content-Type': 'application/json' } },
	);
	if (res.status !== 200) {
		throw new Error(`login failed: ${res.status} ${res.body}`);
	}
	return { Authorization: `Bearer ${res.json('token')}` };
}

/**
 * `redirects: 0` is not optional for the scan path.
 *
 * The endpoint answers with a redirect to the campaign's destination. Any client
 * that follows it measures that third-party site, not this Worker.
 */
export const NO_REDIRECT = { redirects: 0 };

/** A representative mix of real user agents, including LINE's in-app browser. */
export const HUMAN_AGENTS = [
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
	'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/13.15.0',
];

export function randomHumanAgent() {
	return HUMAN_AGENTS[Math.floor(Math.random() * HUMAN_AGENTS.length)];
}
