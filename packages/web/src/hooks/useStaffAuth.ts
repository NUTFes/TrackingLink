import { useCallback, useEffect, useState } from 'react';
import { apiFetch, clearToken, getToken, setToken } from '../lib/api';

export const Permissions = {
	TRACKABLE_LINKS_VIEW: 1 << 0,
	TRACKABLE_LINKS_EDIT: 1 << 1,
	TRACKABLE_LINKS_ANALYTICS: 1 << 2,
	TRACKABLE_LINKS_DELETE: 1 << 3,
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

	const checkAuth = useCallback(async () => {
		if (!getToken()) {
			setUser(null);
			setIsLoading(false);
			return;
		}
		try {
			const me = await apiFetch<StaffUser>('/auth/me');
			setUser(me);
		} catch {
			setUser(null);
		} finally {
			setIsLoading(false);
		}
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
	}, []);

	return { user, isLoading, login, logout, checkAuth };
}
