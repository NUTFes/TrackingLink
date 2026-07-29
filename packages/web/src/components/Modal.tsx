import { X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../lib/i18n';
import { btnIcon } from '../lib/styles';
import { cn } from '../lib/utils';

/**
 * A dialog that is actually usable from a keyboard.
 *
 * The QR dialog it replaces carried `role="dialog" aria-modal="true"` but had no
 * focus trap, no autofocus, no Escape handler, no focus restore and no scroll
 * lock — Tab walked straight into the page behind the overlay. It also had
 * `onKeyDown={(e) => e.stopPropagation()}` on the panel, which *actively*
 * prevented key events from bubbling, so any Escape handler added higher up
 * could never have fired.
 */
interface ModalProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	/** Rendered under the body, typically actions. */
	footer?: ReactNode;
	/** Suppresses backdrop-click and Escape. Use while a submit is in flight. */
	dismissible?: boolean;
	className?: string;
}

const FOCUSABLE =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
	open,
	onClose,
	title,
	children,
	footer,
	dismissible = true,
	className,
}: ModalProps) {
	const { t } = useTranslation();
	const panelRef = useRef<HTMLDivElement>(null);
	const restoreFocusTo = useRef<HTMLElement | null>(null);

	const requestClose = useCallback(() => {
		if (dismissible) onClose();
	}, [dismissible, onClose]);

	// Remember what had focus so it can be handed back on close — otherwise focus
	// lands on <body> and keyboard users lose their place in the list.
	useEffect(() => {
		if (!open) return;
		restoreFocusTo.current = document.activeElement as HTMLElement | null;
		return () => restoreFocusTo.current?.focus?.();
	}, [open]);

	// Lock the page behind the dialog, so scrolling the overlay does not scroll the
	// list underneath it.
	useEffect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	}, [open]);

	// Move focus into the dialog on open: the first field for a form, the panel
	// itself otherwise.
	useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		if (!panel) return;
		const first = panel.querySelector<HTMLElement>(FOCUSABLE);
		(first ?? panel).focus();
	}, [open]);

	// Escape to close, and Tab cycling confined to the panel.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				requestClose();
				return;
			}
			if (event.key !== 'Tab') return;
			const panel = panelRef.current;
			if (!panel) return;
			const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		// Capture phase, so a child that stops propagation cannot disable Escape.
		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
	}, [open, requestClose]);

	if (!open) return null;

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
			{/* Presentational backdrop. Keyboard users close with Escape, which is why
			    this needs no role or key handler of its own. */}
			<div
				className="absolute inset-0 bg-black/50"
				onClick={requestClose}
				aria-hidden="true"
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
				className={cn(
					'relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-border bg-card shadow-xl sm:max-w-lg sm:rounded-xl',
					className,
				)}
			>
				<div className="flex items-start justify-between gap-2 border-b border-border p-4">
					<h2 className="min-w-0 break-words text-base font-semibold">
						{title}
					</h2>
					<button
						type="button"
						onClick={requestClose}
						disabled={!dismissible}
						aria-label={t('common.close')}
						className={cn(btnIcon, '-m-2 shrink-0')}
					>
						<X className="h-5 w-5" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
				{footer ? (
					<div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
						{footer}
					</div>
				) : null}
			</div>
		</div>,
		document.body,
	);
}
