/**
 * Saves a Blob to the user's downloads.
 *
 * The CSV download this replaces was broken in a way that produced *no* error:
 * the anchor was never appended to the document, and `URL.revokeObjectURL` ran
 * synchronously right after `.click()`. Firefox ignores a click on a detached
 * anchor, and revoking before the browser has read the blob can abort the save
 * elsewhere. Since `res.ok` had been true, nothing was reported — the user
 * clicked Download and nothing ever happened, forever.
 *
 * Also the right shape for the QR PNG: `<a href="data:...">` is unreliable on iOS
 * Safari, where it tends to navigate in-tab instead of saving and so destroys the
 * dialog state behind it.
 */
/**
 * Reads the filename the server chose out of Content-Disposition.
 *
 * Needed because `fetch` + blob saves under whatever name the client passes, so
 * the header the API carefully builds is otherwise thrown away. The server is the
 * only side that knows the full picture for a combined export — how many projects
 * were included and what date range came back — so it should win.
 *
 * Prefers the RFC 5987 `filename*=UTF-8''…` form over the ASCII `filename="…"`
 * fallback, which is the whole reason the API sends both: the fallback has every
 * Japanese character replaced with an underscore.
 *
 * Returns null rather than guessing, so the caller keeps its own default.
 */
export function filenameFromResponse(response: Response): string | null {
	const header = response.headers.get('Content-Disposition');
	if (!header) return null;

	const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
	if (utf8?.[1]) {
		try {
			return decodeURIComponent(utf8[1].trim()) || null;
		} catch {
			// Malformed percent-encoding: fall through to the ASCII form.
		}
	}

	const ascii = /filename\s*=\s*"([^"]*)"/i.exec(header);
	return ascii?.[1]?.trim() || null;
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	// Appended, so the click counts in every browser.
	anchor.style.display = 'none';
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	// Deferred: give the browser a turn to start reading the blob before the URL
	// is invalidated.
	window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
