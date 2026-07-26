import {
	Download,
	ExternalLink,
	Loader2,
	Pencil,
	Plus,
	QrCode,
	ScanLine,
	Trash2,
} from 'lucide-react';
import { type FormEvent, useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { PermissionGuard } from '../components/PermissionGuard';
import { useToast } from '../components/ToastProvider';
import { TRACKING_LINK_API_URL } from '../config';
import { useApiErrorMessage } from '../hooks/useApiError';
import {
	useFieldErrors,
	validateFallbackKey,
	validateHttpUrl,
} from '../hooks/useFieldErrors';
import { useListQuery } from '../hooks/useListQuery';
import { Permissions, hasPermission } from '../hooks/useStaffAuth';
import { ApiError, assertOk, authFetch } from '../lib/api';
import { downloadBlob } from '../lib/download';
import { formatDateTime, slugForFilename } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import { deriveFallbackKey } from '../lib/qr';
import {
	btnPrimary,
	btnRow,
	btnRowDestructive,
	btnSecondary,
	fieldErrorText,
	inputBase,
	labelBase,
} from '../lib/styles';

interface Project {
	id: string;
	projectId: string;
	name: string;
	destinationUrl: string;
	fallbackKey: string;
	createdAt: string;
	adminUserId: string;
	accessCount: number;
	qrCodeCount: number;
}

const PAGE_SIZE = 10;
const NAME_MAX = 200;
const URL_MAX = 2048;
const FALLBACK_KEY_MAX = 40;

/**
 * One in-flight row action at a time.
 *
 * A single `pendingAction` rather than parallel `downloadingId` / `deletingId`
 * flags — which is also the answer to the PR #1 review note about
 * `downloadingId` looking unnecessary. It is necessary (it drives the per-row
 * spinner), and delete needed the same thing: without it the delete button was
 * never disabled, so a double-tap fired two DELETEs and the second 404'd,
 * showing an error *after* a successful delete.
 */
type PendingAction = { projectId: string; kind: 'csv' | 'delete' } | null;

function ProjectRowActions({
	project,
	canEdit,
	canAnalytics,
	canDelete,
	pending,
	onEdit,
	onDownloadCsv,
	onDelete,
}: {
	project: Project;
	canEdit: boolean;
	canAnalytics: boolean;
	canDelete: boolean;
	pending: PendingAction;
	onEdit: () => void;
	onDownloadCsv: () => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const isDownloading =
		pending?.projectId === project.projectId && pending.kind === 'csv';
	const isDeleting =
		pending?.projectId === project.projectId && pending.kind === 'delete';

	return (
		// A 2-column grid on a phone: four labelled 44px buttons cannot fit one row
		// at 375px, and the previous `flex gap-2` had no wrap at all.
		<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
			<Link to={`/links/${project.projectId}/qrcodes`} className={btnRow}>
				<QrCode className="h-3.5 w-3.5" />
				{t('projects.qrCodesLink')}
			</Link>
			{canEdit && (
				<button type="button" onClick={onEdit} className={btnRow}>
					<Pencil className="h-3.5 w-3.5" />
					{t('common.edit')}
				</button>
			)}
			{canAnalytics && (
				<button
					type="button"
					onClick={onDownloadCsv}
					disabled={isDownloading}
					className={btnRow}
				>
					{isDownloading ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
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
					disabled={isDeleting}
					className={btnRowDestructive}
				>
					{isDeleting ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Trash2 className="h-3.5 w-3.5" />
					)}
					{t('common.delete')}
				</button>
			)}
		</div>
	);
}

function ManageProjectsContent() {
	const { user } = useAuthContext();
	const { t, locale } = useTranslation();
	const toast = useToast();
	const describeError = useApiErrorMessage();
	const permissions = user?.permissions ?? 0;
	const canEdit = hasPermission(permissions, Permissions.TRACKING_LINK_EDIT);
	const canAnalytics = hasPermission(
		permissions,
		Permissions.TRACKING_LINK_ANALYTICS,
	);
	const canDelete = hasPermission(
		permissions,
		Permissions.TRACKING_LINK_DELETE,
	);

	const buildUrl = useCallback(
		(page: number) =>
			`${TRACKING_LINK_API_URL}/projects?page=${page}&limit=${PAGE_SIZE}`,
		[],
	);
	const list = useListQuery<Project>(buildUrl, PAGE_SIZE);

	const [pending, setPending] = useState<PendingAction>(null);
	const [editing, setEditing] = useState<Project | null>(null);
	const [editName, setEditName] = useState('');
	const [editUrl, setEditUrl] = useState('');
	const [editFallbackKey, setEditFallbackKey] = useState('');
	// Stops the destination URL from overwriting a keyword the user chose by hand —
	// the value ends up printed on posters, so a silent overwrite is worse than no
	// suggestion at all.
	const fallbackKeyTouched = useRef(false);
	const [isSaving, setIsSaving] = useState(false);
	const [confirmTarget, setConfirmTarget] = useState<Project | null>(null);
	const {
		errors,
		validate,
		clear: clearErrors,
		setFromFields,
	} = useFieldErrors();

	const isDirty =
		editing !== null &&
		(editName !== editing.name ||
			editUrl !== editing.destinationUrl ||
			editFallbackKey !== editing.fallbackKey);

	const openEdit = (project: Project) => {
		setEditing(project);
		setEditName(project.name);
		setEditUrl(project.destinationUrl);
		setEditFallbackKey(project.fallbackKey);
		// An existing project already has a considered value (even a blank one), so
		// the URL must not start rewriting it just because the form opened.
		fallbackKeyTouched.current = true;
		clearErrors();
	};

	const onEditUrlChange = (value: string) => {
		setEditUrl(value);
		if (!fallbackKeyTouched.current)
			setEditFallbackKey(deriveFallbackKey(value));
	};

	const closeEdit = () => {
		setEditing(null);
		setEditName('');
		setEditUrl('');
		setEditFallbackKey('');
		fallbackKeyTouched.current = false;
		clearErrors();
	};

	const requestCloseEdit = () => {
		if (isDirty && !window.confirm(t('common.discardChanges'))) return;
		closeEdit();
	};

	const handleEditSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!editing || isSaving) return;
		const ok = validate({
			projectName: {
				id: 'editProjectName',
				value: editName,
				required: true,
				maxLength: NAME_MAX,
			},
			destinationUrl: {
				id: 'editProjectUrl',
				value: editUrl,
				required: true,
				maxLength: URL_MAX,
				validate: validateHttpUrl,
			},
			fallbackKey: {
				id: 'editProjectFallbackKey',
				value: editFallbackKey,
				maxLength: FALLBACK_KEY_MAX,
				validate: validateFallbackKey,
			},
		});
		if (!ok) return;

		setIsSaving(true);
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/${editing.projectId}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						projectName: editName.trim(),
						destinationUrl: editUrl.trim(),
						fallbackKey: editFallbackKey.trim(),
					}),
				},
			);
			await assertOk(res);
			closeEdit();
			await list.refresh();
			toast.success(t('projects.updated'));
		} catch (err) {
			if (err instanceof ApiError && err.fields.length) {
				setFromFields(err.fields, describeError(err));
			}
			// Routed to a toast rather than form-local state, so the message survives
			// the form closing.
			toast.error(describeError(err));
		} finally {
			setIsSaving(false);
		}
	};

	const handleDownloadCsv = async (project: Project) => {
		setPending({ projectId: project.projectId, kind: 'csv' });
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/${project.projectId}/access-logs/csv`,
			);
			await assertOk(res);
			const blob = await res.blob();
			// Named from the project rather than its UUID, and saved through a helper
			// that actually works — the old inline anchor was never appended to the
			// document and revoked its URL synchronously, so in some browsers the
			// download simply never happened and nothing was reported.
			downloadBlob(blob, `${slugForFilename('access-logs', project.name)}.csv`);
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			setPending(null);
		}
	};

	const handleConfirmDelete = async () => {
		if (!confirmTarget) return;
		const target = confirmTarget;
		setPending({ projectId: target.projectId, kind: 'delete' });
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/${target.projectId}`,
				{ method: 'DELETE' },
			);
			await assertOk(res);
			setConfirmTarget(null);
			// The hook re-reads total from the server and clamps the page, so deleting
			// the only row on the last page lands on a page that exists instead of an
			// empty list with no way back.
			await list.refresh();
			toast.success(t('projects.deleted'));
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			setPending(null);
		}
	};

	const showEmpty = !list.isLoading && !list.error && list.items.length === 0;

	return (
		<div className="mx-auto max-w-6xl p-4 sm:p-6">
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-xl font-bold">{t('projects.cardTitle')}</h1>
					<p className="mt-0.5 text-sm text-muted-foreground">
						{t('common.totalCount', { total: list.total })}
					</p>
				</div>
				{canEdit && (
					<Link to="/links/create" className={btnPrimary}>
						<Plus className="h-4 w-4" />
						{t('nav.newProject')}
					</Link>
				)}
			</div>

			<div className="overflow-hidden rounded-lg border bg-card shadow-sm">
				{list.isLoading ? (
					<div
						role="status"
						aria-live="polite"
						className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"
					>
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						{t('common.loading')}
					</div>
				) : list.error ? (
					// Gated so the error and "no projects yet" can never appear together —
					// that combination implied the user's data had been deleted.
					<div className="flex flex-col items-center gap-3 p-10 text-center">
						<p role="alert" className="text-sm text-destructive">
							{list.error}
						</p>
						<button
							type="button"
							onClick={() => void list.refresh()}
							className={btnSecondary}
						>
							{t('common.retry')}
						</button>
					</div>
				) : showEmpty ? (
					<div className="flex flex-col items-center gap-3 p-10 text-center">
						<QrCode
							className="h-8 w-8 text-muted-foreground"
							aria-hidden="true"
						/>
						<p className="text-sm text-muted-foreground">
							{t('projects.empty')}
						</p>
						{canEdit && (
							<Link to="/links/create" className={btnPrimary}>
								<Plus className="h-4 w-4" />
								{t('projects.emptyCta')}
							</Link>
						)}
					</div>
				) : (
					<ul className="divide-y divide-border">
						{list.items.map((project) => (
							<li
								key={project.projectId}
								className="p-4 transition-colors hover:bg-muted/30"
							>
								<div className="mb-2 flex items-start justify-between gap-3">
									<p className="min-w-0 break-words text-sm font-medium leading-snug">
										{project.name}
									</p>
									<span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
										{/* Labelled text, not a `title` attribute: title is
										    unavailable on touch and inconsistently exposed to
										    assistive tech, so these numbers were unlabelled on the
										    device this app is used on. */}
										<span className="flex items-center gap-1">
											<QrCode className="h-3.5 w-3.5" aria-hidden="true" />
											<span className="sr-only">
												{t('common.qrCodeCount')}:{' '}
											</span>
											{project.qrCodeCount.toLocaleString()}
										</span>
										<span className="flex items-center gap-1">
											<ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
											<span className="sr-only">{t('common.scans')}: </span>
											{project.accessCount.toLocaleString()}
										</span>
									</span>
								</div>

								<a
									href={project.destinationUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="mb-3 flex min-w-0 items-center gap-1 text-xs text-primary hover:underline"
								>
									<span className="truncate">{project.destinationUrl}</span>
									<ExternalLink className="h-3 w-3 shrink-0" />
								</a>

								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<span className="text-xs text-muted-foreground">
										{t('common.created')}:{' '}
										{formatDateTime(project.createdAt, locale)}
									</span>
									<ProjectRowActions
										project={project}
										canEdit={canEdit}
										canAnalytics={canAnalytics}
										canDelete={canDelete}
										pending={pending}
										onEdit={() => openEdit(project)}
										onDownloadCsv={() => void handleDownloadCsv(project)}
										onDelete={() => setConfirmTarget(project)}
									/>
								</div>
							</li>
						))}
					</ul>
				)}

				{!list.error && !showEmpty ? (
					<Pagination
						page={list.page}
						totalPages={list.totalPages}
						total={list.total}
						pageSize={PAGE_SIZE}
						shownCount={list.items.length}
						isLoading={list.isLoading}
						onPageChange={list.setPage}
					/>
				) : null}
			</div>

			{/* A modal rather than a panel rendered above the table: clicking Edit on
			    row 8 used to open a form off-screen with no scroll or focus move, so
			    visually nothing happened and the button looked broken. */}
			<Modal
				open={editing !== null}
				onClose={requestCloseEdit}
				title={t('projects.editFormTitle')}
				dismissible={!isSaving}
				footer={
					<div className="grid grid-cols-2 gap-2">
						<button
							type="button"
							onClick={requestCloseEdit}
							// Disabled mid-save: cancelling used to unmount the form while the
							// request was still running, and the failure was then written to
							// state nobody was rendering.
							disabled={isSaving}
							className={btnSecondary}
						>
							{t('common.cancel')}
						</button>
						<button
							type="submit"
							form="edit-project-form"
							disabled={isSaving}
							className={btnPrimary}
						>
							{isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
							{isSaving ? t('common.saving') : t('common.save')}
						</button>
					</div>
				}
			>
				<form
					id="edit-project-form"
					onSubmit={handleEditSubmit}
					noValidate
					className="space-y-4"
				>
					<div className="space-y-1.5">
						<label htmlFor="editProjectName" className={labelBase}>
							{t('common.name')}
						</label>
						<input
							id="editProjectName"
							type="text"
							value={editName}
							onChange={(e) => setEditName(e.target.value)}
							onBlur={() => setEditName((v) => v.trim())}
							maxLength={NAME_MAX}
							disabled={isSaving}
							aria-invalid={errors.projectName ? true : undefined}
							aria-describedby={
								errors.projectName ? 'editProjectName-error' : undefined
							}
							className={inputBase}
						/>
						{errors.projectName ? (
							<p id="editProjectName-error" className={fieldErrorText}>
								{errors.projectName}
							</p>
						) : null}
					</div>
					<div className="space-y-1.5">
						<label htmlFor="editProjectUrl" className={labelBase}>
							{t('common.destinationUrl')}
						</label>
						<input
							id="editProjectUrl"
							type="text"
							inputMode="url"
							value={editUrl}
							onChange={(e) => onEditUrlChange(e.target.value)}
							onBlur={() => setEditUrl((v) => v.trim())}
							maxLength={URL_MAX}
							disabled={isSaving}
							aria-invalid={errors.destinationUrl ? true : undefined}
							aria-describedby={
								errors.destinationUrl ? 'editProjectUrl-error' : undefined
							}
							className={inputBase}
						/>
						{errors.destinationUrl ? (
							<p id="editProjectUrl-error" className={fieldErrorText}>
								{errors.destinationUrl}
							</p>
						) : null}
					</div>
					<div className="space-y-1.5">
						<label htmlFor="editProjectFallbackKey" className={labelBase}>
							{t('projects.fallbackKeyLabel')}{' '}
							<span className="font-normal text-muted-foreground">
								({t('common.optional')})
							</span>
						</label>
						<input
							id="editProjectFallbackKey"
							type="text"
							value={editFallbackKey}
							onChange={(e) => {
								fallbackKeyTouched.current = true;
								setEditFallbackKey(e.target.value);
							}}
							onBlur={() => setEditFallbackKey((v) => v.trim())}
							placeholder={t('projects.fallbackKeyPlaceholder')}
							maxLength={FALLBACK_KEY_MAX}
							disabled={isSaving}
							aria-invalid={errors.fallbackKey ? true : undefined}
							aria-describedby={
								errors.fallbackKey
									? 'editProjectFallbackKey-error'
									: 'editProjectFallbackKey-hint'
							}
							className={inputBase}
						/>
						{errors.fallbackKey ? (
							<p id="editProjectFallbackKey-error" className={fieldErrorText}>
								{errors.fallbackKey}
							</p>
						) : (
							<p
								id="editProjectFallbackKey-hint"
								className="text-xs text-muted-foreground"
							>
								{t('projects.fallbackKeyHint')}
							</p>
						)}
					</div>
					<p className="text-xs text-muted-foreground">
						{t('projects.destinationUrlPropagation')}
					</p>
				</form>
			</Modal>

			<ConfirmDialog
				open={confirmTarget !== null}
				title={t('projects.deleteTitle')}
				// Names the project. The old confirm() said only "Delete this project?",
				// with Edit and Delete ~8px apart at 28px tall on a phone — no way to
				// verify you had hit the right row before an irreversible cascade.
				body={t('projects.deleteBody', { name: confirmTarget?.name ?? '' })}
				confirmLabel={t('common.delete')}
				pending={pending?.kind === 'delete'}
				onConfirm={() => void handleConfirmDelete()}
				onCancel={() => setConfirmTarget(null)}
			/>
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
