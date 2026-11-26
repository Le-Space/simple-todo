import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getPersistentStorageEnabled,
	setPersistentStorageEnabled
} from '@simple-todo/todo/storage-mode.js';
import {
	AGREEMENT_KEY_DATABASE,
	forgetAgreementKey,
	keptAgreementKey,
	ownAgreementKey
} from './own-agreement-key.js';
import { agreementKeyFromPrf, unwrapKey, wrapKey } from './key-agreement.js';
import { newEpochKey } from './key-ring.js';

const alice = 'did:key:zDnaeAliceExample';
const bob = 'did:key:zDnaeBobExample';
const prf = (/** @type {number} */ fill) => new Uint8Array(32).fill(fill);

/** What sits in the key database, read past the module. */
async function storedRecords() {
	const database = await new Promise((resolve, reject) => {
		const request = indexedDB.open(AGREEMENT_KEY_DATABASE, 1);
		request.onupgradeneeded = () => request.result.createObjectStore('keys');
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		return await new Promise((resolve, reject) => {
			const request = database.transaction('keys', 'readonly').objectStore('keys').getAll();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
}

let persistentBefore = false;

beforeEach(() => {
	persistentBefore = getPersistentStorageEnabled();
});

afterEach(async () => {
	await forgetAgreementKey(alice);
	await forgetAgreementKey(bob);
	setPersistentStorageEnabled(persistentBefore);
});

describe('the session’s own key, with "Keep in this browser"', () => {
	beforeEach(() => setPersistentStorageEnabled(true));

	it('comes from a PRF output at hand, without asking the passkey', async () => {
		let asked = 0;
		const own = await ownAgreementKey({
			did: alice,
			prfOutput: prf(5),
			readPrfOutput: async () => {
				asked += 1;
				return prf(5);
			}
		});

		expect(asked).toBe(0);
		expect(own?.source).toBe('prf');
		expect(own?.publicKey).toEqual((await agreementKeyFromPrf(prf(5))).publicKey);
	});

	it('is held for the tab only when the passkey can derive it again', async () => {
		const own = await ownAgreementKey({ did: alice, prfOutput: prf(5) });

		// Nothing on the device: the next start derives it from its own touch.
		expect(await storedRecords()).toEqual([]);

		const again = await ownAgreementKey({
			did: alice,
			readPrfOutput: async () => {
				throw new Error('the tab already holds the key');
			}
		});
		const copy = await wrapKey(newEpochKey(), /** @type {Uint8Array} */ (own?.publicKey), {
			slot: 's'
		});
		await expect(unwrapKey(copy, /** @type {any} */ (again), { slot: 's' })).resolves.toHaveLength(
			32
		);
	});

	it('holds one key per identity', async () => {
		await ownAgreementKey({ did: alice, prfOutput: prf(5) });
		await ownAgreementKey({ did: bob, prfOutput: prf(6) });

		expect((await keptAgreementKey(alice))?.publicKey).toEqual(
			(await agreementKeyFromPrf(prf(5))).publicKey
		);
		expect((await keptAgreementKey(bob))?.publicKey).toEqual(
			(await agreementKeyFromPrf(prf(6))).publicKey
		);
	});

	it('keeps a device key, and only as a key that cannot be exported', async () => {
		const own = await ownAgreementKey({ did: alice, readPrfOutput: async () => null });
		const [record] = /** @type {any[]} */ (await storedRecords());

		expect(own?.source).toBe('device');
		expect(record.source).toBe('device');
		expect(record.privateKey).toBeInstanceOf(CryptoKey);
		expect(record.privateKey.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('pkcs8', record.privateKey)).rejects.toThrow();
		expect(record.publicKey).toEqual(own?.publicKey);
	});

	it('sits where the storage wipe deletes', () => {
		// `wipePersistentStorage()` deletes the databases under this prefix. Not
		// called here: it also clears localStorage, which other specs share.
		expect(AGREEMENT_KEY_DATABASE.startsWith('level-js-simple-todo/')).toBe(true);
	});
});

describe('the session’s own key, with nothing at hand', () => {
	beforeEach(() => setPersistentStorageEnabled(true));

	it('is null rather than a key of its own making', async () => {
		await expect(ownAgreementKey({ did: alice })).resolves.toBeNull();
		await expect(keptAgreementKey(alice)).resolves.toBeNull();
	});

	it('asks the passkey once when told how, as after a restore', async () => {
		let asked = 0;
		const read = async () => {
			asked += 1;
			return prf(5);
		};
		const own = await ownAgreementKey({ did: alice, readPrfOutput: read });
		await ownAgreementKey({ did: alice, readPrfOutput: read });

		expect(asked).toBe(1);
		expect(own?.source).toBe('prf');
		expect(own?.publicKey).toEqual((await agreementKeyFromPrf(prf(5))).publicKey);
	});

	it('without PRF is a device key, and the same one next time', async () => {
		const own = await ownAgreementKey({ did: alice, readPrfOutput: async () => null });
		const next = await ownAgreementKey({ did: alice });

		expect(own?.source).toBe('device');
		expect(own?.privateKey.extractable).toBe(false);
		expect(next?.publicKey).toEqual(own?.publicKey);
	});

	it('lets a refused prompt through', async () => {
		const refused = Object.assign(new Error('The operation either timed out or was not allowed.'), {
			name: 'NotAllowedError'
		});
		await expect(
			ownAgreementKey({ did: alice, readPrfOutput: () => Promise.reject(refused) })
		).rejects.toBe(refused);
		await expect(keptAgreementKey(alice)).resolves.toBeNull();
	});

	it('needs an identity to belong to', async () => {
		await expect(ownAgreementKey({ did: '' })).rejects.toThrow(TypeError);
	});
});

describe('the session’s own key, in memory only', () => {
	beforeEach(() => setPersistentStorageEnabled(false));

	it('writes nothing to the device and still holds the key for the tab', async () => {
		const own = await ownAgreementKey({ did: alice, prfOutput: prf(5) });

		expect(await storedRecords()).toEqual([]);
		expect((await keptAgreementKey(alice))?.publicKey).toEqual(own?.publicKey);
	});

	it('does not create the key database by looking for a key, or forgetting one', async () => {
		await new Promise((resolve) => {
			const request = indexedDB.deleteDatabase(AGREEMENT_KEY_DATABASE);
			request.onsuccess = request.onerror = () => resolve(undefined);
		});
		await ownAgreementKey({ did: alice });
		await forgetAgreementKey(alice);
		const names = (await indexedDB.databases()).map((database) => database.name);
		expect(names).not.toContain(AGREEMENT_KEY_DATABASE);
	});

	it('forgets the key when told to', async () => {
		await ownAgreementKey({ did: alice, readPrfOutput: async () => null });
		await forgetAgreementKey(alice);
		await expect(keptAgreementKey(alice)).resolves.toBeNull();
	});
});
