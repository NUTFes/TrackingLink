import { LinkIcon, LogOut, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Permissions, hasPermission } from '../hooks/useStaffAuth';
import { useTranslation } from '../lib/i18n';
import { useAuthContext } from './AuthProvider';
import { LanguageSwitcher } from './LanguageSwitcher';

export function AppLayout({ children }: { children: ReactNode }) {
	const { user, logout } = useAuthContext();
	const { t } = useTranslation();
	const navigate = useNavigate();
	const permissions = user?.permissions ?? 0;

	return (
		<div className="flex h-screen bg-background">
			<aside className="flex w-60 flex-col border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground">
				<div className="mb-6 flex items-center gap-2 px-2 font-semibold">
					<LinkIcon className="h-5 w-5 text-sidebar-primary" />
					Trackable Links
				</div>
				<nav className="flex flex-1 flex-col gap-1">
					<Link
						to="/links"
						className="rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
					>
						{t('nav.projects')}
					</Link>
					{hasPermission(permissions, Permissions.TRACKABLE_LINKS_EDIT) && (
						<Link
							to="/links/create"
							className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
						>
							<Plus className="h-4 w-4" />
							{t('nav.newProject')}
						</Link>
					)}
				</nav>
				<LanguageSwitcher className="mb-3 px-3" />
				<button
					type="button"
					onClick={() => {
						logout();
						navigate('/login');
					}}
					className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
				>
					<LogOut className="h-4 w-4" />
					{t('nav.logOut')}
				</button>
			</aside>
			<main className="flex-1 overflow-y-auto">{children}</main>
		</div>
	);
}
