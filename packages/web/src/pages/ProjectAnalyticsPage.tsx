import {
	ArrowLeft,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Loader,
} from 'lucide-react';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { PermissionGuard } from '../components/PermissionGuard';
import { TRACKING_LINK_API_URL } from '../config';
import { Permissions } from '../hooks/useStaffAuth';
import { authFetch } from '../lib/api';
import { useTranslation } from '../lib/i18n';

interface AccessLog {
	qrId: string;
	projectId: string;
	accessedAt: string;
	ipAddress: string | null;
	location: string;
}

interface StatRow {
	hour: number;
	location: string;
	count: number;
}

function hourLabel(h: number) {
	return `${String(h).padStart(2, '0')}:00`;
}

const LOCATION_COLORS = [
	'#6366f1',
	'#f59e0b',
	'#10b981',
	'#ef4444',
	'#3b82f6',
	'#ec4899',
	'#8b5cf6',
	'#14b8a6',
];

const LOG_PAGE_SIZE = 10;

function BarTooltip({
	active,
	payload,
	label,
}: {
	active?: boolean;
	payload?: Array<{ name: string; value: number; fill: string }>;
	label?: string;
}) {
	if (!active || !payload?.length) return null;
	const items = payload.filter((p) => p.value > 0);
	if (items.length === 0) return null;
	return (
		<div className="rounded-lg border bg-popover px-3 py-2 shadow-lg text-sm min-w-32">
			<p className="mb-1.5 font-medium text-popover-foreground">{label}</p>
			{items.map((entry) => (
				<div
					key={entry.name}
					className="flex items-center gap-1.5 text-popover-foreground"
				>
					<span
						className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
						style={{ background: entry.fill }}
					/>
					<span>
						{entry.name}: {entry.value}
					</span>
				</div>
			))}
		</div>
	);
}

function Accordion({
	title,
	description,
	children,
	defaultOpen = true,
}: {
	title: string;
	description?: string;
	children: ReactNode;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="rounded-lg border bg-card shadow-sm overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors"
			>
				<div>
					<p className="font-semibold">{title}</p>
					{description && (
						<p className="mt-0.5 text-xs text-muted-foreground">
							{description}
						</p>
					)}
				</div>
				<ChevronDown
					className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
				/>
			</button>
			{open && <div className="border-t">{children}</div>}
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
	const start = (currentPage - 1) * LOG_PAGE_SIZE + 1;
	const end = Math.min(currentPage * LOG_PAGE_SIZE, total);
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

function ProjectAnalyticsContent() {
	const { id } = useParams<{ id: string }>();
	const { t } = useTranslation();
	const [projectName, setProjectName] = useState<string>('');
	const [stats, setStats] = useState<StatRow[]>([]);
	const [logs, setLogs] = useState<AccessLog[]>([]);
	const [logTotal, setLogTotal] = useState(0);
	const [logPage, setLogPage] = useState(1);
	const [isLoadingStats, setIsLoadingStats] = useState(false);
	const [isLoadingLogs, setIsLoadingLogs] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchStats = useCallback(async () => {
		if (!id) return;
		setIsLoadingStats(true);
		try {
			const [projectRes, statsRes] = await Promise.all([
				authFetch(`${TRACKING_LINK_API_URL}/projects/${id}`),
				authFetch(`${TRACKING_LINK_API_URL}/projects/${id}/access-stats`),
			]);
			if (projectRes.ok) {
				const project = await projectRes.json();
				setProjectName((project as { name?: string }).name ?? id ?? '');
			}
			if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
			const data = await statsRes.json();
			setStats(Array.isArray(data) ? data : []);
		} catch (e) {
			setError(e instanceof Error ? e.message : t('common.genericError'));
		} finally {
			setIsLoadingStats(false);
		}
	}, [id, t]);

	const fetchLogs = useCallback(
		async (page: number) => {
			if (!id) return;
			setIsLoadingLogs(true);
			try {
				const res = await authFetch(
					`${TRACKING_LINK_API_URL}/projects/${id}/access-logs?page=${page}&limit=${LOG_PAGE_SIZE}`,
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				setLogs(Array.isArray(data.data) ? data.data : []);
				setLogTotal(typeof data.total === 'number' ? data.total : 0);
			} catch (e) {
				setError(e instanceof Error ? e.message : t('common.genericError'));
			} finally {
				setIsLoadingLogs(false);
			}
		},
		[id, t],
	);

	useEffect(() => {
		fetchStats();
	}, [fetchStats]);

	useEffect(() => {
		fetchLogs(logPage);
	}, [fetchLogs, logPage]);

	const locations = useMemo(
		() => [...new Set(stats.map((s) => s.location))].sort(),
		[stats],
	);

	const hourlyByLocation = useMemo(() => {
		const map: Record<number, Record<string, number>> = {};
		for (let h = 0; h < 24; h++) map[h] = {};
		for (const s of stats) {
			map[s.hour][s.location] = s.count;
		}
		return Array.from({ length: 24 }, (_, h) => ({
			hour: hourLabel(h),
			...map[h],
		}));
	}, [stats]);

	const locationTotals = useMemo(() => {
		const map: Record<string, number> = {};
		for (const s of stats) {
			map[s.location] = (map[s.location] ?? 0) + s.count;
		}
		return Object.entries(map)
			.map(([location, count]) => ({ location, count }))
			.sort((a, b) => b.count - a.count);
	}, [stats]);

	const activeHours = useMemo(() => {
		const withData = new Set(stats.map((s) => s.hour));
		if (withData.size === 0) return hourlyByLocation;
		const min = Math.max(0, Math.min(...withData) - 1);
		const max = Math.min(23, Math.max(...withData) + 1);
		return hourlyByLocation.slice(min, max + 1);
	}, [stats, hourlyByLocation]);

	const logTotalPages = Math.max(1, Math.ceil(logTotal / LOG_PAGE_SIZE));
	const totalScans = useMemo(
		() => stats.reduce((sum, s) => sum + s.count, 0),
		[stats],
	);
	const isLoading = isLoadingStats;

	return (
		<div className="container mx-auto max-w-6xl p-4 md:p-6 space-y-4 md:space-y-6">
			<div>
				<Link
					to="/links"
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
					{t('common.backToProjects')}
				</Link>
			</div>

			<div>
				<h1 className="text-2xl font-bold">{t('analytics.heading')}</h1>
				{projectName && (
					<p className="mt-1 text-sm text-muted-foreground">
						{t('analytics.summary', {
							name: projectName,
							count: totalScans.toLocaleString(),
						})}
					</p>
				)}
			</div>

			{error && (
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
					<p className="text-sm text-destructive">{error}</p>
				</div>
			)}

			{isLoading ? (
				<div className="flex items-center justify-center py-24">
					<Loader className="h-8 w-8 animate-spin text-primary" />
				</div>
			) : stats.length === 0 && logTotal === 0 ? (
				<div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
					{t('analytics.empty')}
				</div>
			) : (
				<>
					<Accordion
						title={t('analytics.hourChartTitle')}
						description={t('analytics.hourChartDesc')}
					>
						<div className="p-5">
							{locations.length > 0 && (
								<div className="mb-3 flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-y-auto pr-1 text-xs">
									{locations.map((loc, i) => (
										<div
											key={`legend-${loc}`}
											className="flex items-center gap-1.5 text-muted-foreground"
										>
											<span
												className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
												style={{
													background:
														LOCATION_COLORS[i % LOCATION_COLORS.length],
												}}
											/>
											<span>{loc}</span>
										</div>
									))}
								</div>
							)}
							<ResponsiveContainer width="100%" height={320}>
								<BarChart
									data={activeHours}
									margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
								>
									<CartesianGrid
										strokeDasharray="3 3"
										className="stroke-border"
									/>
									<XAxis
										dataKey="hour"
										tick={{ fontSize: 11 }}
										className="fill-muted-foreground"
									/>
									<YAxis
										allowDecimals={false}
										tick={{ fontSize: 11 }}
										className="fill-muted-foreground"
									/>
									<Tooltip
										allowEscapeViewBox={{ x: false, y: true }}
										cursor={{ fill: 'currentColor', fillOpacity: 0.06 }}
										content={<BarTooltip />}
									/>
									{locations.map((loc, i) => (
										<Bar
											key={loc}
											dataKey={loc}
											stackId="a"
											fill={LOCATION_COLORS[i % LOCATION_COLORS.length]}
											radius={
												i === locations.length - 1 ? [3, 3, 0, 0] : undefined
											}
										/>
									))}
								</BarChart>
							</ResponsiveContainer>
						</div>
					</Accordion>

					<Accordion
						title={t('analytics.locationChartTitle')}
						description={t('analytics.locationChartDesc')}
					>
						<div className="p-5">
							<ResponsiveContainer width="100%" height={220}>
								<BarChart
									data={locationTotals}
									layout="vertical"
									margin={{ top: 4, right: 32, left: 8, bottom: 0 }}
								>
									<CartesianGrid
										strokeDasharray="3 3"
										className="stroke-border"
										horizontal={false}
									/>
									<XAxis
										type="number"
										allowDecimals={false}
										tick={{ fontSize: 11 }}
										className="fill-muted-foreground"
									/>
									<YAxis
										type="category"
										dataKey="location"
										width={96}
										tick={{ fontSize: 11 }}
										className="fill-muted-foreground"
									/>
									<Tooltip content={<BarTooltip />} />
									<Bar
										dataKey="count"
										name={t('common.scans')}
										radius={[0, 3, 3, 0]}
									>
										{locationTotals.map((_, i) => (
											<Cell
												key={`cell-${i}`}
												fill={LOCATION_COLORS[i % LOCATION_COLORS.length]}
											/>
										))}
									</Bar>
								</BarChart>
							</ResponsiveContainer>
						</div>
					</Accordion>

					<Accordion
						title={t('analytics.historyTitle')}
						description={t('common.totalCount', { total: logTotal })}
					>
						{isLoadingLogs ? (
							<div className="flex items-center justify-center py-16">
								<Loader className="h-6 w-6 animate-spin text-primary" />
							</div>
						) : logs.length === 0 ? (
							<p className="px-5 py-8 text-center text-sm text-muted-foreground">
								{t('analytics.empty')}
							</p>
						) : (
							<>
								{/* Mobile: card list */}
								<div className="md:hidden divide-y">
									{logs.map((log, i) => (
										<div
											key={`${log.qrId}-${log.accessedAt}-${i}`}
											className="px-4 py-3 hover:bg-muted/30 transition-colors"
										>
											<p className="text-sm font-medium">{log.location}</p>
											<div className="mt-0.5 flex items-center justify-between gap-2">
												<p className="text-xs text-muted-foreground">
													{log.accessedAt
														? new Date(log.accessedAt).toLocaleString()
														: '-'}
												</p>
												<p className="font-mono text-xs text-muted-foreground shrink-0">
													{log.ipAddress ?? '-'}
												</p>
											</div>
										</div>
									))}
								</div>

								{/* Desktop: table */}
								<div className="hidden md:block overflow-x-auto">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b bg-muted/50">
												<th className="px-5 py-3 text-left font-medium text-muted-foreground">
													{t('common.location')}
												</th>
												<th className="px-5 py-3 text-left font-medium text-muted-foreground">
													{t('common.time')}
												</th>
												<th className="px-5 py-3 text-left font-medium text-muted-foreground">
													{t('common.qrId')}
												</th>
												<th className="px-5 py-3 text-left font-medium text-muted-foreground">
													{t('common.ip')}
												</th>
											</tr>
										</thead>
										<tbody>
											{logs.map((log, i) => (
												<tr
													key={`${log.qrId}-${log.accessedAt}-${i}`}
													className="border-b last:border-0 hover:bg-muted/30 transition-colors"
												>
													<td className="px-5 py-3 font-medium">
														{log.location}
													</td>
													<td className="px-5 py-3 text-muted-foreground">
														{log.accessedAt
															? new Date(log.accessedAt).toLocaleString()
															: '-'}
													</td>
													<td className="px-5 py-3 font-mono text-xs text-muted-foreground">
														{log.qrId ? `${log.qrId.slice(0, 8)}…` : '-'}
													</td>
													<td className="px-5 py-3 font-mono text-xs text-muted-foreground">
														{log.ipAddress ?? '-'}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>

								<Pagination
									currentPage={logPage}
									totalPages={logTotalPages}
									total={logTotal}
									onPageChange={setLogPage}
								/>
							</>
						)}
					</Accordion>
				</>
			)}
		</div>
	);
}

export default function ProjectAnalyticsPage() {
	return (
		<PermissionGuard required={Permissions.TRACKING_LINK_ANALYTICS}>
			<ProjectAnalyticsContent />
		</PermissionGuard>
	);
}
