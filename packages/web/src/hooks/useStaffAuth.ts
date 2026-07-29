import { useCallback, useEffect, useState } from 'react';
import {
	NetworkError,
	apiFetch,
	clearToken,
	getToken,
	setToken,
} from '../lib/api';

export const Permissions = {
	TRACKING_LINK_VIEW: 1 << 0,
	TRACKING_LINK_EDIT: 1 << 1,
	TRACKING_LINK_ANALYTICS: 1 << 2,
	TRACKING_LINK_DELETE: 1 << 3,
} as const;

export const ALL_PERMISSIONS = Object.values(Permissions).reduce(
	(acc, bit) => acc | bit,
	0,
);

export function hasPermission(
	userPermissions: number,
	required: number,
): boolean {
	return (userPermissions & required) === required;
}

export interface StaffUser {
	sub: string;
	permissions: number;
}

/**
 * Minimal single-admin-password auth (see packages/api/src/auth.ts). Swap
 * this hook out if you wire up a real identity provider — everything else
 * (AuthProvider, PermissionGuard, the pages) only depends on the
 * `{ user, isLoading, login, logout }` shape returned here.
 */
export function useStaffAuth() {
	const [user, setUser] = useState<StaffUser | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	/** i18n key set only when the session could not be *checked*, vs. rejected. */
	const [authErrorKey, setAuthErrorKey] = useState<string | null>(null);

	const checkAuth = useCallback(async () => {
		if (!getToken()) {
			setUser(null);
			setAuthErrorKey(null);
			setIsLoading(false);
			return;
		}
		try {
			const me = await apiFetch<StaffUser>('/auth/me');
			setUser(me);
			setAuthErrorKey(null);
		} catch (error) {
			setUser(null);
			// The empty `catch { setUser(null) }` this replaces could not tell a 401
			// from `TypeError: Failed to fetch`, so a Wi-Fi blip or a cold Worker
			// silently bounced a perfectly valid session to /login with no
			// explanation. A network failure now surfaces a retry screen instead.
			setAuthErrorKey(error instanceof NetworkError ? 'error.network' : null);
		} finally {
			setIsLoading(false);
		}
	}, []);

	/** Drops the local session without a network call (used by the 401 handler). */
	const reset = useCallback(() => {
		clearToken();
		setUser(null);
		setAuthErrorKey(null);
	}, []);

	useEffect(() => {
		checkAuth();
	}, [checkAuth]);

	const login = useCallback(
		async (password: string) => {
			const { token } = await apiFetch<{ token: string }>('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ password }),
			});
			setToken(token);
			await checkAuth();
		},
		[checkAuth],
	);

	const logout = useCallback(async () => {
		clearToken();
		setUser(null);
		setAuthErrorKey(null);
	}, []);

	return { user, isLoading, authErrorKey, login, logout, checkAuth, reset };
}
