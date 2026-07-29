import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ApiError } from '../lib/api';
import { useTranslation } from '../lib/i18n';

export function LoginPage() {
	const { user, login } = useAuthContext();
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	if (user) return <Navigate to="/links" replace />;

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await login(password);
			navigate('/links');
		} catch (err) {
			if (err instanceof ApiError) {
				setError(
					err.message === 'Invalid password'
						? t('login.invalidPassword')
						: err.message,
				);
			} else {
				setError(t('login.failed'));
			}
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="flex h-screen items-center justify-center bg-background">
			<form
				onSubmit={handleSubmit}
				className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm"
			>
				<div className="mb-1 flex items-center justify-between">
					<h1 className="text-lg font-semibold">TrackingLink</h1>
					<LanguageSwitcher />
				</div>
				<p className="mb-6 text-sm text-muted-foreground">
					{t('login.subtitle')}
				</p>

				<label htmlFor="password" className="mb-1 block text-sm font-medium">
					{t('login.passwordLabel')}
				</label>
				<input
					id="password"
					type="password"
					required
					autoFocus
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className="mb-4 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
				/>

				{error && <p className="mb-4 text-sm text-destructive">{error}</p>}

				<button
					type="submit"
					disabled={submitting}
					className="w-full rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
				>
					{submitting ? t('login.signingIn') : t('login.signIn')}
				</button>
			</form>
		</div>
	);
}
