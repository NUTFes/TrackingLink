// Structured logging.
//
// Cloudflare's Workers Logs indexes the fields of single-line JSON, so emitting
// objects instead of interpolated strings is what makes an event like
// `access_log_insert_failed` a filterable metric rather than a needle in a
// haystack. `observability` is enabled in wrangler.jsonc, so these show up
// without any further setup.

type LogFields = Record<string, unknown>;

/** Emit an informational event. */
export function logEvent(event: string, fields: LogFields = {}): void {
	console.log(JSON.stringify({ event, ...fields }));
}

/** Emit a failure. `error` is reduced to its message — stacks are noise here. */
export function logFailure(
	event: string,
	error: unknown,
	fields: LogFields = {},
): void {
	console.error(
		JSON.stringify({
			event,
			...fields,
			error: error instanceof Error ? error.message : String(error),
		}),
	);
}
