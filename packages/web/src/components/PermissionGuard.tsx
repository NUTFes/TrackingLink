import type { ReactNode } from 'react';
import { hasPermission } from '../hooks/useStaffAuth';
import { useAuthContext } from './AuthProvider';

interface PermissionGuardProps {
	required: number;
	children: ReactNode;
	fallback?: ReactNode;
}

export function PermissionGuard({
	required,
	children,
	fallback,
}: PermissionGuardProps) {
	const { user, isLoading } = useAuthContext();
	if (isLoading) return null;
	if (!user || !hasPermission(user.permissions, required)) {
		return (
			fallback ?? (
				<div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
					<p className="text-base font-medium">
						You don't have access to this page.
					</p>
					<p className="text-sm">
						Contact an administrator if you believe this is a mistake.
					</p>
				</div>
			)
		);
	}
	return <>{children}</>;
}
