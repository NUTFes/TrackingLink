import {
	ArrowLeft,
	Download,
	Loader2,
	Pencil,
	Plus,
	QrCode as QrCodeIcon,
	Trash2,
} from 'lucide-react';
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { PermissionGuard } from '../components/PermissionGuard';
import { useToast } from '../components/ToastProvider';
import { TRACKING_LINK_API_URL } from '../config';
import { useApiErrorMessage } from '../hooks/useApiError';
import { useFieldErrors } from '../hooks/useFieldErrors';
import { useListQuery } from '../hooks/useListQuery';
import { Permissions, hasPermission } from '../hooks/useStaffAuth';
import { ApiError, assertOk, authFetch } from '../lib/api';
import { downloadBlob } from '../lib/download';
import { formatDateTime } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import {
	QR_CAPTION_DEFAULTS,
	type QrCaptionOptions,
	deriveFallbackKey,
	qrCaptionLines,
	qrPngBlob,
	qrPngFileName,
	qrPreviewDataUrl,
	qrTargetUrl,
} from '../lib/qr';
import { safeStorage } from '../lib/storage';
import {
	btnPrimary,
	btnRow,
	btnRowDestructive,
	btnSecondary,
	fieldErrorText,
	inputBase,
	labelBase,
} from '../lib/styles';
import { cn } from '../lib/utils';

interface QRCodeRecord {
	id: string;
	projectId: string;
	name: string;
	medium: string;
	location: string;
	createdAt: string;
	creatorId?: string | null;
}

interface Project {
	name: string;
	projectId: string;
	destinationUrl: string;
	fallbackKey: string;
}

const PAGE_SIZE = 10;
const FIELD_MAX = 200;

/** Generates a QR image client-side. Nothing about the code is ever persisted. */
function useQRDataUrl(text: string | null) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (!text) return;
		let cancelled = false;
		setDataUrl(null);
		setFailed(false);
		qrPreviewDataUrl(text)
			.then((url) => {
				if (!cancelled) setDataUrl(url);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [text]);

	return { dataUrl, failed };
}

/**
 * Row thumbnail.
 *
 * With one QR code issued per physical item, a list of otherwise identical-looking
 * rows is hard to scan; the image is the fastest way to confirm you are about to
 * edit or delete the right one. `alt=""` because the name is right next to it —
 * announcing the image again would just be noise.
 */
function QRThumbnail({
	qrId,
	fallbackKey,
}: { qrId: string; fallbackKey: string }) {
	const url = useMemo(
		() => qrTargetUrl(qrId, fallbackKey),
		[qrId, fallbackKey],
	);
	const { dataUrl } = useQRDataUrl(url);
	return (
		<div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
			{dataUrl ? (
				<img src={dataUrl} alt="" className="h-full w-full object-contain" />
			) : (
				<QrCodeIcon
					className="h-5 w-5 text-muted-foreground/40"
					aria-hidden="true"
				/>
			)}
		</div>
	);
}

const CAPTION_OPTIONS_KEY = 'tracking-link.qrCaption';

/**
 * Remembers the caption checkboxes across dialogs.
 *
 * QR codes are downloaded one at a time but printed as a batch, so the choice is
 * made once for a run of twenty and re-ticking two boxes per code would be the
 * bulk of the work. Persisting only carries a deliberate choice forward — the
 * first-run state is still QR_CAPTION_DEFAULTS, i.e. no caption.
 *
 * safeStorage rather than localStorage: this reads inside a useState initialiser,
 * and iOS Safari in private browsing throws on the getter itself.
 */
function useCaptionOptions(): [
	QrCaptionOptions,
	(next: QrCaptionOptions) => void,
] {
	const [options, setOptions] = useState<QrCaptionOptions>(() => {
		const raw = safeStorage.get(CAPTION_OPTIONS_KEY);
		if (!raw) return QR_CAPTION_DEFAULTS;
		try {
			const parsed = JSON.parse(raw) as Partial<QrCaptionOptions>;
			// Read field by field: anything absent or not a boolean falls back to the
			// default, so a hand-edited or stale value cannot switch captions on.
			return {
				includeName:
					typeof parsed.includeName === 'boolean'
						? parsed.includeName
						: QR_CAPTION_DEFAULTS.includeName,
				includeMedium:
					typeof parsed.includeMedium === 'boolean'
						? parsed.includeMedium
						: QR_CAPTION_DEFAULTS.includeMedium,
			};
		} catch {
			return QR_CAPTION_DEFAULTS;
		}
	});

	const update = useCallback((next: QrCaptionOptions) => {
		setOptions(next);
		safeStorage.set(CAPTION_OPTIONS_KEY, JSON.stringify(next));
	}, []);

	return [options, update];
}

function QRDialog({
	qr,
	fallbackKey,
	onClose,
}: {
	qr: QRCodeRecord;
	fallbackKey: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const toast = useToast();
	const url = useMemo(
		() => qrTargetUrl(qr.id, fallbackKey),
		[qr.id, fallbackKey],
	);
	const { dataUrl, failed } = useQRDataUrl(url);
	const [isDownloading, setIsDownloading] = useState(false);
	const [caption, setCaption] = useCaptionOptions();

	const captionLines = useMemo(
		() => qrCaptionLines(qr, caption),
		[qr, caption],
	);

	const handleDownload = async () => {
		setIsDownloading(true);
		try {
			// Saved via a blob. Previously this was
			// `<a href={dataUrl} download="qr-<uuid>.png">`: the file was
			// unidentifiable in a downloads folder, and on iOS Safari a data: URL
			// tends to navigate in-tab rather than save — destroying this dialog in
			// the process.
			const blob = await qrPngBlob(url, captionLines);
			downloadBlob(blob, qrPngFileName(qr.name));
		} catch (error) {
			toast.error(
				error instanceof Error
					? t('qrCodes.generateFailed')
					: t('common.genericError'),
			);
		} finally {
			setIsDownloading(false);
		}
	};

	return (
		<Modal
			open
			onClose={onClose}
			title={t('qrCodes.dialogTitle')}
			className="sm:max-w-sm"
			footer={
				<button
					type="button"
					onClick={() => void handleDownload()}
					disabled={!dataUrl || isDownloading}
					className={cn(btnPrimary, 'w-full')}
				>
					{isDownloading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Download className="h-4 w-4" />
					)}
					{t('qrCodes.downloadButton')}
				</button>
			}
		>
			<div className="flex flex-col items-center gap-3">
				<p className="w-full break-words text-center text-sm font-medium">
					{qr.name}
				</p>
				<p className="w-full break-words text-center text-xs text-muted-foreground">
					{t('common.medium')}: {qr.medium}
					{qr.location ? ` / ${t('common.location')}: ${qr.location}` : ''}
				</p>

				<div className="relative flex aspect-square w-full max-w-[260px] items-center justify-center rounded-md border bg-white">
					{!dataUrl && !failed && (
						<div role="status" aria-label={t('common.loading')}>
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					)}
					{failed && (
						<p
							role="alert"
							className="px-4 text-center text-xs text-destructive"
						>
							{t('qrCodes.generateFailed')}
						</p>
					)}
					{dataUrl && (
						<img
							src={dataUrl}
							// Names the specific code rather than the generic "QR code".
							alt={t('qrCodes.imageAlt', { name: qr.name })}
							className="h-full w-full rounded-md object-contain"
						/>
					)}
				</div>

				<fieldset className="w-full rounded border p-3">
					<legend className="px-1 text-xs font-medium text-muted-foreground">
						{t('qrCodes.captionLegend')}
					</legend>
					<div className="flex flex-col gap-2">
						<CaptionToggle
							checked={caption.includeName}
							onChange={(includeName) =>
								setCaption({ ...caption, includeName })
							}
							label={t('qrCodes.nameLabel')}
							sample={qr.name}
						/>
						<CaptionToggle
							checked={caption.includeMedium}
							onChange={(includeMedium) =>
								setCaption({ ...caption, includeMedium })
							}
							label={t('qrCodes.mediumLabel')}
							sample={[qr.medium, qr.location].filter(Boolean).join(' · ')}
						/>
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						{captionLines.length
							? t('qrCodes.captionHint')
							: t('qrCodes.captionHintNone')}
					</p>
				</fieldset>

				<div className="w-full">
					<p className="mb-1 text-xs font-medium text-muted-foreground">
						{t('qrCodes.scanUrlLabel')}
					</p>
					<p className="break-all rounded bg-muted/50 p-2 text-center font-mono text-xs">
						{url}
					</p>
				</div>
			</div>
		</Modal>
	);
}

/**
 * A caption checkbox that shows the text it would actually print.
 *
 * Without the sample the choice is abstract — "Medium" does not tell you that
 * ticking it also prints the location alongside it. Showing the exact string
 * means the bundling needs no explaining.
 */
function CaptionToggle({
	checked,
	onChange,
	label,
	sample,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	sample: string;
}) {
	return (
		<label className="flex cursor-pointer items-start gap-2 text-sm">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
			/>
			<span className="min-w-0">
				<span className="font-medium">{label}</span>
				{sample ? (
					<span className="ml-1 break-words text-muted-foreground">
						({sample})
					</span>
				) : null}
			</span>
		</label>
	);
}

function QRCodesContent() {
	const { user } = useAuthContext();
	const { t, locale } = useTranslation();
	const toast = useToast();
	const describeError = useApiErrorMessage();
	const { id: projectId } = useParams<{ id: string }>();

	const permissions = user?.permissions ?? 0;
	const canEdit = hasPermission(permissions, Permissions.TRACKING_LINK_EDIT);
	const canDelete = hasPermission(
		permissions,
		Permissions.TRACKING_LINK_DELETE,
	);
	// DELETE can remove any QR code; EDIT only its own.
	const canDeleteQR = (qr: QRCodeRecord) =>
		canDelete || (canEdit && qr.creatorId === user?.sub);

	const buildUrl = useCallback(
		(page: number) =>
			`${TRACKING_LINK_API_URL}/projects/${projectId}/qrcodes?page=${page}&limit=${PAGE_SIZE}`,
		[projectId],
	);
	const list = useListQuery<QRCodeRecord>(buildUrl, PAGE_SIZE);

	const [project, setProject] = useState<Project | null>(null);

	// What actually gets baked into the QR codes on this page. Falling back to a
	// value derived from the destination host is what lets projects created before
	// fallback_key existed carry a usable keyword with no data migration.
	const effectiveFallbackKey = project
		? project.fallbackKey || deriveFallbackKey(project.destinationUrl)
		: '';
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<QRCodeRecord | null>(null);
	const [name, setName] = useState('');
	const [medium, setMedium] = useState('');
	const [location, setLocation] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [confirmTarget, setConfirmTarget] = useState<QRCodeRecord | null>(null);
	const [dialogQR, setDialogQR] = useState<QRCodeRecord | null>(null);
	const {
		errors,
		validate,
		clear: clearErrors,
		setFromFields,
	} = useFieldErrors();

	// Separate from the list so a failure here is visible. The old code did
	// `if (projectRes.ok) { … }` with no else, so a 403/404 on the project just made
	// the subtitle quietly vanish.
	useEffect(() => {
		if (!projectId) return;
		let cancelled = false;
		authFetch(`${TRACKING_LINK_API_URL}/projects/${projectId}`)
			.then(async (res) => {
				await assertOk(res);
				const body = (await res.json()) as Project;
				if (!cancelled) setProject(body);
			})
			.catch((error: unknown) => {
				if (!cancelled) toast.error(describeError(error));
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, toast, describeError]);

	const isDirty = editing
		? name !== editing.name ||
			medium !== editing.medium ||
			location !== editing.location
		: Boolean(name || medium || location);

	const openCreate = () => {
		setEditing(null);
		setName('');
		setMedium('');
		setLocation('');
		clearErrors();
		setFormOpen(true);
	};

	const openEdit = (qr: QRCodeRecord) => {
		setEditing(qr);
		setName(qr.name);
		setMedium(qr.medium);
		setLocation(qr.location);
		clearErrors();
		setFormOpen(true);
	};

	// Guarded, because three separate paths used to wipe in-progress input with no
	// warning: opening another row's edit form, hitting "New QR code", and Cancel.
	const requestCloseForm = () => {
		if (isDirty && !window.confirm(t('common.discardChanges'))) return;
		setFormOpen(false);
		setEditing(null);
		clearErrors();
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!projectId || isSaving) return;

		const ok = validate({
			name: { id: 'qrName', value: name, required: true, maxLength: FIELD_MAX },
			medium: {
				id: 'qrMedium',
				value: medium,
				required: true,
				maxLength: FIELD_MAX,
			},
			// Not required: one QR code per item, and staff record where it went only
			// when that is useful.
			location: { id: 'qrLocation', value: location, maxLength: FIELD_MAX },
		});
		if (!ok) return;

		setIsSaving(true);
		try {
			const url = editing
				? `${TRACKING_LINK_API_URL}/projects/qrcodes/${editing.id}`
				: `${TRACKING_LINK_API_URL}/projects/${projectId}/qrcodes`;
			const res = await authFetch(url, {
				method: editing ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					medium: medium.trim(),
					location: location.trim(),
				}),
			});
			await assertOk(res);

			const wasEditing = editing !== null;
			setFormOpen(false);
			setEditing(null);
			clearErrors();
			if (wasEditing) {
				await list.refresh();
			} else {
				// New rows sort first, so page 1 is where it is.
				list.setPage(1);
				if (list.page === 1) await list.refresh();
			}
			toast.success(wasEditing ? t('qrCodes.updated') : t('qrCodes.created'));
		} catch (err) {
			if (err instanceof ApiError && err.fields.length) {
				// A 409 now says which field collided; previously the user got a
				// hardcoded Japanese sentence with nothing highlighted and had to guess.
				setFromFields(err.fields, describeError(err));
			}
			// A toast, not form-local state: cancelling mid-save unmounted the form and
			// the failure was written where nobody could see it.
			toast.error(describeError(err));
		} finally {
			setIsSaving(false);
		}
	};

	const handleConfirmDelete = async () => {
		if (!confirmTarget) return;
		const target = confirmTarget;
		setDeletingId(target.id);
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/qrcodes/${target.id}`,
				{ method: 'DELETE' },
			);
			await assertOk(res);
			setConfirmTarget(null);
			// Refresh only. The old code then ran setTotal(total - 1), clobbering the
			// count the server had just returned with one computed from a stale value.
			await list.refresh();
			toast.success(t('qrCodes.deleted'));
		} catch (err) {
			toast.error(describeError(err));
		} finally {
			setDeletingId(null);
		}
	};

	const showEmpty = !list.isLoading && !list.error && list.items.length === 0;

	return (
		<div className="mx-auto max-w-4xl p-4 sm:p-6">
			<div className="mb-4">
				<Link
					to="/links"
					className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					{t('common.backToProjects')}
				</Link>
			</div>

			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h1 className="text-xl font-bold sm:text-2xl">
						{t('qrCodes.heading')}
					</h1>
					{project && (
						<p className="mt-1 break-words text-sm text-muted-foreground">
							{t('qrCodes.projectLabel', { name: project.name })}
						</p>
					)}
				</div>
				{canEdit && (
					<button type="button" onClick={openCreate} className={btnPrimary}>
						<Plus className="h-4 w-4" />
						{t('qrCodes.newButton')}
					</button>
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
						<QrCodeIcon
							className="h-8 w-8 text-muted-foreground"
							aria-hidden="true"
						/>
						<p className="text-sm text-muted-foreground">
							{t('qrCodes.empty')}
						</p>
						{canEdit && (
							<button type="button" onClick={openCreate} className={btnPrimary}>
								<Plus className="h-4 w-4" />
								{t('qrCodes.newButton')}
							</button>
						)}
					</div>
				) : (
					// One list for every viewport, instead of a mobile-card tree and a
					// desktop-table tree that had already drifted apart — different labels
					// for the same button, different date granularity, and medium/location
					// merged into one unlabelled line on mobile.
					<ul className="divide-y divide-border">
						{list.items.map((qr) => (
							<li
								key={qr.id}
								className="p-4 transition-colors hover:bg-muted/30"
							>
								<div className="flex items-start gap-3">
									<QRThumbnail
										qrId={qr.id}
										fallbackKey={effectiveFallbackKey}
									/>
									<div className="min-w-0 flex-1">
										<p className="break-words text-sm font-medium leading-snug">
											{qr.name}
										</p>
										<dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
											<div className="flex gap-1">
												<dt>{t('common.medium')}:</dt>
												<dd className="break-words">{qr.medium}</dd>
											</div>
											{qr.location ? (
												<div className="flex min-w-0 gap-1">
													<dt>{t('common.location')}:</dt>
													<dd className="break-words">{qr.location}</dd>
												</div>
											) : null}
											<div className="flex gap-1">
												<dt>{t('common.created')}:</dt>
												<dd>{formatDateTime(qr.createdAt, locale)}</dd>
											</div>
										</dl>
									</div>
								</div>

								<div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
									<button
										type="button"
										onClick={() => setDialogQR(qr)}
										className={btnRow}
									>
										<QrCodeIcon className="h-3.5 w-3.5" />
										{t('qrCodes.showButton')}
									</button>
									{canEdit && (
										<button
											type="button"
											onClick={() => openEdit(qr)}
											className={btnRow}
										>
											<Pencil className="h-3.5 w-3.5" />
											{t('common.edit')}
										</button>
									)}
									{canDeleteQR(qr) && (
										<button
											type="button"
											onClick={() => setConfirmTarget(qr)}
											disabled={deletingId === qr.id}
											className={btnRowDestructive}
										>
											{deletingId === qr.id ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : (
												<Trash2 className="h-3.5 w-3.5" />
											)}
											{t('common.delete')}
										</button>
									)}
								</div>
							</li>
						))}
					</ul>
				)}

				{/* Outside the non-empty branch. On this page the pagination used to be
				    rendered *inside* it, so emptying a page removed the only control
				    that could get you off it. */}
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

			<Modal
				open={formOpen}
				onClose={requestCloseForm}
				title={
					editing
						? t('qrCodes.editFormTitleNamed', { name: editing.name })
						: t('qrCodes.newFormTitle')
				}
				dismissible={!isSaving}
				footer={
					<div className="grid grid-cols-2 gap-2">
						<button
							type="button"
							onClick={requestCloseForm}
							disabled={isSaving}
							className={btnSecondary}
						>
							{t('common.cancel')}
						</button>
						<button
							type="submit"
							form="qr-form"
							disabled={isSaving}
							className={btnPrimary}
						>
							{isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
							{isSaving
								? t('common.saving')
								: editing
									? t('common.save')
									: t('common.add')}
						</button>
					</div>
				}
			>
				<form
					id="qr-form"
					onSubmit={handleSubmit}
					noValidate
					className="space-y-4"
				>
					<div className="space-y-1.5">
						<label htmlFor="qrName" className={labelBase}>
							{t('qrCodes.nameLabel')}{' '}
							<span className="text-destructive">*</span>
						</label>
						<input
							id="qrName"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onBlur={() => setName((v) => v.trim())}
							placeholder={t('qrCodes.namePlaceholder')}
							maxLength={FIELD_MAX}
							disabled={isSaving}
							aria-invalid={errors.name ? true : undefined}
							aria-describedby={errors.name ? 'qrName-error' : undefined}
							className={inputBase}
						/>
						{errors.name ? (
							<p id="qrName-error" className={fieldErrorText}>
								{errors.name}
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								{t('qrCodes.nameHint')}
							</p>
						)}
					</div>

					<div className="space-y-1.5">
						<label htmlFor="qrMedium" className={labelBase}>
							{t('qrCodes.mediumLabel')}{' '}
							<span className="text-destructive">*</span>
						</label>
						<input
							id="qrMedium"
							type="text"
							value={medium}
							onChange={(e) => setMedium(e.target.value)}
							onBlur={() => setMedium((v) => v.trim())}
							placeholder={t('qrCodes.mediumPlaceholder')}
							maxLength={FIELD_MAX}
							disabled={isSaving}
							aria-invalid={errors.medium ? true : undefined}
							aria-describedby={errors.medium ? 'qrMedium-error' : undefined}
							className={inputBase}
						/>
						{errors.medium ? (
							<p id="qrMedium-error" className={fieldErrorText}>
								{errors.medium}
							</p>
						) : null}
					</div>

					<div className="space-y-1.5">
						<label htmlFor="qrLocation" className={labelBase}>
							{t('qrCodes.locationLabel')}{' '}
							<span className="font-normal text-muted-foreground">
								({t('common.optional')})
							</span>
						</label>
						<input
							id="qrLocation"
							type="text"
							value={location}
							onChange={(e) => setLocation(e.target.value)}
							onBlur={() => setLocation((v) => v.trim())}
							placeholder={t('qrCodes.locationPlaceholder')}
							maxLength={FIELD_MAX}
							disabled={isSaving}
							aria-invalid={errors.location ? true : undefined}
							aria-describedby={
								errors.location ? 'qrLocation-error' : undefined
							}
							className={inputBase}
						/>
						{errors.location ? (
							<p id="qrLocation-error" className={fieldErrorText}>
								{errors.location}
							</p>
						) : null}
					</div>
				</form>
			</Modal>

			<ConfirmDialog
				open={confirmTarget !== null}
				title={t('qrCodes.deleteTitle')}
				body={t('qrCodes.deleteBody', { name: confirmTarget?.name ?? '' })}
				confirmLabel={t('common.delete')}
				pending={deletingId !== null}
				onConfirm={() => void handleConfirmDelete()}
				onCancel={() => setConfirmTarget(null)}
			/>

			{dialogQR ? (
				<QRDialog
					qr={dialogQR}
					fallbackKey={effectiveFallbackKey}
					onClose={() => setDialogQR(null)}
				/>
			) : null}
		</div>
	);
}

export default function QRCodesPage() {
	return (
		<PermissionGuard required={Permissions.TRACKING_LINK_VIEW}>
			<QRCodesContent />
		</PermissionGuard>
	);
}
