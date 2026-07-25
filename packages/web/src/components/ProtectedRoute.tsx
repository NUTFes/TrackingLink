import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from '../lib/i18n';
import { useAuthContext } from './AuthProvider';
import { FullScreenError, FullScreenLoading } from './FullScreenMessage';

export function ProtectedRoute({ children }: { children: ReactNode }) {
	const { user, isLoading, authErrorKey, checkAuth } = useAuthContext();
	const { t } = useTranslation();

	// Was a hardcoded English "Loading…" despite common.loading existing — and it
	// is the first thing a Japanese user sees on every single page load.
	if (isLoading) return <FullScreenLoading />;

	// The session could not be *checked* (offline, cold Worker), which is not the
	// same as being signed out. Bouncing to /login here would silently log out a
	// user whose token is perfectly valid.
	if (authErrorKey) {
		return <FullScreenError message={t(authErrorKey)} onRetry={checkAuth} />;
	}

	if (!user) return <Navigate to="/login" replace />;
	return <>{children}</>;
}
