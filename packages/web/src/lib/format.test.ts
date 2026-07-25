import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, slugForFilename } from './format';

describe('formatDateTime', () => {
	const iso = '2026-07-25T09:05:00.000Z';

	it('produces different output per app locale', () => {
		// The bug being locked down: every call site used toLocaleString() with no
		// locale, so switching the UI to Japanese still rendered en-US dates.
		const ja = formatDateTime(iso, 'ja');
		const en = formatDateTime(iso, 'en');
		expect(ja).not.toBe(en);
		expect(ja).toMatch(/2026/);
	});

	it('includes a time, because the ja label says 作成日時', () => {
		// toLocaleDateString() silently dropped the time while the column header
		// promised it.
		expect(formatDateTime(iso, 'ja')).toMatch(/\d{1,2}:\d{2}/);
	});

	it('renders a placeholder for missing or unparseable input', () => {
		expect(formatDateTime(null, 'ja')).toBe('-');
		expect(formatDateTime(undefined, 'ja')).toBe('-');
		expect(formatDateTime('', 'ja')).toBe('-');
		// Would previously have rendered the string "Invalid Date" to the user.
		expect(formatDateTime('not-a-date', 'ja')).toBe('-');
	});

	it('formatDate omits the time', () => {
		expect(formatDate(iso, 'ja')).not.toMatch(/\d{1,2}:\d{2}/);
	});
});

describe('slugForFilename', () => {
	it('keeps Japanese, because that is the whole point', () => {
		expect(slugForFilename('造形大ポスター', 'ポスター', '1F掲示板')).toBe(
			'造形大ポスター_ポスター_1F掲示板',
		);
	});

	it('strips characters no filesystem accepts', () => {
		expect(slugForFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
	});

	it('collapses whitespace, including full-width spaces', () => {
		expect(slugForFilename('造形大  ポスター')).toBe('造形大_ポスター');
		expect(slugForFilename('造形大　ポスター')).toBe('造形大_ポスター');
	});

	it('skips empty parts instead of leaving stray separators', () => {
		// An omitted location must not produce "name_medium_".
		expect(slugForFilename('name', 'medium', '')).toBe('name_medium');
		expect(slugForFilename('name', '', undefined, null)).toBe('name');
	});

	it('never returns an empty filename', () => {
		expect(slugForFilename('')).toBe('qr');
		expect(slugForFilename('///')).toBe('qr');
	});

	it('caps the length so the OS does not reject the path', () => {
		expect(slugForFilename('あ'.repeat(200)).length).toBeLessThanOrEqual(80);
	});
});
