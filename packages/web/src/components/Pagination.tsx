import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { btnIcon } from '../lib/styles';
import { cn } from '../lib/utils';

/**
 * Shared pagination. Previously duplicated byte-for-byte in both list pages.
 *
 * Fixes carried over from that copy:
 * - Renders even at a single page, so the row-count summary does not blink in and
 *   out as `total` crosses the page size, and there is always a control to reach
 *   page 1 from a page that just emptied.
 * - `aria-label` on the icon-only chevrons, which a screen reader previously
 *   announced as just "button, button" — while being the primary navigation.
 * - `aria-current="page"` on the active number; it used to be conveyed by colour
 *   alone.
 * - Disabled while loading, so fast clicks cannot queue overlapping fetches.
 * - Touch targets sized from lib/styles (they were 28px on the device this app is
 *   actually used on).
 * - A ±2 window instead of ±1, so long lists need fewer taps.
 */
interface PaginationProps {
	page: number;
	totalPages: number;
	total: number;
	pageSize: number;
	shownCount: number;
	isLoading?: boolean;
	onPageChange: (page: number) => void;
}

const WINDOW = 2;

export function Pagination({
	page,
	totalPages,
	total,
	pageSize,
	shownCount,
	isLoading = false,
	onPageChange,
}: PaginationProps) {
	const { t } = useTranslation();

	// Derived from what is actually rendered, not from page × pageSize — the old
	// version asserted "1–10 of 11" even when the server returned fewer rows.
	const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const end = total === 0 ? 0 : start + shownCount - 1;

	const numbers: (number | 'gap')[] = [];
	for (let candidate = 1; candidate <= totalPages; candidate++) {
		const isEdge = candidate === 1 || candidate === totalPages;
		const isNear = Math.abs(candidate - page) <= WINDOW;
		if (isEdge || isNear) {
			numbers.push(candidate);
		} else if (numbers[numbers.length - 1] !== 'gap') {
			numbers.push('gap');
		}
	}

	const go = (target: number) => {
		const clamped = Math.min(Math.max(1, target), totalPages);
		if (clamped === page) return;
		onPageChange(clamped);
		// On a phone, tapping "next" at the bottom of a list otherwise leaves you at
		// the bottom of the new one, which reads as nothing having happened.
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	return (
		<nav
			aria-label={t('pagination.range', { start, end, total })}
			className="flex flex-col-reverse items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row"
		>
			<p className="text-xs text-muted-foreground">
				{t('pagination.range', { start, end, total })}
			</p>

			{totalPages > 1 ? (
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => go(page - 1)}
						disabled={page <= 1 || isLoading}
						aria-label={t('pagination.previous')}
						className={btnIcon}
					>
						<ChevronLeft className="h-4 w-4" aria-hidden="true" />
					</button>

					{numbers.map((entry, index) =>
						entry === 'gap' ? (
							<span
								// Gaps are purely positional and carry no identity of their own.
								key={`gap-${index}`}
								aria-hidden="true"
								className="px-1 text-xs text-muted-foreground"
							>
								…
							</span>
						) : (
							<button
								key={entry}
								type="button"
								onClick={() => go(entry)}
								disabled={isLoading}
								aria-current={entry === page ? 'page' : undefined}
								className={cn(
									btnIcon,
									'px-2 text-sm',
									entry === page &&
										'bg-primary text-primary-foreground hover:bg-primary/90',
								)}
							>
								{entry}
							</button>
						),
					)}

					<button
						type="button"
						onClick={() => go(page + 1)}
						disabled={page >= totalPages || isLoading}
						aria-label={t('pagination.next')}
						className={btnIcon}
					>
						<ChevronRight className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
			) : null}
		</nav>
	);
}
