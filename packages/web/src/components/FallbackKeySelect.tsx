import type { FallbackDestination } from '../hooks/useFallbackDestinations';
import { useTranslation } from '../lib/i18n';
import { fieldErrorText, inputBase, labelBase } from '../lib/styles';

/**
 * Picks the fallback keyword for a project from the Worker's configured list.
 *
 * A picker rather than free text because the value only means anything if it
 * matches a key in FALLBACK_DESTINATIONS — a typed keyword that does not is
 * silently inert until the day D1 goes down, which is the worst possible time to
 * discover it.
 */
interface FallbackKeySelectProps {
	id: string;
	value: string;
	onChange: (value: string) => void;
	destinations: FallbackDestination[];
	staticFallbackUrl: string | null;
	isLoading: boolean;
	/** True when the list could not be fetched; falls back to a text input. */
	failed: boolean;
	error?: string;
	disabled?: boolean;
}

export function FallbackKeySelect({
	id,
	value,
	onChange,
	destinations,
	staticFallbackUrl,
	isLoading,
	failed,
	error,
	disabled,
}: FallbackKeySelectProps) {
	const { t } = useTranslation();
	const describedBy = error ? `${id}-error` : `${id}-hint`;

	// A stored keyword that is no longer configured must stay visible and selected.
	// Dropping it would silently rewrite a value that is already printed on posters
	// the moment someone edits an unrelated field.
	const isOrphaned = value !== '' && !destinations.some((d) => d.key === value);
	const selected = destinations.find((d) => d.key === value);

	const label = (
		<label htmlFor={id} className={labelBase}>
			{t('projects.fallbackKeyLabel')}{' '}
			<span className="font-normal text-muted-foreground">
				({t('common.optional')})
			</span>
		</label>
	);

	const message = error ? (
		<p id={`${id}-error`} className={fieldErrorText}>
			{error}
		</p>
	) : (
		<p id={`${id}-hint`} className="text-xs text-muted-foreground">
			{isOrphaned
				? t('projects.fallbackKeyOrphaned', { key: value })
				: selected
					? t('projects.fallbackKeySelected', { url: selected.url })
					: staticFallbackUrl
						? t('projects.fallbackKeyNoneSelected', { url: staticFallbackUrl })
						: t('projects.fallbackKeyHint')}
		</p>
	);

	// The list is a convenience, not a dependency: if it could not be fetched, a
	// plain input still lets the form be filled in and saved.
	if (failed) {
		return (
			<div className="space-y-1.5">
				{label}
				<input
					id={id}
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onBlur={() => onChange(value.trim())}
					placeholder={t('projects.fallbackKeyPlaceholder')}
					maxLength={40}
					disabled={disabled}
					aria-invalid={error ? true : undefined}
					aria-describedby={describedBy}
					className={inputBase}
				/>
				{error ? (
					<p id={`${id}-error`} className={fieldErrorText}>
						{error}
					</p>
				) : (
					<p id={`${id}-hint`} className="text-xs text-muted-foreground">
						{t('projects.fallbackKeyListUnavailable')}
					</p>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-1.5">
			{label}
			<select
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				disabled={disabled || isLoading}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy}
				className={inputBase}
			>
				<option value="">{t('projects.fallbackKeyNone')}</option>
				{isOrphaned && (
					<option value={value}>
						{t('projects.fallbackKeyOrphanedOption', { key: value })}
					</option>
				)}
				{destinations.map((destination) => (
					<option key={destination.key} value={destination.key}>
						{destination.key} — {destination.url}
					</option>
				))}
			</select>
			{destinations.length === 0 && !isLoading ? (
				<p className="text-xs text-muted-foreground">
					{t('projects.fallbackKeyEmpty')}
				</p>
			) : (
				message
			)}
		</div>
	);
}
