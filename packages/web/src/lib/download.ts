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
