/**
 * localStorage that cannot take the app down.
 *
 * Safari Private Browsing, storage-blocked contexts and a full quota all throw
 * on plain `localStorage` access — including the getter. Two call sites made
 * that fatal: the token accessors, and `detectDefaultLocale` inside a
 * `useState` initialiser, where a throw white-screens the entire app at mount.
 * Staff share phones on site and open links in private tabs, so this is a
 * realistic way to lose the admin UI completely.
 *
 * Falls back to an in-memory map: the session and the language switch keep
 * working for the life of the tab, they just do not persist.
 */
const memory = new Map<string, string>();
let available: boolean | null = null;

function probe(): boolean {
	if (available !== null) return available;
	try {
		const probeKey = '__tracking_link_probe__';
		window.localStorage.setItem(probeKey, '1');
		window.localStorage.removeItem(probeKey);
		available = true;
	} catch {
		available = false;
	}
	return available;
}

export const safeStorage = {
	get(key: string): string | null {
		if (!probe()) return memory.get(key) ?? null;
		try {
			return window.localStorage.getItem(key);
		} catch {
			return memory.get(key) ?? null;
		}
	},

	set(key: string, value: string): void {
		// The memory copy is written first and unconditionally, so a quota error
		// below still leaves the value readable for this tab.
		memory.set(key, value);
		if (!probe()) return;
		try {
			window.localStorage.setItem(key, value);
		} catch {
			/* quota exceeded or blocked — memory copy already holds it */
		}
	},

	remove(key: string): void {
		memory.delete(key);
		if (!probe()) return;
		try {
			window.localStorage.removeItem(key);
		} catch {
			/* nothing useful to do */
		}
	},
};
