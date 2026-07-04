import { ArrowLeft, Loader } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { PermissionGuard } from '../components/PermissionGuard';
import { TRACABLE_LINKS_API_URL } from '../config';
import { Permissions } from '../hooks/useStaffAuth';
import { authFetch } from '../lib/api';

function CreateProjectForm() {
	const { user } = useAuthContext();
	const navigate = useNavigate();
	const [projectName, setProjectName] = useState('');
	const [destinationUrl, setDestinationUrl] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const adminUser = user?.sub ?? 'admin';

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!projectName.trim() || !destinationUrl.trim()) return;

		setIsSubmitting(true);
		setError(null);
		try {
			const res = await authFetch(`${TRACABLE_LINKS_API_URL}/projects`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectName: projectName.trim(),
					destinationUrl: destinationUrl.trim(),
					adminUser,
				}),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(
					(data as { error?: string }).error ?? `HTTP ${res.status}`,
				);
			}
			navigate('/links');
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Something went wrong');
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="container mx-auto max-w-2xl p-6">
			<div className="mb-6">
				<Link
					to="/links"
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to projects
				</Link>
			</div>

			<div className="rounded-lg border bg-card shadow-sm">
				<div className="border-b p-5">
					<h1 className="text-xl font-bold">New project</h1>
					<p className="mt-0.5 text-sm text-muted-foreground">
						Create a new Trackable Links project
					</p>
				</div>

				<form onSubmit={handleSubmit} className="p-5 space-y-5">
					{error && (
						<div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
							<p className="text-sm text-destructive">{error}</p>
						</div>
					)}

					<div className="space-y-1.5">
						<label htmlFor="projectName" className="block text-sm font-medium">
							Project name <span className="text-destructive">*</span>
						</label>
						<input
							id="projectName"
							type="text"
							value={projectName}
							onChange={(e) => setProjectName(e.target.value)}
							placeholder="e.g. Flyer campaign"
							required
							className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<div className="space-y-1.5">
						<label
							htmlFor="destinationUrl"
							className="block text-sm font-medium"
						>
							Destination URL <span className="text-destructive">*</span>
						</label>
						<input
							id="destinationUrl"
							type="url"
							value={destinationUrl}
							onChange={(e) => setDestinationUrl(e.target.value)}
							placeholder="https://example.com"
							required
							className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<div className="flex items-center gap-3 pt-2">
						<button
							type="submit"
							disabled={
								isSubmitting || !projectName.trim() || !destinationUrl.trim()
							}
							className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
						>
							{isSubmitting && <Loader className="h-4 w-4 animate-spin" />}
							{isSubmitting ? 'Creating…' : 'Create project'}
						</button>
						<Link
							to="/links"
							className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
						>
							Cancel
						</Link>
					</div>
				</form>
			</div>
		</div>
	);
}

export default function CreateProjectPage() {
	return (
		<PermissionGuard required={Permissions.TRACKABLE_LINKS_EDIT}>
			<CreateProjectForm />
		</PermissionGuard>
	);
}
