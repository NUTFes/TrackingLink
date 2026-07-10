import {
	ArrowLeft,
	ChevronLeft,
	ChevronRight,
	Loader,
	MapPin,
	Plus,
	QrCode,
	Trash2,
	X,
} from 'lucide-react';
import QRCodeLib from 'qrcode';
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuthContext } from '../components/AuthProvider';
import { PermissionGuard } from '../components/PermissionGuard';
import { TRACKING_LINK_API_URL } from '../config';
import { Permissions, hasPermission } from '../hooks/useStaffAuth';
import { authFetch } from '../lib/api';
import { useTranslation } from '../lib/i18n';

interface QRCode {
	id: string;
	projectId: string;
	location: string;
	createdAt: string;
	creatorId?: string | null;
}

interface Project {
	name: string;
	projectId: string;
}

const PAGE_SIZE = 10;
const FWD_BASE_URL = import.meta.env.VITE_FWD_BASE_URL ?? TRACKING_LINK_API_URL;

/** Generates a QR code as a data URL, client-side. */
function useQRDataUrl(text: string): {
	dataUrl: string | null;
	error: boolean;
} {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [error, setError] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setDataUrl(null);
		setError(false);
		QRCodeLib.toDataURL(text, {
			width: 300,
			margin: 2,
			errorCorrectionLevel: 'H',
		})
			.then((url) => {
				if (!cancelled) setDataUrl(url);
			})
			.catch(() => {
				if (!cancelled) setError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [text]);
	return { dataUrl, error };
}

function QRDialog({ qr, onClose }: { qr: QRCode; onClose: () => void }) {
	const { t } = useTranslation();
	const url = `${FWD_BASE_URL}/?id=${qr.id}`;
	const { dataUrl: qrDataUrl, error: qrError } = useQRDataUrl(url);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={t('qrCodes.dialogTitle')}
				className="relative rounded-lg border bg-card p-6 shadow-xl w-full max-w-sm mx-4"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-4">
					<div>
						<h3 className="font-semibold">{t('qrCodes.dialogTitle')}</h3>
						<p className="text-xs text-muted-foreground mt-0.5">
							{qr.location}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label={t('common.close')}
						className="rounded-md p-1 hover:bg-muted/50 transition-colors"
					>
						<X className="h-4 w-4 text-muted-foreground" />
					</button>
				</div>

				<div className="flex flex-col items-center gap-3">
					<div className="relative flex h-[240px] w-[240px] items-center justify-center rounded-md border bg-muted/20">
						{!qrDataUrl && !qrError && (
							<Loader className="h-8 w-8 animate-spin text-muted-foreground" />
						)}
						{qrError && (
							<p className="text-xs text-destructive px-4 text-center">
								{t('qrCodes.generateFailed')}
							</p>
						)}
						{qrDataUrl && (
							<img
								src={qrDataUrl}
								alt={t('qrCodes.dialogTitle')}
								className="h-full w-full rounded-md object-contain"
							/>
						)}
					</div>
					<p className="text-xs font-mono text-muted-foreground break-all text-center px-2">
						{url}
					</p>
				</div>

				{qrDataUrl && (
					<a
						href={qrDataUrl}
						download={`qr-${qr.id}.png`}
						className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
					>
						{t('qrCodes.downloadButton')}
					</a>
				)}
			</div>
		</div>
	);
}

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

function QRCard({
	qr,
	onView,
	onDelete,
	canDeleteThis,
}: {
	qr: QRCode;
	onView: () => void;
	onDelete: () => void;
	canDeleteThis: boolean;
}) {
	const { t } = useTranslation();
	return (
		<div className="border-b last:border-0 px-4 py-4 hover:bg-muted/30 transition-colors">
			<div className="flex items-start justify-between gap-2 mb-3">
				<span className="flex items-center gap-1.5 text-sm font-medium leading-snug">
					<MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
					{qr.location}
				</span>
				<span className="text-xs text-muted-foreground shrink-0">
					{qr.createdAt ? new Date(qr.createdAt).toLocaleDateString() : '-'}
				</span>
			</div>
			<div className="flex items-center justify-end gap-2">
				<button
					type="button"
					onClick={onView}
					className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
				>
					<QrCode className="h-3.5 w-3.5" />
					{t('qrCodes.showButton')}
				</button>
				{canDeleteThis && (
					<button
						type="button"
						onClick={onDelete}
						className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
					>
						<Trash2 className="h-3.5 w-3.5" />
						{t('common.delete')}
					</button>
				)}
			</div>
		</div>
	);
}

function QRCodesContent() {
	const { user } = useAuthContext();
	const { t } = useTranslation();
	const canEdit = hasPermission(
		user?.permissions ?? 0,
		Permissions.TRACKING_LINK_EDIT,
	);
	const canDelete = hasPermission(
		user?.permissions ?? 0,
		Permissions.TRACKING_LINK_DELETE,
	);
	// EDIT permission: can only delete your own QR codes. DELETE permission: can delete any.
	const canDeleteQR = (qr: QRCode) =>
		canDelete || (canEdit && qr.creatorId === user?.sub);
	const { id: projectId } = useParams<{ id: string }>();
	const [project, setProject] = useState<Project | null>(null);
	const [qrCodes, setQrCodes] = useState<QRCode[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [newLocation, setNewLocation] = useState('');
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [currentPage, setCurrentPage] = useState(1);
	const [dialogQR, setDialogQR] = useState<QRCode | null>(null);

	const fetchData = useCallback(
		async (page: number) => {
			if (!projectId) return;
			setIsLoading(true);
			setError(null);
			try {
				const [projectRes, qrRes] = await Promise.all([
					authFetch(`${TRACKING_LINK_API_URL}/projects/${projectId}`),
					authFetch(
						`${TRACKING_LINK_API_URL}/projects/${projectId}/qrcodes?page=${page}&limit=${PAGE_SIZE}`,
					),
				]);
				if (projectRes.ok) {
					const p = await projectRes.json();
					setProject(p as Project);
				}
				if (!qrRes.ok) throw new Error(`HTTP ${qrRes.status}`);
				const data = await qrRes.json();
				setQrCodes(Array.isArray(data.data) ? data.data : []);
				setTotal(typeof data.total === 'number' ? data.total : 0);
			} catch (e) {
				setError(e instanceof Error ? e.message : t('common.genericError'));
			} finally {
				setIsLoading(false);
			}
		},
		[projectId, t],
	);

	useEffect(() => {
		fetchData(currentPage);
	}, [fetchData, currentPage]);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		if (!projectId) return;
		setIsCreating(true);
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/${projectId}/qrcodes`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ location: newLocation.trim() || 'unset' }),
				},
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setNewLocation('');
			setShowCreateForm(false);
			if (currentPage === 1) {
				await fetchData(1);
			} else {
				setCurrentPage(1);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : t('qrCodes.createFailed'));
		} finally {
			setIsCreating(false);
		}
	};

	const handleDelete = async (qrId: string) => {
		if (!confirm(t('qrCodes.deleteConfirm'))) return;
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/qrcodes/${qrId}`,
				{ method: 'DELETE' },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const newTotal = total - 1;
			const newTotalPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
			const targetPage = Math.min(currentPage, newTotalPages);
			if (targetPage !== currentPage) {
				setCurrentPage(targetPage);
			} else {
				await fetchData(currentPage);
			}
			setTotal(newTotal);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('qrCodes.deleteFailed'));
		}
	};

	const totalPages = useMemo(
		() => Math.max(1, Math.ceil(total / PAGE_SIZE)),
		[total],
	);

	return (
		<div className="container mx-auto max-w-4xl p-4 md:p-6">
			<div className="mb-4 md:mb-6">
				<Link
					to="/links"
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
					{t('common.backToProjects')}
				</Link>
			</div>

			<div className="mb-6 flex items-start justify-between gap-3">
				<div>
					<h1 className="text-xl md:text-2xl font-bold">
						{t('qrCodes.heading')}
					</h1>
					{project && (
						<p className="mt-1 text-sm text-muted-foreground">
							{t('qrCodes.projectLabel', { name: project.name })}
						</p>
					)}
				</div>
				{canEdit && (
					<button
						type="button"
						onClick={() => setShowCreateForm((v) => !v)}
						className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 md:px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
					>
						<Plus className="h-4 w-4" />
						{t('qrCodes.newButton')}
					</button>
				)}
			</div>

			{error && (
				<div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-4">
					<p className="text-sm text-destructive">{error}</p>
				</div>
			)}

			{canEdit && showCreateForm && (
				<div className="mb-6 rounded-lg border bg-card p-4 md:p-5 shadow-sm">
					<h2 className="mb-4 font-semibold">{t('qrCodes.newFormTitle')}</h2>
					<form onSubmit={handleCreate} className="flex items-end gap-3">
						<div className="flex-1 space-y-1.5">
							<label htmlFor="location" className="block text-sm font-medium">
								{t('qrCodes.locationLabel')}
							</label>
							<input
								id="location"
								type="text"
								value={newLocation}
								onChange={(e) => setNewLocation(e.target.value)}
								placeholder={t('qrCodes.locationPlaceholder')}
								className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<button
							type="submit"
							disabled={isCreating}
							className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
						>
							{isCreating && <Loader className="h-4 w-4 animate-spin" />}
							{t('common.add')}
						</button>
					</form>
				</div>
			)}

			<div className="rounded-lg border bg-card shadow-sm">
				<div className="border-b p-4 md:p-5">
					<h2 className="font-semibold">{t('qrCodes.cardTitle')}</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">
						{isLoading
							? t('common.loading')
							: t('common.totalCount', { total })}
					</p>
				</div>

				{isLoading ? (
					<div className="flex items-center justify-center py-16">
						<Loader className="h-8 w-8 animate-spin text-primary" />
					</div>
				) : qrCodes.length === 0 ? (
					<p className="px-5 py-10 text-center text-sm text-muted-foreground">
						{t('qrCodes.empty')}
					</p>
				) : (
					<>
						{/* Mobile: card list */}
						<div className="md:hidden">
							{qrCodes.map((qr) => (
								<QRCard
									key={qr.id}
									qr={qr}
									onView={() => setDialogQR(qr)}
									onDelete={() => handleDelete(qr.id)}
									canDeleteThis={canDeleteQR(qr)}
								/>
							))}
						</div>

						{/* Desktop: table */}
						<div className="hidden md:block overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b bg-muted/50">
										<th className="px-5 py-3 text-left font-medium text-muted-foreground">
											{t('qrCodes.qrIdHeader')}
										</th>
										<th className="px-5 py-3 text-left font-medium text-muted-foreground">
											{t('common.location')}
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
									{qrCodes.map((qr) => (
										<tr
											key={qr.id}
											className="border-b last:border-0 hover:bg-muted/30 transition-colors"
										>
											<td className="px-5 py-3 font-mono text-xs">
												{qr.id.slice(0, 12)}…
											</td>
											<td className="px-5 py-3">
												<span className="flex items-center gap-1.5">
													<MapPin className="h-3.5 w-3.5 text-muted-foreground" />
													{qr.location}
												</span>
											</td>
											<td className="px-5 py-3 text-muted-foreground">
												{qr.createdAt
													? new Date(qr.createdAt).toLocaleString()
													: '-'}
											</td>
											<td className="px-5 py-3">
												<div className="flex items-center gap-2">
													<button
														type="button"
														onClick={() => setDialogQR(qr)}
														className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
													>
														<QrCode className="h-3 w-3" />
														{t('common.show')}
													</button>
													{canDeleteQR(qr) && (
														<button
															type="button"
															onClick={() => handleDelete(qr.id)}
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

						<Pagination
							currentPage={currentPage}
							totalPages={totalPages}
							total={total}
							onPageChange={setCurrentPage}
						/>
					</>
				)}
			</div>

			{dialogQR && <QRDialog qr={dialogQR} onClose={() => setDialogQR(null)} />}
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
