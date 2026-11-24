import { setPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { forgetDatabaseKey, rememberKeys, storedKeys } from './database-keys.js';
import { newKey } from './db-encryption.js';
import { forgetKeyring, isSealedDatabase, keyringFor, openEncrypted } from './encrypted-open.js';
import { createKeyring, epochKey } from './keyring.js';

const ADDRESS = '/orbitdb/zdpuTestAddressForEncryptedOpenSpec';
const OTHER = '/orbitdb/zdpuSomeOtherList';

/**
 * An OrbitDB stand-in that records what it was opened with, and — like the
 * real one (`orbitdb.js:121-123`) — hands back a database it already has open
 * and ignores the options.
 */
function fakeOrbitDb(address = ADDRESS) {
	/** @type {any[]} */
	const opened = [];
	/** @type {any} */
	let open = null;
	return {
		opened,
		/** @param {string} target @param {any} options */
		async open(target, options) {
			opened.push({ target, options });
			if (open) return open;
			const database = {
				address: { toString: () => address },
				name: target,
				access: { write: ['did:key:owner'] },
				sealed: typeof options?.encryption?.data?.encrypt === 'function',
				async close() {
					open = null;
				}
			};
			open = database;
			return database;
		}
	};
}

/** @param {any} options */
const sealsEntries = (options) => typeof options?.encryption?.data?.encrypt === 'function';

describe('encrypted-open', () => {
	beforeEach(() => {
		// Sealing needs a key that outlives the page, so these cases choose the
		// storage that keeps one. In memory mode the module opens in the clear on
		// purpose -- see the case that proves it below (#9).
		setPersistentStorageEnabled(true);
		for (const address of [ADDRESS, OTHER]) {
			forgetDatabaseKey(address);
			forgetKeyring(address);
		}
	});

	it('opens a list it holds the key for with an encryptor', async () => {
		const orbitdb = fakeOrbitDb();
		// As if this device had created it earlier.
		rememberKeys(ADDRESS, createKeyring([await epochKey(newKey(), 0)]));

		const database = await openEncrypted(orbitdb, ADDRESS, { type: 'keyvalue' });

		expect(sealsEntries(orbitdb.opened[0].options)).toBe(true);
		expect(isSealedDatabase(database)).toBe(true);
		// The passed-through options survive rather than being replaced.
		expect(orbitdb.opened[0].options.type).toBe('keyvalue');
	});

	it("opens somebody else's list in the clear instead of inventing a key", async () => {
		// A guest reaches a list by address and holds no key for it. Sealing it
		// would write entries under a key its owner does not have — a broken
		// list rather than a private one.
		const orbitdb = fakeOrbitDb();

		const database = await openEncrypted(orbitdb, ADDRESS, { type: 'keyvalue' });

		expect(sealsEntries(orbitdb.opened[0].options)).toBe(false);
		expect(isSealedDatabase(database)).toBe(false);
		expect(localStorage.getItem(`privacy01.dbKey.${ADDRESS}`)).toBeNull();
	});

	it('asks the open list who its admins are, then reopens it sealed', async () => {
		// Whose copies count is decided by the list's access controller, so the
		// list has to be open before the copies can be judged — and the plain
		// instance has to go, or `orbitdb.open` hands it back without the
		// decryptor.
		const orbitdb = fakeOrbitDb();
		const copy = await epochKey(newKey(), 0);
		/** @type {any[]} */
		const askedWith = [];

		const database = await openEncrypted(
			orbitdb,
			ADDRESS,
			{ type: 'keyvalue' },
			{
				findSharedKeys: async (address, plain) => {
					askedWith.push({ address, access: plain.access, sealed: plain.sealed });
					return [copy];
				}
			}
		);

		expect(askedWith).toEqual([
			{ address: ADDRESS, access: { write: ['did:key:owner'] }, sealed: false }
		]);
		expect(database.sealed).toBe(true);
		expect(isSealedDatabase(database)).toBe(true);
		expect((await storedKeys(ADDRESS))?.map((key) => key.keyId)).toEqual([copy.keyId]);
	});

	it('closes a list it opened in the clear before sealing it', async () => {
		// A reader opened the list before a key was here; then the key arrived.
		// The cached plain instance would come back from `orbitdb.open` with the
		// encryptor silently dropped.
		const orbitdb = fakeOrbitDb();
		const plain = await openEncrypted(orbitdb, ADDRESS, { type: 'keyvalue' });
		keyringFor(ADDRESS).add(await epochKey(newKey(), 0));

		const sealed = await openEncrypted(orbitdb, ADDRESS, { type: 'keyvalue' });

		expect(sealed).not.toBe(plain);
		expect(sealed.sealed).toBe(true);
	});

	it('files a new list under its address, not the name it was created with', async () => {
		// The trap this module exists for: a list is created by name and reopened
		// by address. A key filed under the name is not found on the next load, a
		// fresh one is generated, and yesterday's todos are unreadable.
		const orbitdb = fakeOrbitDb();

		await openEncrypted(orbitdb, 'groceries-m4x2', { type: 'keyvalue' });

		expect(localStorage.getItem('privacy01.dbKey.groceries-m4x2')).toBeNull();
		expect(localStorage.getItem(`privacy01.dbKey.${ADDRESS}`)).not.toBeNull();
		expect(keyringFor(ADDRESS).size).toBe(1);
	});

	it('reads the same list back with the same key after a reload', async () => {
		// The acceptance test of Phase 1, at the seam: create under a name, then
		// reopen by address the way the registry does it, and the key must be the
		// one that sealed the entries rather than a new one.
		await openEncrypted(fakeOrbitDb(), 'groceries-m4x2', { type: 'keyvalue' });
		const sealedWith = localStorage.getItem(`privacy01.dbKey.${ADDRESS}`);
		forgetKeyring(ADDRESS); // what a reload does to everything in memory

		const reopening = fakeOrbitDb();
		await openEncrypted(reopening, ADDRESS, { type: 'keyvalue' });

		expect(localStorage.getItem(`privacy01.dbKey.${ADDRESS}`)).toBe(sealedWith);
		expect(sealsEntries(reopening.opened[0].options)).toBe(true);
	});

	it('opens in the clear rather than sealing what it could never open again', async () => {
		// No storage: a key that lives only for this page load would seal entries
		// nothing can read after a reload — worse than not sealing them at all.
		const orbitdb = fakeOrbitDb();
		const setItem = localStorage.setItem;
		localStorage.setItem = () => {
			throw new Error('storage is blocked');
		};

		try {
			await openEncrypted(orbitdb, 'groceries-m4x2', { type: 'keyvalue' });
		} finally {
			localStorage.setItem = setItem;
		}

		expect(sealsEntries(orbitdb.opened[0].options)).toBe(false);
		expect(orbitdb.opened[0].options.type).toBe('keyvalue');
	});

	it('gives two lists two keys', async () => {
		await openEncrypted(fakeOrbitDb(), 'one-list', {});
		await openEncrypted(fakeOrbitDb(OTHER), 'other-list', {});

		expect(keyringFor(ADDRESS).current()?.keyId).not.toBe(keyringFor(OTHER).current()?.keyId);
	});
});
