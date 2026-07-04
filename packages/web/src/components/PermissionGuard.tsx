import type { ReactNode } from 'react';
import { hasPermission } from '../hooks/useStaffAuth';
import { useTranslation } from '../lib/i18n';
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
	const { t } = useTranslation();
	if (isLoading) return null;
	if (!user || !hasPermission(user.permissions, required)) {
		return (
			fallback ?? (
				<div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
					<p className="text-base font-medium">
						{t('permission.noAccessTitle')}
					</p>
					<p className="text-sm">{t('permission.noAccessDesc')}</p>
				</div>
			)
		);
	}
	return <>{children}</>;
}
