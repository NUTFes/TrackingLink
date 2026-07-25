import { X } from 'lucide-react';
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';

/**
 * App-wide notifications.
 *
 * This is not merely a DRY pass over the four inline error banners. It is the
 * only structure that survives the component that raised the message
 * unmounting — which was the root cause of the worst bug in the app: cancelling
 * a QR code edit mid-save closed the form, and the failure was then written to
 * `formError` on a form that no longer rendered. The save failed and the user was
 * never told.
 *
 * It also supplies the success feedback the app had none of: create, edit and
 * delete all completed in total silence, which is why "did that work?" was a
 * reasonable question to ask of every action.
 *
 * Placement matters. Bottom-centre on mobile puts messages within thumb reach
 * *and* above the fold; the old banners rendered at the very top of the page, so
 * a failure while deleting row 9 on a phone was scrolled out of sight and looked
 * exactly like nothing happening.
 */

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
}

interface ToastApi {
	success: (message: string) => void;
	error: (message: string) => void;
	info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLES: Record<ToastKind, string> = {
	success: 'border-primary/40 bg-card text-foreground',
	error: 'border-destructive/50 bg-destructive/10 text-destructive',
	info: 'border-border bg-card text-foreground',
};

// Errors linger long enough to read a sentence; confirmations get out of the way.
const DISMISS_MS: Record<ToastKind, number> = {
	success: 4000,
	error: 8000,
	info: 5000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const [toasts, setToasts] = useState<Toast[]>([]);
	const nextId = useRef(0);

	const dismiss = useCallback((id: number) => {
		setToasts((current) => current.filter((toast) => toast.id !== id));
	}, []);

	const push = useCallback(
		(kind: ToastKind, message: string) => {
			const id = ++nextId.current;
			// Capped at three: a burst of failures (a dead API, say) must not paper
			// over the whole screen.
			setToasts((current) => [...current.slice(-2), { id, kind, message }]);
			window.setTimeout(() => dismiss(id), DISMISS_MS[kind]);
		},
		[dismiss],
	);

	const api = useMemo<ToastApi>(
		() => ({
			success: (message) => push('success', message),
			error: (message) => push('error', message),
			info: (message) => push('info', message),
		}),
		[push],
	);

	return (
		<ToastContext.Provider value={api}>
			{children}
			<div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:inset-x-auto md:right-0 md:top-0 md:items-end">
				{toasts.map((toast) => (
					<div
						key={toast.id}
						// role=alert interrupts a screen reader for failures; role=status is
						// polite for everything else. Without either, none of the app's
						// error messages were announced at all.
						role={toast.kind === 'error' ? 'alert' : 'status'}
						className={cn(
							'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border p-3 text-sm shadow-lg',
							KIND_STYLES[toast.kind],
						)}
					>
						<span className="min-w-0 flex-1 break-words">{toast.message}</span>
						<button
							type="button"
							onClick={() => dismiss(toast.id)}
							aria-label={t('common.close')}
							className="-m-1 shrink-0 rounded p-1 opacity-70 hover:opacity-100"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}

export function useToast(): ToastApi {
	const ctx = useContext(ToastContext);
	if (!ctx) throw new Error('useToast must be used within a ToastProvider');
	return ctx;
}
