import { remember } from '@simple-todo/todo/browser-memory.js';
import { setPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { forgetDatabaseKey, rememberKeys, storedDatabaseKey, storedKeys } from './database-keys.js';
import { newKey } from './db-encryption.js';
import { createKeyring, epochKey } from './keyring.js';

const ADDRESS = '/orbitdb/zdpuDatabaseKeysSpecList';

describe('database-keys', () => {
	beforeEach(() => {
		setPersistentStorageEnabled(true);
		forgetDatabaseKey(ADDRESS);
	});
	afterEach(() => setPersistentStorageEnabled(false));

	it('keeps every epoch of a list and reads them back', async () => {
		const keyring = createKeyring([await epochKey(newKey(), 0), await epochKey(newKey(), 1)]);

		expect(rememberKeys(ADDRESS, keyring)).toBe(true);
		const back = (await storedKeys(ADDRESS)) ?? [];

		expect(back.map(({ epoch, keyId }) => ({ epoch, keyId }))).toEqual(
			keyring.all().map(({ epoch, keyId }) => ({ epoch, keyId }))
		);
		// The key new entries are sealed under is the newest one.
		expect(Array.from(storedDatabaseKey(ADDRESS) ?? [])).toEqual(
			Array.from(/** @type {any} */ (keyring.current()).key)
		);
	});

	it('reads a key written before epochs as epoch 0', async () => {
		// Phase 1 stored a bare base64 key. A list sealed then must stay readable.
		const key = newKey();
		remember(`privacy01.dbKey.${ADDRESS}`, btoa(String.fromCharCode(...key)));

		const back = (await storedKeys(ADDRESS)) ?? [];

		expect(back).toHaveLength(1);
		expect(back[0].epoch).toBe(0);
		expect(Array.from(back[0].key)).toEqual(Array.from(key));
	});

	it('says there is nothing when nothing was kept', async () => {
		expect(await storedKeys(ADDRESS)).toBeNull();
		expect(storedDatabaseKey(ADDRESS)).toBeNull();
	});

	it('refuses stored keys that are not readable rather than replacing them', async () => {
		remember(`privacy01.dbKey.${ADDRESS}`, 'not base64 ***');

		// Treating this as "no key" would let a caller seal new entries under a
		// fresh key that cannot open the old ones — silently, and only noticed
		// once something is unreadable.
		await expect(storedKeys(ADDRESS)).rejects.toThrow();
		expect(() => storedDatabaseKey(ADDRESS)).toThrow();
	});

	it('forgets the keys of a list on request', async () => {
		rememberKeys(ADDRESS, createKeyring([await epochKey(newKey(), 0)]));
		forgetDatabaseKey(ADDRESS);

		expect(await storedKeys(ADDRESS)).toBeNull();
	});
});

describe('keyring', () => {
	it('writes under the highest epoch, and agrees on a tie', async () => {
		// The same passkey revoking from two devices at once makes two keys of
		// one epoch. Every device holding both has to pick the same one.
		const zero = await epochKey(newKey(), 0);
		const a = await epochKey(newKey(), 1);
		const b = await epochKey(newKey(), 1);

		const one = createKeyring([zero, a, b]);
		const other = createKeyring([b, zero, a]);

		expect(one.current()?.keyId).toBe(other.current()?.keyId);
		expect(one.current()?.epoch).toBe(1);
		expect(one.nextEpoch()).toBe(2);
	});

	it('finds a key by the id an entry carries, and adds each key once', async () => {
		const key = await epochKey(newKey(), 0);
		const keyring = createKeyring([key]);

		expect(keyring.add(await epochKey(key.key, 0))).toBe(false);
		expect(keyring.get(key.keyId)?.key).toBe(key.key);
		expect(keyring.size).toBe(1);
	});

	it('gives two keys two ids', async () => {
		expect((await epochKey(newKey(), 0)).keyId).not.toBe((await epochKey(newKey(), 0)).keyId);
	});
});
