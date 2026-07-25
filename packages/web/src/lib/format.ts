import type { Locale } from './i18n';

/**
 * Date formatting that follows the *app's* language, not the browser's.
 *
 * Every call site used `toLocaleDateString()` / `toLocaleString()` with no locale
 * argument, so switching the UI to 日本語 still produced `7/25/2026`. Worse, the
 * Japanese column header reads 作成日時 ("date and time") while
 * `toLocaleDateString()` drops the time entirely, and the mobile card and the
 * desktop table disagreed on which of the two to call.
 */
const LOCALE_TAGS: Record<Locale, string> = { en: 'en-US', ja: 'ja-JP' };

/** Rendered when a timestamp is missing *or* unparseable — `Invalid Date` is not an answer. */
const PLACEHOLDER = '-';

function toDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Date only. */
export function formatDate(
	value: string | null | undefined,
	locale: Locale,
): string {
	const date = toDate(value);
	if (!date) return PLACEHOLDER;
	return date.toLocaleDateString(LOCALE_TAGS[locale], {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

/** Date and time — use wherever the label says 作成日時 / "Created". */
export function formatDateTime(
	value: string | null | undefined,
	locale: Locale,
): string {
	const date = toDate(value);
	if (!date) return PLACEHOLDER;
	return date.toLocaleString(LOCALE_TAGS[locale], {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

/**
 * Builds a filename fragment from user text.
 *
 * Japanese is deliberately preserved: the whole reason downloads were unusable
 * was that `qr-3f2b8a1c-….png` says nothing about which poster it belongs to, and
 * transliterating 造形大ポスター to `zou-kei-dai` would not help either.
 */
export function slugForFilename(
	...parts: (string | null | undefined)[]
): string {
	const slug = parts
		.map((part) => (part ?? '').trim())
		.filter(Boolean)
		.join('_')
		// Characters no filesystem accepts.
		.replace(/[\\/:*?"<>|]/g, '')
		// Any whitespace (including full-width) collapses to one underscore.
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 80);
	return slug || 'qr';
}
