import { Loader2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { btnPrimary } from '../lib/styles';

/**
 * Full-viewport loading / error state, used before any page chrome exists.
 *
 * `min-h-dvh` rather than `h-screen`: on iOS Safari the dynamic toolbar makes
 * `100vh` taller than the visible area, so the bottom of a centred block gets
 * clipped and the page cannot be scrolled to reach it.
 */
export function FullScreenLoading() {
	const { t } = useTranslation();
	return (
		<div
			// Announced, unlike the bare <div> this replaces — a screen reader user
			// previously got silence during every page load.
			role="status"
			aria-live="polite"
			className="flex min-h-dvh items-center justify-center gap-2 p-4 text-muted-foreground"
		>
			<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
			{t('common.loading')}
		</div>
	);
}

export function FullScreenError({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
			<p role="alert" className="max-w-md text-sm text-destructive">
				{message}
			</p>
			{onRetry ? (
				<button type="button" onClick={onRetry} className={btnPrimary}>
					{t('common.retry')}
				</button>
			) : null}
		</div>
	);
}
