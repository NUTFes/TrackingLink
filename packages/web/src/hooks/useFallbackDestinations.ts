import { useCallback, useEffect, useRef, useState } from 'react';
import { TRACKING_LINK_API_URL } from '../config';
import { assertOk, authFetch } from '../lib/api';

/**
 * The fallback keywords an operator has configured on the Worker.
 *
 * Fetched rather than hardcoded because the list lives in the Worker's
 * FALLBACK_DESTINATIONS var, which the browser cannot read. Driving the form
 * from it means adding or removing a destination in wrangler.jsonc changes the
 * options with no code change, and a keyword that is not configured cannot be
 * chosen in the first place.
 */
export interface FallbackDestination {
	key: string;
	url: string;
}

interface Result {
	destinations: FallbackDestination[];
	/** Where scans go when a project has no keyword. Null if unconfigured. */
	staticFallbackUrl: string | null;
	isLoading: boolean;
	/** True when the list could not be fetched — the form degrades to free text. */
	failed: boolean;
}

export function useFallbackDestinations(): Result {
	const [destinations, setDestinations] = useState<FallbackDestination[]>([]);
	const [staticFallbackUrl, setStaticFallbackUrl] = useState<string | null>(
		null,
	);
	const [isLoading, setIsLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const mounted = useRef(true);

	const load = useCallback(async () => {
		try {
			const res = await authFetch(
				`${TRACKING_LINK_API_URL}/projects/fallback-destinations`,
			);
			await assertOk(res);
			const body = (await res.json()) as {
				data?: FallbackDestination[];
				staticFallbackUrl?: string | null;
			};
			if (!mounted.current) return;
			setDestinations(Array.isArray(body.data) ? body.data : []);
			setStaticFallbackUrl(body.staticFallbackUrl ?? null);
			setFailed(false);
		} catch {
			if (!mounted.current) return;
			// Deliberately quiet: this list is a convenience for one field, and a
			// toast here would fire on every form open during an API blip. The form
			// falls back to a plain text input, which still validates and still
			// saves.
			setFailed(true);
		} finally {
			if (mounted.current) setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		mounted.current = true;
		void load();
		return () => {
			mounted.current = false;
		};
	}, [load]);

	return { destinations, staticFallbackUrl, isLoading, failed };
}
