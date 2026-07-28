import { useCallback } from 'react';
import { describeError } from '../lib/api';
import { useTranslation } from '../lib/i18n';

/**
 * Turns any thrown value into a message the user can read in their language.
 *
 * Kept as a hook (rather than living in lib/api.ts) so that api.ts stays free of
 * React imports. Every catch block in the app funnels through this, which is what
 * guarantees no raw server string or `HTTP 404` reaches a user.
 */
export function useApiErrorMessage(): (error: unknown) => string {
	const { t } = useTranslation();
	return useCallback(
		(error: unknown) => {
			const { key, vars } = describeError(error);
			return t(key, vars);
		},
		[t],
	);
}
