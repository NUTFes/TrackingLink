import { useCallback, useEffect, useRef, useState } from 'react';
import { assertOk, authFetch } from '../lib/api';
import { useApiErrorMessage } from './useApiError';

/**
 * Paginated list fetching for this API's `{ data, total }` envelope.
 *
 * Not a generic data layer — deliberately narrow. It exists because the identical
 * pagination logic was duplicated byte-for-byte across the two list pages and was
 * broken in four separate ways:
 *
 * 1. **Stranded on an empty last page.** With 11 rows you are on page 2, you
 *    delete the only row there, `totalPages` becomes 1, and the pagination
 *    component returns null — leaving "No projects yet." and *no control to get
 *    back to page 1*. Only a manual reload recovered. (Worse on the QR page,
 *    where the pagination was rendered inside the non-empty branch, so it
 *    vanished even with several pages left.)
 * 2. **Total drifting from reality.** The QR page ran `setTotal(total - 1)` after
 *    `await fetchData()`, clobbering the count the server had just returned with
 *    one computed from the pre-fetch value.
 * 3. **Races.** No AbortController and no staleness guard, so clicking 1 → 3 → 5
 *    on a slow connection let whichever response landed last win: the highlighted
 *    page and the rendered rows could disagree.
 * 4. **No unmount safety.** Navigating away mid-fetch called setState on an
 *    unmounted component.
 */
interface ListResponse<T> {
	data: T[];
	total: number;
}

export interface UseListQueryResult<T> {
	items: T[];
	total: number;
	page: number;
	totalPages: number;
	isLoading: boolean;
	/** Already-translated message, or null. */
	error: string | null;
	setPage: (page: number) => void;
	/** Re-runs the current page. Use after a mutation. */
	refresh: () => Promise<void>;
}

export function useListQuery<T>(
	/** Given a 1-based page, returns the absolute URL to fetch. */
	buildUrl: (page: number) => string,
	pageSize: number,
): UseListQueryResult<T> {
	const [items, setItems] = useState<T[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const describeError = useApiErrorMessage();

	// Monotonic request id: only the newest response is allowed to write state.
	const requestId = useRef(0);
	const abortRef = useRef<AbortController | null>(null);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			abortRef.current?.abort();
		};
	}, []);

	const load = useCallback(
		async (targetPage: number) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			const id = ++requestId.current;

			setIsLoading(true);
			setError(null);
			try {
				const response = await authFetch(buildUrl(targetPage), {
					signal: controller.signal,
				});
				await assertOk(response);
				const body = (await response.json()) as ListResponse<T>;
				if (id !== requestId.current || !mounted.current) return;

				const nextTotal = typeof body.total === 'number' ? body.total : 0;
				const rows = Array.isArray(body.data) ? body.data : [];

				// Clamp: if the page we asked for no longer exists (the last row on it
				// was deleted), fall back to the last page that does and refetch,
				// instead of showing an empty list with no way back.
				const lastPage = Math.max(1, Math.ceil(nextTotal / pageSize));
				if (targetPage > lastPage && nextTotal > 0) {
					setPage(lastPage);
					return;
				}

				setItems(rows);
				setTotal(nextTotal);
			} catch (caught) {
				// An abort is our own doing, not a failure to report.
				if (controller.signal.aborted) return;
				if (id !== requestId.current || !mounted.current) return;
				setError(describeError(caught));
				setItems([]);
			} finally {
				if (id === requestId.current && mounted.current) setIsLoading(false);
			}
		},
		[buildUrl, describeError, pageSize],
	);

	useEffect(() => {
		void load(page);
	}, [load, page]);

	const refresh = useCallback(() => load(page), [load, page]);

	return {
		items,
		total,
		page,
		totalPages: Math.max(1, Math.ceil(total / pageSize)),
		isLoading,
		error,
		setPage,
		refresh,
	};
}
