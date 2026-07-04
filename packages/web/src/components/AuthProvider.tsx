import { type ReactNode, createContext, useContext } from 'react';
import { type StaffUser, useStaffAuth } from '../hooks/useStaffAuth';

interface AuthContextValue {
	user: StaffUser | null;
	isLoading: boolean;
	login: (password: string) => Promise<void>;
	logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const auth = useStaffAuth();
	return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx)
		throw new Error('useAuthContext must be used within an AuthProvider');
	return ctx;
}

export { useAuthContext as useAuth };
