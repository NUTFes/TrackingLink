import { ArrowLeft, Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PermissionGuard } from '../components/PermissionGuard';
import { useToast } from '../components/ToastProvider';
import { TRACKING_LINK_API_URL } from '../config';
import { useApiErrorMessage } from '../hooks/useApiError';
import { useFieldErrors, validateHttpUrl } from '../hooks/useFieldErrors';
import { Permissions } from '../hooks/useStaffAuth';
import { ApiError, assertOk, authFetch } from '../lib/api';
import { useTranslation } from '../lib/i18n';
import {
	btnPrimary,
	btnSecondary,
	fieldErrorText,
	inputBase,
	labelBase,
} from '../lib/styles';

const NAME_MAX = 200;
const URL_MAX = 2048;

function CreateProjectForm() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const toast = useToast();
	const describeError = useApiErrorMessage();
	const { errors, validate, setFromFields } = useFieldErrors();
	const [projectName, setProjectName] = useState('');
	const [destinationUrl, setDestinationUrl] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (isSubmitting) return;

		const ok = validate({
			projectName: {
				id: 'projectName',
				value: projectName,
				required: true,
				maxLength: NAME_MAX,
			},
			destinationUrl: {
				id: 'destinationUrl',
				value: destinationUrl,
				required: true,
				maxLength: URL_MAX,
				// Checked client-side too, so the message is in the app's language.
				// `type="url"` alone shows the *browser's* tooltip in the browser's
				// language, and silently rejects `example.com` without saying a scheme
				// is required.
				validate: validateHttpUrl,
			},
		});
		if (!ok) return;

		setIsSubmitting(true);
		try {
			const res = await authFetch(`${TRACKING_LINK_API_URL}/projects`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectName: projectName.trim(),
					destinationUrl: destinationUrl.trim(),
				}),
			});
			await assertOk(res);
			// Fired before navigating, which only works because ToastProvider sits
			// above the router. Without it, creating a project was completely silent —
			// and since the list had no ORDER BY, the new row often was not on page 1
			// either, so users concluded the create had failed and made another.
			toast.success(t('projects.created'));
			navigate('/links');
		} catch (err) {
			if (err instanceof ApiError && err.fields.length) {
				setFromFields(err.fields, describeError(err));
			}
			toast.error(describeError(err));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="mx-auto max-w-2xl p-4 sm:p-6">
			<div className="mb-6">
				<Link
					to="/links"
					className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					{t('common.backToProjects')}
				</Link>
			</div>

			<div className="rounded-lg border bg-card shadow-sm">
				<div className="border-b p-5">
					<h1 className="text-xl font-bold">{t('createProject.heading')}</h1>
					<p className="mt-0.5 text-sm text-muted-foreground">
						{t('createProject.subtitle')}
					</p>
				</div>

				<form onSubmit={handleSubmit} noValidate className="space-y-5 p-5">
					<div className="space-y-1.5">
						<label htmlFor="projectName" className={labelBase}>
							{t('createProject.nameLabel')}{' '}
							<span className="text-destructive">*</span>
						</label>
						<input
							id="projectName"
							type="text"
							value={projectName}
							onChange={(e) => setProjectName(e.target.value)}
							// Trim on blur so a stray trailing space simply disappears rather
							// than becoming a validation failure.
							onBlur={() => setProjectName((v) => v.trim())}
							placeholder={t('createProject.namePlaceholder')}
							maxLength={NAME_MAX}
							aria-invalid={errors.projectName ? true : undefined}
							aria-describedby={
								errors.projectName ? 'projectName-error' : undefined
							}
							className={inputBase}
						/>
						{errors.projectName ? (
							<p id="projectName-error" className={fieldErrorText}>
								{errors.projectName}
							</p>
						) : null}
					</div>

					<div className="space-y-1.5">
						<label htmlFor="destinationUrl" className={labelBase}>
							{t('createProject.urlLabel')}{' '}
							<span className="text-destructive">*</span>
						</label>
						<input
							id="destinationUrl"
							// text, not url: validation is ours now, and the native bubble
							// competes with the inline message while speaking the wrong
							// language.
							type="text"
							inputMode="url"
							value={destinationUrl}
							onChange={(e) => setDestinationUrl(e.target.value)}
							onBlur={() => setDestinationUrl((v) => v.trim())}
							placeholder={t('createProject.urlPlaceholder')}
							maxLength={URL_MAX}
							aria-invalid={errors.destinationUrl ? true : undefined}
							aria-describedby={
								errors.destinationUrl ? 'destinationUrl-error' : undefined
							}
							className={inputBase}
						/>
						{errors.destinationUrl ? (
							<p id="destinationUrl-error" className={fieldErrorText}>
								{errors.destinationUrl}
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:gap-3">
						{/* Deliberately not disabled on empty input: an inert button with no
						    explanation is the same dead end in different clothes. */}
						<button
							type="submit"
							disabled={isSubmitting}
							className={btnPrimary}
						>
							{isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
							{isSubmitting
								? t('createProject.creating')
								: t('createProject.submit')}
						</button>
						<Link to="/links" className={btnSecondary}>
							{t('common.cancel')}
						</Link>
					</div>
				</form>
			</div>
		</div>
	);
}

export default function CreateProjectPage() {
	return (
		<PermissionGuard required={Permissions.TRACKING_LINK_EDIT}>
			<CreateProjectForm />
		</PermissionGuard>
	);
}
