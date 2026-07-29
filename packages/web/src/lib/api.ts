import { TRACKING_LINK_API_URL } from '../config';
import { safeStorage } from './storage';

const TOKEN_KEY = 'tracking-link.token';

export function getToken(): string | null {
	return safeStorage.get(TOKEN_KEY);
}

export function setToken(token: string): void {
	safeStorage.set(TOKEN_KEY, token);
}

export function clearToken(): void {
	safeStorage.remove(TOKEN_KEY);
}

/**
 * Fired when the API rejects a request that *should* have been authenticated,
 * i.e. the session died mid-use.
 *
 * Before this existed, `authFetch` cleared the token and then handed the 401
 * back to the caller, which rendered the literal string "HTTP 401" in a red
 * banner. The sidebar stayed, the user stayed on the page, and every subsequent
 * click failed identically with no way out but a manual reload. With an 8h token
 * and a multi-day festival that is a guaranteed occurrence, not an edge case.
 */
export const UNAUTHORIZED_EVENT = 'tracking-link:unauthorized';

/** The coded error body the API returns (see packages/api/src/errors.ts). */
export interface ApiFailure {
	code?: string;
	error?: string;
	fields?: string[];
	meta?: Record<string, unknown>;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public failure: ApiFailure = {},
	) {
		super(message);
		this.name = 'ApiError';
	}

	/** Stable machine-readable code, when the API supplied one. */
	get code(): string | undefined {
		return this.failure.code;
	}

	/** Field names the form should mark invalid. */
	get fields(): string[] {
		return this.failure.fields ?? [];
	}

	get meta(): Record<string, unknown> {
		return this.failure.meta ?? {};
	}
}

/**
 * The request never reached the API — offline, DNS, CORS, or the Worker being
 * cold. Distinct from ApiError because the two need opposite handling: a 401
 * means sign in again, a network failure means retry. Conflating them is what
 * made a Wi-Fi blip look like being signed out.
 */
export class NetworkError extends Error {
	constructor(cause?: unknown) {
		super('Network request failed');
		this.name = 'NetworkError';
		this.cause = cause;
	}
}

/**
 * True for the endpoints where a 401 is an ordinary answer rather than an
 * expired session: a wrong password on the login form, and the session probe
 * that runs for every not-yet-signed-in visitor. Firing "your session expired"
 * for either would be actively misleading.
 */
function isAuthProbe(url: string): boolean {
	return url.includes('/auth/login') || url.includes('/auth/me');
}

/**
 * `fetch` with the Bearer token attached, for call sites that inspect
 * `res.ok`/`res.status` themselves.
 *
 * Rejects with `NetworkError` rather than a bare `TypeError: Failed to fetch`,
 * so callers can tell "server said no" from "never got there".
 */
export async function authFetch(
	input: string,
	init: RequestInit = {},
): Promise<Response> {
	const token = getToken();
	const headers = new Headers(init.headers);
	if (token) headers.set('Authorization', `Bearer ${token}`);

	let response: Response;
	try {
		response = await fetch(input, { ...init, headers });
	} catch (cause) {
		throw new NetworkError(cause);
	}

	if (response.status === 401) {
		clearToken();
		if (!isAuthProbe(input)) {
			window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
		}
	}
	return response;
}

/** Throws a coded ApiError unless the response succeeded. */
export async function assertOk(response: Response): Promise<void> {
	if (response.ok) return;
	const failure = (await response.json().catch(() => ({}))) as ApiFailure;
	throw new ApiError(
		response.status,
		failure.error ?? `Request failed (${response.status})`,
		failure,
	);
}

/** JSON convenience wrapper. */
export async function apiFetch<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json');
	const response = await authFetch(`${TRACKING_LINK_API_URL}${path}`, {
		...init,
		headers,
	});

	await assertOk(response);
	if (response.status === 204) return undefined as T;
	return response.json();
}

/**
 * API error code → i18n key.
 *
 * This mapping is the whole point of the codes. The API used to decide the
 * wording, which made translation impossible: English developer strings
 * ("Invalid request body") reached Japanese users, while the 409 was a hardcoded
 * Japanese sentence that reached English users. Now the server states *what*
 * happened and the client owns *how it reads*.
 */
const CODE_TO_KEY: Record<string, string> = {
	UNAUTHORIZED: 'error.unauthorized',
	PASSWORD_REQUIRED: 'validation.required',
	INVALID_PASSWORD: 'login.invalidPassword',
	PERMISSION_REQUIRED: 'error.permission',
	NOT_OWNER: 'error.notOwner',
	INVALID_BODY: 'error.invalidBody',
	NO_FIELDS_TO_UPDATE: 'error.noFieldsToUpdate',
	PROJECT_NOT_FOUND: 'error.projectNotFound',
	QR_CODE_NOT_FOUND: 'error.qrNotFound',
	DUPLICATE_NAME: 'error.duplicateName',
	CSV_EXPORT_DISABLED: 'csvExport.disabled',
	TOO_MANY_ROWS: 'error.tooManyRows',
	RATE_LIMITED: 'error.rateLimited',
};

/**
 * Status → i18n key, for responses without a code.
 *
 * Only statuses whose meaning is unambiguous without one. 404 is deliberately
 * absent: "not found" could be a project or a QR code, and guessing wrong is
 * worse than a generic message.
 */
const STATUS_TO_KEY: Record<number, string> = {
	400: 'error.invalidBody',
	401: 'error.unauthorized',
	403: 'error.permission',
	409: 'error.duplicateName',
	413: 'error.tooManyRows',
	429: 'error.rateLimited',
};

export interface ErrorDescription {
	key: string;
	vars?: Record<string, string | number>;
}

/** Maps any thrown value to an i18n key plus interpolation vars. */
export function describeError(error: unknown): ErrorDescription {
	if (error instanceof NetworkError) return { key: 'error.network' };

	if (error instanceof ApiError) {
		const key =
			(error.code && CODE_TO_KEY[error.code]) ??
			STATUS_TO_KEY[error.status] ??
			(error.status >= 500 ? 'error.serverError' : 'common.genericError');

		// Only TOO_MANY_ROWS interpolates today, but reading the numbers off `meta`
		// generically means adding another such message needs no change here.
		const vars: Record<string, string | number> = {};
		for (const [name, value] of Object.entries(error.meta)) {
			if (typeof value === 'string' || typeof value === 'number') {
				vars[name] = value;
			}
		}
		return { key, vars: Object.keys(vars).length ? vars : undefined };
	}

	return { key: 'common.genericError' };
}
