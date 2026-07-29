import { LinkIcon, LogOut, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Permissions, hasPermission } from '../hooks/useStaffAuth';
import { useTranslation } from '../lib/i18n';
import { btnIcon } from '../lib/styles';
import { cn } from '../lib/utils';
import { useAuthContext } from './AuthProvider';
import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * Sidebar on desktop, top app bar on mobile.
 *
 * The sidebar used to render unconditionally at `w-60`, which on a 375px phone is
 * 240px — 64% of the screen — leaving ~135px for content. Staff use this on their
 * phones while putting up posters, so every carefully built "mobile card" layout
 * was being squeezed into a width the app never actually gave it.
 *
 * A top bar rather than a hamburger drawer, because there are only two nav
 * destinations and one of them (`/links/create`) is permission-gated *and* already
 * the primary call to action in the projects page header. So the real payload is
 * brand/home, language, logout — three things that fit a 56px bar at full touch
 * size. A drawer would add an overlay, focus trap, scroll lock and open/close
 * state to reveal one non-redundant link. A bottom tab bar would permanently spend
 * vertical space on screens that are lists and forms with a keyboard open, and
 * would collide with the toast anchor.
 */
export function AppLayout({ children }: { children: ReactNode }) {
	const { user, logout } = useAuthContext();
	const { t } = useTranslation();
	const navigate = useNavigate();
	const permissions = user?.permissions ?? 0;
	const canCreate = hasPermission(permissions, Permissions.TRACKING_LINK_EDIT);

	const onLogout = () => {
		logout();
		navigate('/login');
	};

	return (
		// min-h-dvh rather than h-screen: on iOS Safari the dynamic toolbar makes
		// 100vh taller than the visible area, so the bottom of the page gets clipped.
		<div className="flex min-h-dvh flex-col bg-background md:flex-row">
			{/* Mobile: top app bar */}
			<header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground md:hidden">
				<Link
					to="/links"
					className="flex min-h-11 flex-1 items-center gap-2 font-semibold"
				>
					<LinkIcon className="h-5 w-5 text-sidebar-primary" />
					TrackingLink
				</Link>
				<LanguageSwitcher />
				<button
					type="button"
					onClick={onLogout}
					aria-label={t('nav.logOut')}
					className={cn(btnIcon, 'hover:bg-sidebar-accent')}
				>
					<LogOut className="h-5 w-5" />
				</button>
			</header>

			{/* Desktop: sidebar */}
			<aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:sticky md:top-0 md:flex md:h-dvh">
				<div className="mb-6 flex items-center gap-2 px-2 font-semibold">
					<LinkIcon className="h-5 w-5 text-sidebar-primary" />
					TrackingLink
				</div>
				<nav className="flex flex-1 flex-col gap-1">
					<Link
						to="/links"
						className="flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
					>
						{t('nav.projects')}
					</Link>
					{canCreate && (
						<Link
							to="/links/create"
							className="flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
						>
							<Plus className="h-4 w-4" />
							{t('nav.newProject')}
						</Link>
					)}
				</nav>
				<LanguageSwitcher className="mb-3 px-3" />
				<button
					type="button"
					onClick={onLogout}
					className="flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
				>
					<LogOut className="h-4 w-4" />
					{t('nav.logOut')}
				</button>
			</aside>

			{/* No overflow-y-auto: the *document* scrolls. That is what makes
			    window.scrollTo (pagination) and scrollIntoView behave, and it restores
			    pull-to-refresh on iOS. min-w-0 stops a long destination URL from
			    blowing out the flex row. */}
			<main className="min-w-0 flex-1">{children}</main>
		</div>
	);
}
