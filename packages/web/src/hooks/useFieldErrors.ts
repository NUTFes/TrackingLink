import { useCallback, useState } from 'react';
import { useTranslation } from '../lib/i18n';

/**
 * Per-field validation messages.
 *
 * Replaces the pattern all three forms shared: inputs marked `required` (which a
 * single space satisfies), then a `handleSubmit` that trimmed the values and bailed
 * out with a bare `return`. Typing one space and pressing Save did absolutely
 * nothing — no message, no spinner, no closed form. Indistinguishable from a
 * broken app.
 *
 * The submit button stays *enabled* on purpose. Disabling it is the same problem
 * wearing a different hat: a greyed-out button with no explanation of what is
 * missing, which is exactly what CreateProjectPage already did.
 */
export interface FieldRule {
	/** DOM id of the input, used to focus the first invalid field. */
	id: string;
	value: string;
	required?: boolean;
	maxLength?: number;
	/** Extra check; return an i18n key to fail. */
	validate?: (value: string) => string | null;
}

export function useFieldErrors() {
	const { t } = useTranslation();
	const [errors, setErrors] = useState<Record<string, string>>({});

	const clear = useCallback(() => setErrors({}), []);

	/** Marks the fields named by an API 409/400 response. */
	const setFromFields = useCallback((fields: string[], message: string) => {
		if (fields.length === 0) return;
		setErrors(Object.fromEntries(fields.map((field) => [field, message])));
	}, []);

	/**
	 * Validates, stores messages, focuses the first offender, and returns whether
	 * the form may be submitted.
	 */
	const validate = useCallback(
		(rules: Record<string, FieldRule>): boolean => {
			const next: Record<string, string> = {};
			for (const [name, rule] of Object.entries(rules)) {
				const value = rule.value.trim();
				if (rule.required && !value) {
					next[name] = t('validation.required');
					continue;
				}
				if (rule.maxLength && value.length > rule.maxLength) {
					next[name] = t('validation.tooLong', { max: rule.maxLength });
					continue;
				}
				const custom = value ? rule.validate?.(value) : null;
				if (custom) next[name] = t(custom);
			}
			setErrors(next);

			const firstInvalid = Object.keys(next)[0];
			if (firstInvalid) {
				document.getElementById(rules[firstInvalid].id)?.focus();
				return false;
			}
			return true;
		},
		[t],
	);

	return { errors, validate, clear, setFromFields };
}

/**
 * Mirrors the API's fallback-key rule: the keyword has to be one the Worker was
 * configured with.
 *
 * Which characters it uses is not the question — a perfectly spelled keyword that
 * FALLBACK_DESTINATIONS does not list resolves to nothing on the one day the
 * fallback is needed, so membership is the only check worth making.
 */
export function validateFallbackKey(
	value: string,
	configuredKeys: string[],
	options: { listUnavailable?: boolean; storedKey?: string } = {},
): string | null {
	// Blank is "no keyword", which needs no entry; scans use the site-wide fallback.
	if (value === '') return null;
	// The picker degrades to a free-text input when the list could not be fetched.
	// With no list to compare against, anything we did here would reject valid
	// keywords, so length is the only client-side rule and the server is the gate.
	if (options.listUnavailable) return null;
	// An orphaned keyword stays saveable when it is not being changed, matching the
	// API's exemption: it is already printed on posters, and blocking the save would
	// strand the whole row over a field the user did not touch.
	if (options.storedKey !== undefined && value === options.storedKey)
		return null;
	return configuredKeys.includes(value) ? null : 'validation.fallbackKey';
}

/** Shared http(s) check, mirroring the API's protocol allow-list. */
export function validateHttpUrl(value: string): string | null {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:'
			? null
			: 'validation.url';
	} catch {
		return 'validation.url';
	}
}
