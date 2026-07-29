import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * safeStorage is the one unit that genuinely *cannot* be checked by hand: there
 * is no way to make DevTools throw from `localStorage.getItem`, and the bug it
 * guards against (Safari Private Browsing white-screening the whole app at
 * mount) only reproduces on a real device. A stubbed global is the only
 * practical proof.
 */
async function freshModule() {
	// The availability probe memoises, so each scenario needs a clean module.
	vi.resetModules();
	return (await import('./storage')).safeStorage;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('safeStorage', () => {
	it('reads and writes through to localStorage when it works', async () => {
		const store = new Map<string, string>();
		vi.stubGlobal('window', {
			localStorage: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => void store.set(k, v),
				removeItem: (k: string) => void store.delete(k),
			},
		});

		const safeStorage = await freshModule();
		safeStorage.set('k', 'v');
		expect(safeStorage.get('k')).toBe('v');
		safeStorage.remove('k');
		expect(safeStorage.get('k')).toBeNull();
	});

	it('does not throw when every localStorage call throws, and still round-trips in memory', async () => {
		vi.stubGlobal('window', {
			localStorage: {
				getItem: () => {
					throw new DOMException('blocked');
				},
				setItem: () => {
					throw new DOMException('blocked');
				},
				removeItem: () => {
					throw new DOMException('blocked');
				},
			},
		});

		const safeStorage = await freshModule();
		expect(() => safeStorage.set('token', 'abc')).not.toThrow();
		// The in-memory fallback keeps the session usable for the life of the tab.
		expect(safeStorage.get('token')).toBe('abc');
		expect(() => safeStorage.remove('token')).not.toThrow();
		expect(safeStorage.get('token')).toBeNull();
	});

	it('survives a write that exceeds quota while reads still work', async () => {
		const store = new Map<string, string>();
		vi.stubGlobal('window', {
			localStorage: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: () => {
					throw new DOMException('QuotaExceededError');
				},
				removeItem: (k: string) => void store.delete(k),
			},
		});

		const safeStorage = await freshModule();
		expect(() => safeStorage.set('locale', 'ja')).not.toThrow();
		// Falls back to memory rather than losing the value.
		expect(safeStorage.get('locale')).toBe('ja');
	});
});
