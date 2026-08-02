import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Stable, machine-readable error codes.
 *
 * The point of these is that the *client* owns the wording. Before this existed,
 * the API returned English developer strings ("Invalid request body") and, in
 * the 409 case, a hardcoded Japanese sentence — so a Japanese user saw English,
 * an English user saw Japanese, and neither could be translated because the
 * message was decided on the server. The web app maps `code` to an i18n key
 * instead; `error` is only a fallback for curl and logs.
 *
 * Codes are part of the API contract: rename one and the web app silently falls
 * back to a generic message.
 */
export const ErrorCodes = {
	UNAUTHORIZED: 'UNAUTHORIZED',
	PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
	INVALID_PASSWORD: 'INVALID_PASSWORD',
	PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
	NOT_OWNER: 'NOT_OWNER',
	INVALID_BODY: 'INVALID_BODY',
	// Distinct from INVALID_BODY so the form can name the keyword and list the
	// configured ones, instead of reporting a generic bad body for a field the user
	// picked from a dropdown.
	FALLBACK_KEY_NOT_CONFIGURED: 'FALLBACK_KEY_NOT_CONFIGURED',
	NO_FIELDS_TO_UPDATE: 'NO_FIELDS_TO_UPDATE',
	PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
	QR_CODE_NOT_FOUND: 'QR_CODE_NOT_FOUND',
	DUPLICATE_NAME: 'DUPLICATE_NAME',
	/**
	 * Could not mint a unique short code for a new QR code. Distinct from a
	 * generic 500 because it is retryable by simply trying again, and because
	 * seeing it at all would mean the keyspace assumption in short-code.ts is
	 * wrong.
	 */
	SHORT_CODE_UNAVAILABLE: 'SHORT_CODE_UNAVAILABLE',
	CSV_EXPORT_DISABLED: 'CSV_EXPORT_DISABLED',
	TOO_MANY_ROWS: 'TOO_MANY_ROWS',
	RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const FALLBACK_MESSAGES: Record<ErrorCode, string> = {
	UNAUTHORIZED: 'Authentication required',
	PASSWORD_REQUIRED: 'Password is required',
	INVALID_PASSWORD: 'Invalid password',
	PERMISSION_REQUIRED: 'Insufficient permissions',
	NOT_OWNER: 'You can only modify items you created',
	INVALID_BODY: 'Invalid request body',
	FALLBACK_KEY_NOT_CONFIGURED:
		'That fallback keyword is not in FALLBACK_DESTINATIONS',
	NO_FIELDS_TO_UPDATE: 'No fields to update',
	PROJECT_NOT_FOUND: 'Project not found',
	QR_CODE_NOT_FOUND: 'QR code not found',
	DUPLICATE_NAME: 'A QR code with this name already exists in this project',
	SHORT_CODE_UNAVAILABLE:
		'Could not allocate a short code for this QR code — please try again',
	CSV_EXPORT_DISABLED: 'CSV export is not enabled',
	TOO_MANY_ROWS: 'Too many rows — narrow the date range',
	RATE_LIMITED: 'Too many attempts — try again shortly',
};

export interface FailOptions {
	/** Fields the client should mark invalid, e.g. ['name']. */
	fields?: string[];
	/** Machine-readable context, e.g. { total, max } for TOO_MANY_ROWS. */
	meta?: Record<string, unknown>;
	/** Overrides the English fallback text. Never shown to a logged-in user. */
	message?: string;
	/** Zod's flattened issues, for debugging a rejected body. */
	details?: unknown;
}

/**
 * Respond with a coded error.
 *
 * Takes a `Context<any>` rather than `Context<HonoEnv>` deliberately: importing
 * HonoEnv here would make errors.ts and auth/ import each other, and this
 * helper genuinely does not care about the env.
 */
export function fail(
	c: Context<any>,
	status: ContentfulStatusCode,
	code: ErrorCode,
	options: FailOptions = {},
) {
	return c.json(
		{
			code,
			error: options.message ?? FALLBACK_MESSAGES[code],
			...(options.fields ? { fields: options.fields } : {}),
			...(options.meta ? { meta: options.meta } : {}),
			...(options.details ? { details: options.details } : {}),
		},
		status,
	);
}
