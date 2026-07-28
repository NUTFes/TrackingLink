import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, describeError } from './api';

/**
 * The status/code → i18n key table is exactly the kind of thing that regresses
 * without anyone noticing: rename a code on the API and the mapping silently
 * falls through to a generic message, which still *looks* fine.
 */
describe('describeError', () => {
	it('maps a coded API error to its own key', () => {
		expect(
			describeError(new ApiError(409, 'x', { code: 'DUPLICATE_NAME' })).key,
		).toBe('error.duplicateName');
	});

	it('keeps a wrong password distinct from an expired session', () => {
		// These must never collapse: telling someone their session expired when
		// they simply mistyped the password sends them chasing the wrong problem.
		expect(
			describeError(new ApiError(401, 'x', { code: 'INVALID_PASSWORD' })).key,
		).toBe('login.invalidPassword');
		expect(
			describeError(new ApiError(401, 'x', { code: 'UNAUTHORIZED' })).key,
		).toBe('error.unauthorized');
	});

	it('falls back to the status when no code is present', () => {
		expect(describeError(new ApiError(403, 'x')).key).toBe('error.permission');
		expect(describeError(new ApiError(429, 'x')).key).toBe('error.rateLimited');
	});

	it('treats an unrecognised code as an unmapped response rather than crashing', () => {
		// Falls through to the status, so a newly added API code degrades to a
		// sensible message instead of showing the raw string.
		expect(
			describeError(new ApiError(403, 'x', { code: 'SOMETHING_NEW' })).key,
		).toBe('error.permission');
	});

	it('uses a server-error message for 5xx and a generic one for unmapped 4xx', () => {
		expect(describeError(new ApiError(500, 'x')).key).toBe('error.serverError');
		// 404 is deliberately unmapped: "not found" could be a project or a QR code.
		expect(describeError(new ApiError(404, 'x')).key).toBe(
			'common.genericError',
		);
	});

	it('distinguishes a network failure from any API response', () => {
		expect(describeError(new NetworkError()).key).toBe('error.network');
	});

	it('passes numeric meta through for interpolation', () => {
		const { key, vars } = describeError(
			new ApiError(413, 'x', {
				code: 'TOO_MANY_ROWS',
				meta: { total: 120000, max: 50000 },
			}),
		);
		expect(key).toBe('error.tooManyRows');
		expect(vars).toEqual({ total: 120000, max: 50000 });
	});

	it('drops non-scalar meta rather than interpolating objects', () => {
		const { vars } = describeError(
			new ApiError(400, 'x', {
				code: 'INVALID_BODY',
				meta: { nested: { a: 1 } },
			}),
		);
		expect(vars).toBeUndefined();
	});

	it('handles values that are not Errors at all', () => {
		expect(describeError('a string').key).toBe('common.genericError');
		expect(describeError(undefined).key).toBe('common.genericError');
	});

	it('exposes fields so a form can mark the offending input', () => {
		const error = new ApiError(409, 'x', {
			code: 'DUPLICATE_NAME',
			fields: ['name'],
		});
		expect(error.fields).toEqual(['name']);
		// Absent `fields` must be an empty array, not undefined — call sites read
		// `.length` directly.
		expect(new ApiError(500, 'x').fields).toEqual([]);
	});
});
