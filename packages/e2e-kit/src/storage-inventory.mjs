/**
 * Everything a page left on the device, counted rather than guessed at.
 *
 * The assertion this replaces filtered IndexedDB *names* for `simple-todo`,
 * which is how a keystore named `level-js-orbitdb/keystore` sat there holding a
 * signing key while a test called the device clean (#9). A name filter goes
 * stale the moment the app writes something under a name nobody thought of, so
 * this asks the browser what exists and looks inside.
 *
 * Empty databases are reported too, with `records: 0`: they are created as a
 * side effect of opening a store and say nothing about what was kept, but a
 * caller that wants to hold the line at "no database at all" can see them.
 *
 * Caches are listed by name only. The app shell is what a service worker keeps
 * there, and that is the app itself rather than anything about its reader.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{
 *   indexedDB: { name: string, records: number }[],
 *   localStorage: string[],
 *   sessionStorage: string[],
 *   caches: string[]
 * }>}
 */
export async function takeStorageInventory(page) {
	return page.evaluate(async () => {
		/** @type {{ name: string, records: number }[]} */
		const databases = [];
		if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
			for (const entry of await indexedDB.databases()) {
				const name = entry.name ?? '';
				if (!name) continue;
				const database = await new Promise((resolve) => {
					const request = indexedDB.open(name);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => resolve(null);
					// A version change we did not ask for means somebody else owns it.
					request.onblocked = () => resolve(null);
				});
				if (!database) {
					databases.push({ name, records: -1 });
					continue;
				}
				let records = 0;
				for (const store of Array.from(database.objectStoreNames)) {
					records += await new Promise((resolve) => {
						const request = database.transaction(store, 'readonly').objectStore(store).count();
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => resolve(0);
					});
				}
				database.close();
				databases.push({ name, records });
			}
		}

		/** @param {Storage | undefined} store */
		const keysOf = (store) => {
			try {
				return store ? Object.keys(store) : [];
			} catch {
				// Blocked storage reads as empty, which is what it is from here.
				return [];
			}
		};

		let cacheNames = [];
		try {
			cacheNames = typeof caches === 'undefined' ? [] : await caches.keys();
		} catch {
			// Same.
		}

		return {
			indexedDB: databases,
			localStorage: keysOf(globalThis.localStorage),
			sessionStorage: keysOf(globalThis.sessionStorage),
			caches: cacheNames
		};
	});
}
