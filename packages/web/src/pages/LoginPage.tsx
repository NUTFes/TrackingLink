import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useApiErrorMessage } from '../hooks/useApiError';
import { useTranslation } from '../lib/i18n';
import { btnPrimary, inputBase, labelBase } from '../lib/styles';
import { cn } from '../lib/utils';

/**
 * Only same-origin paths are honoured, so a crafted `?next=https://evil.example`
 * cannot turn the login form into an open redirect.
 */
function safeNextPath(next: string | null): string {
	if (!next) return '/links';
	if (!next.startsWith('/') || next.startsWith('//')) return '/links';
	return next;
}

export function LoginPage() {
	const { user, login } = useAuthContext();
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const describeError = useApiErrorMessage();
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const next = safeNextPath(searchParams.get('next'));
	const sessionExpired = searchParams.get('reason') === 'session_expired';

	if (user) return <Navigate to={next} replace />;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await login(password);
			// Back to whatever they were doing when the session died.
			navigate(next, { replace: true });
		} catch (err) {
			// Was `err.message === 'Invalid password'` — string-matching an English
			// server literal, so any rewording on the API leaked raw English to the
			// user, and the 400 path already did.
			setError(describeError(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		// min-h-dvh, not h-screen: with a fixed height the vertically centred card
		// gets pushed out of the viewport when the soft keyboard opens, and there is
		// no scroll container to reach it — you literally cannot log in.
		<div className="flex min-h-dvh items-center justify-center bg-background p-4">
			<form
				onSubmit={handleSubmit}
				className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm sm:p-8"
			>
				<div className="mb-1 flex items-center justify-between gap-2">
					<h1 className="text-lg font-semibold">TrackingLink</h1>
					<LanguageSwitcher />
				</div>
				<p className="mb-6 text-sm text-muted-foreground">
					{t('login.subtitle')}
				</p>

				{sessionExpired && !error ? (
					<p
						role="status"
						className="mb-4 rounded-md border border-border bg-muted/50 p-3 text-sm"
					>
						{t('login.sessionExpired')}
					</p>
				) : null}

				<label htmlFor="password" className={cn(labelBase, 'mb-1')}>
					{t('login.passwordLabel')}
				</label>
				<input
					id="password"
					name="password"
					type="password"
					// Lets a password manager fill and offer to save — meaningful when
					// staff share an on-site phone.
					autoComplete="current-password"
					required
					autoFocus
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? 'login-error' : undefined}
					className={cn(inputBase, 'mb-4')}
				/>

				{error ? (
					<p
						id="login-error"
						role="alert"
						className="mb-4 text-sm text-destructive"
					>
						{error}
					</p>
				) : null}

				<button
					type="submit"
					disabled={submitting}
					className={cn(btnPrimary, 'w-full')}
				>
					{submitting ? t('login.signingIn') : t('login.signIn')}
				</button>
			</form>
		</div>
	);
}
