import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from './AuthProvider';
import { FullScreenLoading } from './FullScreenMessage';

export function ProtectedRoute({ children }: { children: ReactNode }) {
	const { user, isLoading } = useAuthContext();

	// Was a hardcoded English "Loading…" despite common.loading existing — and it
	// is the first thing a Japanese user sees on every single page load.
	if (isLoading) return <FullScreenLoading />;
	if (!user) return <Navigate to="/login" replace />;
	return <>{children}</>;
}
