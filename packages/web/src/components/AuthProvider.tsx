import {
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useRef,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { type StaffUser, useStaffAuth } from '../hooks/useStaffAuth';
import { UNAUTHORIZED_EVENT } from '../lib/api';
import { useTranslation } from '../lib/i18n';
import { useToast } from './ToastProvider';

interface AuthContextValue {
	user: StaffUser | null;
	isLoading: boolean;
	/** Set when the session could not be verified due to a network failure. */
	authErrorKey: string | null;
	login: (password: string) => Promise<void>;
	logout: () => Promise<void>;
	checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const auth = useStaffAuth();
	const toast = useToast();
	const navigate = useNavigate();
	const location = useLocation();
	const { t } = useTranslation();

	// Read through a ref inside the listener so the effect does not re-subscribe
	// on every navigation (and cannot capture a stale path).
	const locationRef = useRef(location);
	locationRef.current = location;

	useEffect(() => {
		const onUnauthorized = () => {
			auth.reset();
			toast.error(t('error.unauthorized'));
			// Preserve where they were, so signing back in returns them to the page
			// they were working on rather than always dumping them at /links.
			const { pathname, search } = locationRef.current;
			const next = `${pathname}${search}`;
			navigate(
				`/login?reason=session_expired&next=${encodeURIComponent(next)}`,
				{ replace: true },
			);
		};
		window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
		return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
	}, [auth, navigate, t, toast]);

	return (
		<AuthContext.Provider
			value={{
				user: auth.user,
				isLoading: auth.isLoading,
				authErrorKey: auth.authErrorKey,
				login: auth.login,
				logout: auth.logout,
				checkAuth: auth.checkAuth,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuthContext(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx)
		throw new Error('useAuthContext must be used within an AuthProvider');
	return ctx;
}

export { useAuthContext as useAuth };
