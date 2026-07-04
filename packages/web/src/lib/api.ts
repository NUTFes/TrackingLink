import { TRACABLE_LINKS_API_URL } from '../config';

const TOKEN_KEY = 'trackable-links.token';

export function getToken(): string | null {
	return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
	localStorage.removeItem(TOKEN_KEY);
}

/**
 * Raw `fetch` with the Bearer session token attached — for call sites that
 * want to inspect `res.ok`/`res.status` themselves (matches the fetch style
 * used throughout the ported page components).
 */
export function authFetch(
	input: string,
	init: RequestInit = {},
): Promise<Response> {
	const token = getToken();
	const headers = new Headers(init.headers);
	if (token) headers.set('Authorization', `Bearer ${token}`);
	return fetch(input, { ...init, headers }).then((res) => {
		if (res.status === 401) clearToken();
		return res;
	});
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

/** JSON convenience wrapper used by the auth flow itself (login/me). */
export async function apiFetch<T>(
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json');
	const response = await authFetch(`${TRACABLE_LINKS_API_URL}${path}`, {
		...init,
		headers,
	});

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new ApiError(
			response.status,
			body.error || body.message || `Request failed (${response.status})`,
		);
	}

	if (response.status === 204) return undefined as T;
	return response.json();
}
