import { Loader2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { btnDestructive, btnSecondary } from '../lib/styles';
import { Modal } from './Modal';

/**
 * Confirmation for a destructive action, replacing `window.confirm`.
 *
 * Three concrete problems with the native dialog here:
 *
 * 1. It never said *which* item was being deleted. Deleting a project cascades
 *    to its QR codes and their scan history, and on a phone the Edit and Delete
 *    buttons sat about 8px apart at 28px tall — so an irreversible action was one
 *    mis-tap plus a generic "Delete this project?" away.
 * 2. Chrome suppresses repeated dialogs ("prevent this page from creating
 *    additional dialogs"), after which `confirm()` simply returns false and
 *    delete stops working with no feedback whatsoever.
 * 3. It cannot show progress, so there was nothing to disable while the request
 *    was in flight — a double-tap fired two DELETEs and the second 404'd, showing
 *    an error *after* a successful delete.
 */
interface ConfirmDialogProps {
	open: boolean;
	title: string;
	/** Should name the specific item, e.g. 「造形大ポスター」を削除しますか？ */
	body: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	/** True while the action runs: buttons disable and the dialog stops dismissing. */
	pending?: boolean;
}

export function ConfirmDialog({
	open,
	title,
	body,
	confirmLabel,
	onConfirm,
	onCancel,
	pending = false,
}: ConfirmDialogProps) {
	const { t } = useTranslation();

	return (
		<Modal
			open={open}
			onClose={onCancel}
			title={title}
			// Not dismissible mid-flight: closing during the request would orphan it
			// and hide whatever it reported.
			dismissible={!pending}
			className="sm:max-w-md"
			footer={
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={pending}
						className={btnSecondary}
					>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={pending}
						className={btnDestructive}
					>
						{pending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							confirmLabel
						)}
					</button>
				</div>
			}
		>
			<p className="whitespace-pre-line text-sm text-muted-foreground">
				{body}
			</p>
		</Modal>
	);
}
