import { setPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
import { describe, expect, it } from 'vitest';

import { newKey } from './db-encryption.js';
import {
	DEVICE_KEY_DATABASE,
	KEY_AGREEMENT_INFO,
	forgetDeviceKeys,
	importDeviceKey,
	ownDeviceKeys,
	pairFromSigningKey,
	setUpDeviceKeys
} from './device-keys.js';
import { unwrapKey, wrapKey } from './key-wrapping.js';

/** Where the pair used to be kept, as JWK text. Nothing may be there now. */
const LEGACY = 'privacy01.deviceKey.';

/**
 * What this browser keeps for an identity, read straight from IndexedDB — what
 * a reload has, and nothing held in the module. Null when the database or the
 * entry is not there; the database is not created by looking.
 *
 * @param {string} did
 * @returns {Promise<any>}
 */
async function kept(did) {
	const names = (await indexedDB.databases()).map(({ name }) => name);
	if (!names.includes(DEVICE_KEY_DATABASE)) return null;
	const db = await new Promise((resolve, reject) => {
		const request = indexedDB.open(DEVICE_KEY_DATABASE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		return await new Promise((resolve, reject) => {
			const request = db.transaction('keys', 'readonly').objectStore('keys').get(did);
			request.onsuccess = () => resolve(request.result ?? null);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

/** A PRF output, as `readPrfOutput` returns one: 32 bytes. */
const prf = () => crypto.getRandomValues(new Uint8Array(32));

/** A keystore holding one signing key, the way OrbitDB's answers `getKey`. */
const keystoreWith = (/** @type {Uint8Array} */ raw) => ({ getKey: async () => ({ raw }) });

/**
 * The public half an X25519 seed gives, computed here without the module: the
 * fixed PKCS#8 prefix of RFC 8410 and the seed, imported and read back.
 *
 * @param {Uint8Array} seed
 */
async function publicKeyOfSeed(seed) {
	const pkcs8 = Uint8Array.from([
		0x30,
		0x2e,
		0x02,
		0x01,
		0x00,
		0x30,
		0x05,
		0x06,
		0x03,
		0x2b,
		0x65,
		0x6e,
		0x04,
		0x22,
		0x04,
		0x20,
		...seed
	]);
	const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, [
		'deriveBits'
	]);
	const { kty, crv, x } = await crypto.subtle.exportKey('jwk', key);
	return btoa(JSON.stringify({ kty, crv, x }));
}

/**
 * HKDF-SHA256 with an empty salt, as a reference.
 *
 * @param {Uint8Array} secret
 * @param {string} info
 */
async function hkdf(secret, info) {
	const material = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (secret),
		'HKDF',
		false,
		['deriveBits']
	);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: new Uint8Array(0),
				info: new TextEncoder().encode(info)
			},
			material,
			256
		)
	);
}

describe('device-keys from the PRF output', () => {
	it('derives one pair from one PRF output, on every device', async () => {
		// The owner's key copy is sealed to this pair, so a second device with the
		// same passkey has to arrive at the same pair — from the PRF output, and
		// from nothing stored in this browser.
		const output = prf();

		await forgetDeviceKeys('did:key:owner');
		const first = await setUpDeviceKeys('did:key:owner', { prfOutput: output });
		const copy = await wrapKey(newKey(), await importDeviceKey(first.publicKey));
		await forgetDeviceKeys('did:key:owner'); // a device that has never seen this identity

		const second = await setUpDeviceKeys('did:key:owner', { prfOutput: output });

		expect(first.source).toBe('prf');
		expect(second.publicKey).toBe(first.publicKey);
		expect(Array.from(await unwrapKey(copy, second.privateKey))).toEqual(
			Array.from(await unwrapKey(copy, first.privateKey))
		);
		// Nothing secret written down for it.
		expect(await kept('did:key:owner')).toBeNull();
		expect(localStorage.getItem(`${LEGACY}did:key:owner`)).toBeNull();
	});

	it('is HKDF over the PRF output under this chapter’s own label', async () => {
		// The scheme escrow01 uses too, under its label: deriveSubkey(prf, label),
		// 32 bytes, an X25519 seed as it stands. Pinned against a computation that
		// does not go through the module, so the label cannot drift unnoticed.
		expect(KEY_AGREEMENT_INFO).toBe('simple-todo/privacy01/list-key-agreement/v1');
		const output = prf();

		await forgetDeviceKeys('did:key:pinned');
		const pair = await setUpDeviceKeys('did:key:pinned', { prfOutput: output });

		expect(pair.publicKey).toBe(await publicKeyOfSeed(await hkdf(output, KEY_AGREEMENT_INFO)));
	});

	it('is not the pair the signing key gives', async () => {
		// The point of the change: the signing key and the encryption pair are
		// both derived from the PRF output, and neither from the other.
		const signingKey = crypto.getRandomValues(new Uint8Array(64));

		await forgetDeviceKeys('did:key:apart');
		const keys = await setUpDeviceKeys('did:key:apart', {
			prfOutput: prf(),
			keystore: keystoreWith(signingKey)
		});

		expect(keys.earlier).toHaveLength(1);
		expect(keys.publicKey).not.toBe(keys.earlier[0].publicKey);
		const forCurrent = await wrapKey(newKey(), await importDeviceKey(keys.publicKey));
		await expect(unwrapKey(forCurrent, keys.earlier[0].privateKey)).rejects.toThrow();
	});

	it('derives different pairs from different PRF outputs', async () => {
		await forgetDeviceKeys('did:key:a');
		await forgetDeviceKeys('did:key:b');
		const a = await setUpDeviceKeys('did:key:a', { prfOutput: prf() });
		const b = await setUpDeviceKeys('did:key:b', { prfOutput: prf() });

		expect(a.publicKey).not.toBe(b.publicKey);
	});

	it('cannot be read back out of the derived private half', async () => {
		await forgetDeviceKeys('did:key:sealed');
		const pair = await setUpDeviceKeys('did:key:sealed', { prfOutput: prf() });

		expect(pair.privateKey.extractable).toBe(false);
	});

	it('answers later callers with the pair set up for the session', async () => {
		// db-actions.js asks without the PRF output; it must get the derived pair,
		// not a pair kept in this browser.
		await forgetDeviceKeys('did:key:session');
		const set = await setUpDeviceKeys('did:key:session', { prfOutput: prf() });

		expect((await ownDeviceKeys('did:key:session')).publicKey).toBe(set.publicKey);
		expect(await kept('did:key:session')).toBeNull();
	});

	it('drops a pair this browser kept once the passkey gives PRF', async () => {
		setPersistentStorageEnabled(true);
		try {
			await forgetDeviceKeys('did:key:upgraded');
			await ownDeviceKeys('did:key:upgraded');
			expect(await kept('did:key:upgraded')).not.toBeNull();
			// And a JWK left from before, which nothing reads any more.
			localStorage.setItem(`${LEGACY}did:key:upgraded`, '{"publicKey":"old"}');

			await setUpDeviceKeys('did:key:upgraded', { prfOutput: prf() });

			expect(await kept('did:key:upgraded')).toBeNull();
			expect(localStorage.getItem(`${LEGACY}did:key:upgraded`)).toBeNull();
		} finally {
			setPersistentStorageEnabled(false);
		}
	});
});

describe('the earlier pair, from the signing key', () => {
	it('is the derivation #120 sealed to, bit for bit', async () => {
		// Copies sealed between #120 and the PRF derivation went to this pair. If
		// it changed by one bit, every one of them would stop opening.
		const signingKey = crypto.getRandomValues(new Uint8Array(64));
		const did = 'did:key:z4oJ8earlier';

		const pair = await pairFromSigningKey(did, signingKey);

		expect(pair.publicKey).toBe(
			await publicKeyOfSeed(await hkdf(signingKey, `privacy01/encryption-key/1|${did}`))
		);
	});

	it('opens a copy sealed to it, and leaves the signing key as it was', async () => {
		const signingKey = crypto.getRandomValues(new Uint8Array(64));
		const before = Array.from(signingKey);
		const did = 'did:key:reader';
		const copy = await wrapKey(
			newKey(),
			await importDeviceKey((await pairFromSigningKey(did, signingKey)).publicKey)
		);

		await forgetDeviceKeys(did);
		const keys = await setUpDeviceKeys(did, {
			prfOutput: prf(),
			keystore: keystoreWith(signingKey)
		});

		await expect(unwrapKey(copy, keys.privateKey)).rejects.toThrow();
		expect((await unwrapKey(copy, keys.earlier[0].privateKey)).length).toBe(32);
		// The keystore's own bytes: wiping them would break the signing key.
		expect(Array.from(signingKey)).toEqual(before);
	});

	it('is absent when there is no signing key to derive it from', async () => {
		await forgetDeviceKeys('did:key:fresh');
		const keys = await setUpDeviceKeys('did:key:fresh', {
			prfOutput: prf(),
			keystore: { getKey: async () => null }
		});

		expect(keys.earlier).toEqual([]);
	});
});

describe('device-keys without PRF', () => {
	it('keeps one pair per identity in this browser, so a reload can still unwrap', async () => {
		// Surviving a reload is only on offer when the reader asked for things to
		// be kept; in memory mode the pair dies with the tab, which is the point
		// of that choice (#9).
		setPersistentStorageEnabled(true);
		try {
			await forgetDeviceKeys('did:key:alice');
			const first = await setUpDeviceKeys('did:key:alice', { prfOutput: null });
			expect(first.source).toBe('browser');
			const copy = await wrapKey(newKey(), await importDeviceKey(first.publicKey));

			// What a reload actually has: what IndexedDB holds, and nothing held in
			// this module. So the kept private half is taken on its own and asked
			// to do the one job it exists for.
			const stored = await kept('did:key:alice');
			expect(stored?.publicKey).toBe(first.publicKey);
			expect(Array.from(await unwrapKey(copy, stored.privateKey))).toEqual(
				Array.from(await unwrapKey(copy, first.privateKey))
			);
			// Never as text: nothing in local storage, and no way to export it.
			expect(localStorage.getItem(`${LEGACY}did:key:alice`)).toBeNull();
			expect(stored.privateKey.extractable).toBe(false);
			await expect(crypto.subtle.exportKey('jwk', stored.privateKey)).rejects.toThrow();
		} finally {
			setPersistentStorageEnabled(false);
		}
	});

	it('keeps nothing on the device in memory mode', async () => {
		setPersistentStorageEnabled(false);
		await forgetDeviceKeys('did:key:passing');
		const keys = await setUpDeviceKeys('did:key:passing', { prfOutput: null });

		expect(keys.source).toBe('browser');
		expect(await kept('did:key:passing')).toBeNull();
		expect(localStorage.getItem(`${LEGACY}did:key:passing`)).toBeNull();
		// The tab still has it: asked again, the same pair.
		expect((await ownDeviceKeys('did:key:passing')).publicKey).toBe(keys.publicKey);
	});

	it('keeps the pair for the whole tab in memory mode, and takes it along to IndexedDB', async () => {
		// A second consent restarts the node in the same tab and sets the pair up
		// again. A new pair then would strand every copy sealed to the first.
		setPersistentStorageEnabled(false);
		try {
			await forgetDeviceKeys('did:key:restart');
			const first = await setUpDeviceKeys('did:key:restart', { prfOutput: null });
			const again = await setUpDeviceKeys('did:key:restart', { prfOutput: null });
			expect(again.publicKey).toBe(first.publicKey);
			expect(await kept('did:key:restart')).toBeNull();

			// Switching to "keep" keeps this pair, not a new one.
			setPersistentStorageEnabled(true);
			const keptNow = await setUpDeviceKeys('did:key:restart', { prfOutput: null });
			expect(keptNow.publicKey).toBe(first.publicKey);
			expect((await kept('did:key:restart'))?.publicKey).toBe(first.publicKey);
		} finally {
			await forgetDeviceKeys('did:key:restart');
			setPersistentStorageEnabled(false);
		}
	});

	it('is random, not derived from the signing key', async () => {
		// Without PRF there is nothing to derive an encryption pair from that the
		// signing key does not already give away, so it is drawn at random.
		const signingKey = crypto.getRandomValues(new Uint8Array(64));

		await forgetDeviceKeys('did:key:noprf');
		const keys = await setUpDeviceKeys('did:key:noprf', {
			prfOutput: null,
			keystore: keystoreWith(signingKey)
		});

		expect(keys.source).toBe('browser');
		expect(keys.publicKey).not.toBe(keys.earlier[0].publicKey);
	});

	it('gives two identities in one browser two pairs', async () => {
		// Two passkeys in one browser are two people here, and what was sealed
		// for one must not open for the other.
		await forgetDeviceKeys('did:key:one');
		await forgetDeviceKeys('did:key:two');
		const one = await ownDeviceKeys('did:key:one');
		const two = await ownDeviceKeys('did:key:two');

		expect(one.publicKey).not.toBe(two.publicKey);

		const forOne = await wrapKey(newKey(), await importDeviceKey(one.publicKey));
		await expect(unwrapKey(forOne, two.privateKey)).rejects.toThrow();
	});
});
