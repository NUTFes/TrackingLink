import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { ApiError } from '../lib/api';

export function LoginPage() {
	const { user, login } = useAuthContext();
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
			setError(err instanceof ApiError ? err.message : 'Login failed');
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
				<h1 className="mb-1 text-lg font-semibold">Trackable Links</h1>
				<p className="mb-6 text-sm text-muted-foreground">
					Sign in with the admin password.
				</p>

				<label htmlFor="password" className="mb-1 block text-sm font-medium">
					Password
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
					{submitting ? 'Signing in…' : 'Sign in'}
				</button>
			</form>
		</div>
	);
}
