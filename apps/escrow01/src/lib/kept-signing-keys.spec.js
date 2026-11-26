import { describe, expect, it } from 'vitest';
import { KEPT_SIGNING_KEYS_DATABASE, dropKeptSigningKeys } from './kept-signing-keys.js';

/** @param {string} name */
function createDatabase(name) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, 1);
		request.onupgradeneeded = () => request.result.createObjectStore('keys');
		request.onsuccess = () => {
			const database = request.result;
			const put = database.transaction('keys', 'readwrite').objectStore('keys');
			put.put('a stand-in, not a key', 'private_did:key:zDnaeExample');
			put.transaction.oncomplete = () => {
				database.close();
				resolve(undefined);
			};
		};
		request.onerror = () => reject(request.error);
	});
}

async function databaseNames() {
	return (await indexedDB.databases()).map((database) => database.name);
}

describe('the signing keys an earlier build kept', () => {
	it('are deleted with the database that held them', async () => {
		await createDatabase(KEPT_SIGNING_KEYS_DATABASE);
		expect(await databaseNames()).toContain(KEPT_SIGNING_KEYS_DATABASE);

		await expect(dropKeptSigningKeys()).resolves.toBe(true);
		expect(await databaseNames()).not.toContain(KEPT_SIGNING_KEYS_DATABASE);
	});

	it('leave nothing to do when there are none', async () => {
		await expect(dropKeptSigningKeys()).resolves.toBe(false);
	});

	it('take nothing else along, the anonymous identity’s keystore included', async () => {
		const anonymous = 'level-js-simple-todo/orbitdb/keystore';
		await createDatabase(anonymous);
		await createDatabase(KEPT_SIGNING_KEYS_DATABASE);

		await dropKeptSigningKeys();
		expect(await databaseNames()).toContain(anonymous);

		await new Promise((resolve) => {
			const request = indexedDB.deleteDatabase(anonymous);
			request.onsuccess = request.onerror = () => resolve(undefined);
		});
	});
});
