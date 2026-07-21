import {
	ChevronLeft,
	ChevronRight,
	Download,
	ExternalLink,
	Loader,
	Pencil,
	Plus,
	QrCode,
	ScanLine,
	Trash2,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { PermissionGuard } from '../components/PermissionGuard';
import { TRACKING_LINK_API_URL } from '../config';
import { Permissions, hasPermission } from '../hooks/useStaffAuth';
import { authFetch } from '../lib/api';
import { useTranslation } from '../lib/i18n';

interface Project {
	id: string;
	name: string;
	destinationUrl: string;
	createdAt: string;
	adminUserId: string;
	projectId: string;
	accessCount: number;
}

const PAGE_SIZE = 10;

function Pagination({
	currentPage,
	totalPages,
	total,
	onPageChange,
}: {
	currentPage: number;
	totalPages: number;
	total: number;
	onPageChange: (page: number) => void;
}) {
	const { t } = useTranslation();
	if (totalPages <= 1) return null;
	const start = (currentPage - 1) * PAGE_SIZE + 1;
	const end = Math.min(currentPage * PAGE_SIZE, total);
	const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
		.filter(
			(p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1,
		)
		.reduce<(number | '…')[]>((acc, p, idx, arr) => {
			if (idx > 0 && (arr[idx - 1] as number) < p - 1) acc.push('…');
			acc.push(p);
			return acc;
		}, []);

	return (
		<div className="flex items-center justify-between border-t px-5 py-3">
			<p className="text-xs text-muted-foreground">
				{t('pagination.range', { start, end, total })}
			</p>
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => onPageChange(Math.max(1, currentPage - 1))}
					disabled={currentPage === 1}
					className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronLeft className="h-4 w-4" />
				</button>
				{pages.map((p, idx) =>
					p === '…' ? (
						<span
							key={`ellipsis-${idx}`}
							className="px-1 text-xs text-muted-foreground"
						>
							…
						</span>
					) : (
						<button
							key={p}
							type="button"
							onClick={() => onPageChange(p as number)}
							className={`h-7 min-w-7 rounded-md border px-2 text-xs transition-colors ${
								currentPage === p
									? 'bg-primary text-primary-foreground border-primary'
									: 'hover:bg-muted/50'
							}`}
						>
							{p}
						</button>
					),
				)}
				<button
					type="button"
					onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
					disabled={currentPage === totalPages}
					className="flex h-7 w-7 items-center justify-center rounded-md border hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
				>
					<ChevronRight className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
}

function ProjectCard({
	project,
	canEdit,
	canAnalytics,
	canDelete,
	isDownloading,
	onEdit,
	onDownloadCsv,
	onDelete,
}: {
	project: Project;
	canEdit: boolean;
	canAnalytics: boolean;
	canDelete: boolean;
	isDownloading: boolean;
	onEdit: () => void;
	onDownloadCsv: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="border-b last:border-0 px-4 py-4 hover:bg-muted/30 transition-colors">
			<div className="flex items-start justify-between gap-2 mb-2">
				<p className="font-medium text-sm leading-snug">{project.name}</p>
				<span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums shrink-0">
					<ScanLine className="h-3.5 w-3.5" />
					{project.accessCount.toLocaleString()}
				</span>
			</div>
			<a
				href={project.destinationUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="flex items-center gap-1 text-xs text-primary hover:underline mb-3 min-w-0"
			>
				<span className="truncate">{project.destinationUrl}</span>
				<ExternalLink className="h-3 w-3 shrink-0" />
			</a>
			<div className="flex items-center justify-between">
				<span className="text-xs text-muted-foreground">
					{project.createdAt
						? new Date(project.createdAt).toLocaleDateString()
						: '-'}
				</span>
				<div className="flex items-center gap-2">
					<Link
						to={`/links/${project.projectId}/qrcodes`}
						className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
					>
						<QrCode className="h-3.5 w-3.5" />
						{t('projects.qrCodesLink')}
					</Link>
					{canEdit && (
						<button
							type="button"
							onClick={onEdit}
							className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors"
						>
							<Pencil className="h-3.5 w-3.5" />
							{t('common.edit')}
						</button>
					)}
					{canAnalytics && (
						<button
							type="button"
							onClick={onDownloadCsv}
							disabled={isDownloading}
							className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50 transition-colors"
						>
							{isDownloading ? (
								<Loader className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Download className="h-3.5 w-3.5" />
							)}
							{t('projects.csvDownloadLink')}
						</button>
					)}
					{canDelete && (
						<button
							type="button"
							onClick={onDelete}
							className="flex items-center gap-1 rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
						>
							<Trash2 className="h-3.5 w-3.5" />
							{t('common.delete')}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function ManageProjectsContent() {
	const { user } = useAuthContext();
	const { t } = useTranslation();
	const canEdit = hasPermission(
		user?.permissions ?? 0,
		Permissions.TRACKING_LINK_EDIT,
	);
	const canAnalytics = hasPermission(
		user?.permissions ?? 0,
		Permissions.TRACKING_LINK_ANALYTICS,
	);
	const canDelete = hasPermission(
		user?.permissions ?? 0,
		Permissions.TRACKING_LINK_DELETE,
	);

	const [projects, setProjects] = useState<Project[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentPage, setCurrentPage] = useState(1);
	const [downloadingId, setDownloadingId] = useState<string | null>(null);
	const [editingProject, setEditingProject] = useState<Project | null>(null);
	const [editName, setEditName] = useState('');
	const [editUrl, setEditUrl] = useState('');
	const [isSaving, setIsSaving] = useState(false);

	const fetchProjects = useCallback(
		async (page: number) => {
			setIsLoading(true);
			setError(null);
			try {
				const res = await authFetch(
					`${TRACKING_LINK_API_URL}/projects?page=${page}&limit=${PAGE_SIZE}`,
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				setProjects(Array.isArray(data.data) ? data.data : []);
				setTotal(typeof data.total === 'number' ? data.total : 0);
			} catch (e) {
				setError(e instanceof Error ? e.message : t('common.genericError'));
			} finally {
				setIsLoading(false);
			}
		},
		[t],
	);

	useEffect(() => {
		fetchProjects(currentPage);
	}, [fetchProjects, currentPage]);

	const handleDownloadCsv = async (project: Project) => {
		setDownloadingId(project.projectId);
		setError(null);
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/${project.projectId}/access-logs/csv`,
			);
			if (!res.ok) {
				throw new Error(
					res.status === 403
						? t('csvExport.disabled')
						: t('csvExport.downloadFailed'),
				);
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `access-logs-${project.projectId}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('csvExport.downloadFailed'));
		} finally {
			setDownloadingId(null);
		}
	};

	const openEditForm = (project: Project) => {
		setEditingProject(project);
		setEditName(project.name);
		setEditUrl(project.destinationUrl);
	};

	const closeEditForm = () => {
		setEditingProject(null);
		setEditName('');
		setEditUrl('');
	};

	const handleEditSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!editingProject) return;
		const projectName = editName.trim();
		const destinationUrl = editUrl.trim();
		if (!projectName || !destinationUrl) return;

		setIsSaving(true);
		setError(null);
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/${editingProject.projectId}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ projectName, destinationUrl }),
				},
			);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(
					(data as { error?: string }).error ?? `HTTP ${res.status}`,
				);
			}
			closeEditForm();
			await fetchProjects(currentPage);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('projects.editFailed'));
		} finally {
			setIsSaving(false);
		}
	};

	const handleDeleteProject = async (projectId: string) => {
		if (!confirm(t('projects.deleteConfirm'))) return;
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/${projectId}`,
				{ method: 'DELETE' },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await fetchProjects(currentPage);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('projects.deleteFailed'));
		}
	};

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<div className="container mx-auto max-w-6xl p-4 md:p-6">
			<div className="mb-6 flex items-center justify-between gap-3">
				<h1 className="text-xl md:text-2xl font-bold">
					{t('projects.heading')}
				</h1>
				{canEdit && (
					<Link
						to="/links/create"
						className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 md:px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
					>
						<Plus className="h-4 w-4" />
						{t('nav.newProject')}
					</Link>
				)}
			</div>

			{error && (
				<div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-4">
					<p className="text-sm text-destructive">{error}</p>
				</div>
			)}

			{canEdit && editingProject && (
				<div className="mb-6 rounded-lg border bg-card p-4 md:p-5 shadow-sm">
					<h2 className="mb-4 font-semibold">{t('projects.editFormTitle')}</h2>
					<form onSubmit={handleEditSubmit} className="space-y-3">
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5">
								<label
									htmlFor="editProjectName"
									className="block text-sm font-medium"
								>
									{t('createProject.nameLabel')}
								</label>
								<input
									id="editProjectName"
									type="text"
									value={editName}
									onChange={(e) => setEditName(e.target.value)}
									placeholder={t('createProject.namePlaceholder')}
									required
									className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
							<div className="space-y-1.5">
								<label
									htmlFor="editDestinationUrl"
									className="block text-sm font-medium"
								>
									{t('createProject.urlLabel')}
								</label>
								<input
									id="editDestinationUrl"
									type="url"
									value={editUrl}
									onChange={(e) => setEditUrl(e.target.value)}
									placeholder={t('createProject.urlPlaceholder')}
									required
									className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<button
								type="submit"
								disabled={isSaving}
								className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
							>
								{isSaving && <Loader className="h-4 w-4 animate-spin" />}
								{t('common.save')}
							</button>
							<button
								type="button"
								onClick={closeEditForm}
								className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
							>
								{t('common.cancel')}
							</button>
						</div>
					</form>
				</div>
			)}

			<div className="rounded-lg border bg-card shadow-sm">
				<div className="border-b p-4 md:p-5">
					<h2 className="font-semibold">{t('projects.cardTitle')}</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">
						{isLoading
							? t('common.loading')
							: t('common.totalCount', { total })}
					</p>
				</div>

				{isLoading ? (
					<div className="divide-y">
						{Array.from({ length: 5 }).map((_, i) => (
							<div key={i} className="px-4 py-4 animate-pulse space-y-2">
								<div className="h-4 w-40 rounded bg-muted" />
								<div className="h-3 w-56 rounded bg-muted" />
								<div className="h-3 w-24 rounded bg-muted" />
							</div>
						))}
					</div>
				) : projects.length === 0 ? (
					<p className="px-5 py-10 text-center text-sm text-muted-foreground">
						{t('projects.empty')}
					</p>
				) : (
					<>
						{/* Mobile: card list */}
						<div className="md:hidden">
							{projects.map((project) => (
								<ProjectCard
									key={project.id}
									project={project}
									canEdit={canEdit}
									canAnalytics={canAnalytics}
									canDelete={canDelete}
									isDownloading={downloadingId === project.projectId}
									onEdit={() => openEditForm(project)}
									onDownloadCsv={() => handleDownloadCsv(project)}
									onDelete={() => handleDeleteProject(project.projectId)}
								/>
							))}
						</div>

						{/* Desktop: table */}
						<div className="hidden md:block overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b bg-muted/50">
										<th className="px-5 py-3 text-left font-medium text-muted-foreground">
											{t('common.name')}
										</th>
										<th className="px-5 py-3 text-left font-medium text-muted-foreground">
											{t('common.destinationUrl')}
										</th>
										<th className="px-5 py-3 text-left font-medium text-muted-foreground">
											{t('common.scans')}
										</th>
										<th className="px-5 py-3 text-left font-medium text-muted-foreground">
											{t('common.created')}
										</th>
										<th className="px-5 py-3 text-left font-medium text-muted-foreground">
											{t('common.actions')}
										</th>
									</tr>
								</thead>
								<tbody>
									{projects.map((project) => (
										<tr
											key={project.id}
											className="border-b last:border-0 hover:bg-muted/30 transition-colors"
										>
											<td className="px-5 py-3 font-medium">{project.name}</td>
											<td className="px-5 py-3 max-w-xs">
												<a
													href={project.destinationUrl}
													target="_blank"
													rel="noopener noreferrer"
													className="flex items-center gap-1 text-primary hover:underline truncate"
												>
													<span className="truncate">
														{project.destinationUrl}
													</span>
													<ExternalLink className="h-3 w-3 flex-shrink-0" />
												</a>
											</td>
											<td className="px-5 py-3">
												<span className="flex items-center gap-1.5 text-sm tabular-nums">
													<ScanLine className="h-3.5 w-3.5 text-muted-foreground" />
													{project.accessCount.toLocaleString()}
												</span>
											</td>
											<td className="px-5 py-3 text-muted-foreground">
												{project.createdAt
													? new Date(project.createdAt).toLocaleDateString()
													: '-'}
											</td>
											<td className="px-5 py-3">
												<div className="flex items-center gap-2">
													<Link
														to={`/links/${project.projectId}/qrcodes`}
														className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
													>
														<QrCode className="h-3 w-3" />
														{t('projects.qrCodesLink')}
													</Link>
													{canEdit && (
														<button
															type="button"
															onClick={() => openEditForm(project)}
															className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
														>
															<Pencil className="h-3 w-3" />
															{t('common.edit')}
														</button>
													)}
													{canAnalytics && (
														<button
															type="button"
															onClick={() => handleDownloadCsv(project)}
															disabled={downloadingId === project.projectId}
															className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-50 transition-colors"
														>
															{downloadingId === project.projectId ? (
																<Loader className="h-3 w-3 animate-spin" />
															) : (
																<Download className="h-3 w-3" />
															)}
															{t('projects.csvDownloadLink')}
														</button>
													)}
													{canDelete && (
														<button
															type="button"
															onClick={() =>
																handleDeleteProject(project.projectId)
															}
															className="flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
														>
															<Trash2 className="h-3 w-3" />
															{t('common.delete')}
														</button>
													)}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}

				<Pagination
					currentPage={currentPage}
					totalPages={totalPages}
					total={total}
					onPageChange={setCurrentPage}
				/>
			</div>
		</div>
	);
}

export default function ManageProjectsPage() {
	return (
		<PermissionGuard required={Permissions.TRACKING_LINK_VIEW}>
			<ManageProjectsContent />
		</PermissionGuard>
	);
}
