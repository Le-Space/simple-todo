import { describe, expect, it } from 'vitest';

import * as dagCbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';
import { sha256 } from 'multiformats/hashes/sha2';

import { newKey, sealer } from './db-encryption.js';
import { payloadEncryption, SEALED_OP } from './entry-encryption.js';
import { createKeyring, epochKey } from './keyring.js';

/** A keyring holding one fresh key per epoch given. */
async function keyringWith(/** @type {number[]} */ epochs = [0]) {
	return createKeyring(await Promise.all(epochs.map((epoch) => epochKey(newKey(), epoch))));
}

/** @param {string} text */
const bytes = (text) => new TextEncoder().encode(text);
/** @param {Uint8Array} value */
const text = (value) => new TextDecoder().decode(value);

/**
 * What OrbitDB does with whatever `decrypt` returns.
 *
 * `entry.js:181-182` hands the bytes straight to `Block.decode` and uses the
 * `.value`, so a test that stops at "some bytes came back" stops one step
 * short of the guarantee. This is that step, with the same codec and hasher.
 *
 * @param {Uint8Array} decrypted
 */
const asOrbitDbReadsIt = async (decrypted) =>
	(await Block.decode({ bytes: decrypted, codec: dagCbor, hasher: sha256 })).value;

/** A payload shaped the way the todo list actually writes them. */
const todoPayload = {
	op: 'PUT',
	key: 'todo_1788464831143_z2kcdly3v',
	value: {
		text: 'buy milk',
		assignee: null,
		completed: false,
		createdAt: '2026-09-03T19:27:41.971Z'
	}
};

describe('entry-encryption', () => {
	it('seals and opens what OrbitDB hands it', async () => {
		const { data } = await payloadEncryption(await keyringWith());
		const sealed = await data.encrypt(bytes('milk'));

		expect(sealed.sealed).not.toEqual(bytes('milk'));
		expect(text(await data.decrypt(sealed))).toBe('milk');
	});

	it('returns a real todo unchanged through the round trip', async () => {
		const { data } = await payloadEncryption(await keyringWith());
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });

		const sealed = await data.encrypt(encoded.bytes);

		expect(await asOrbitDbReadsIt(await data.decrypt(sealed))).toEqual(todoPayload);
	});

	it('survives being stored the way OrbitDB stores a payload', async () => {
		// `entry.js` puts whatever `encrypt` returns into the entry and dag-cbor
		// encodes the lot. The tag has to come back out of that unchanged.
		const { data } = await payloadEncryption(await keyringWith());
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });
		const stored = await Block.encode({
			value: { payload: await data.encrypt(encoded.bytes) },
			codec: dagCbor,
			hasher: sha256
		});

		const { payload } = /** @type {any} */ (await asOrbitDbReadsIt(stored.bytes));

		expect(await asOrbitDbReadsIt(await data.decrypt(payload))).toEqual(todoPayload);
	});

	it('gives back the same todo that was written before encryption', async () => {
		const { data } = await payloadEncryption(await keyringWith());

		// Not sealed: what `entry.js` stored before this database was sealed.
		// The assertion is the whole point of the migration — not that bytes
		// come back, but that they decode to the todo somebody wrote. A
		// passthrough that returned different bytes would satisfy "is a
		// Uint8Array, length > 0" and still lose every existing entry.
		const decoded = await asOrbitDbReadsIt(await data.decrypt(todoPayload));

		expect(decoded).toEqual(todoPayload);
	});

	it('reads a log holding both, which is what switching encryption on creates', async () => {
		// Encryption is not in the manifest, so turning it on keeps the address
		// and the old entries. The mixture is the normal state of a migrated
		// list, not an edge case, and one encryptor has to read both.
		const { data } = await payloadEncryption(await keyringWith());
		const older = { op: 'PUT', key: 'todo_before', value: { text: 'written in plaintext' } };
		const newer = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });

		const sealed = await data.encrypt(newer.bytes);

		expect(await asOrbitDbReadsIt(await data.decrypt(older))).toEqual(older);
		expect(await asOrbitDbReadsIt(await data.decrypt(sealed))).toEqual(todoPayload);
	});

	it('still opens an entry sealed before keys had ids', async () => {
		// Bare `nonce ‖ ciphertext`, which is what a list sealed before #120
		// holds. One key per list then, so whichever key opens it is the one.
		const keyring = await keyringWith([0]);
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });
		const legacy = await (
			await sealer(/** @type {any} */ (keyring.current()).key)
		).seal(encoded.bytes);
		keyring.add(await epochKey(newKey(), 1));
		const { data } = await payloadEncryption(keyring);

		expect(await asOrbitDbReadsIt(await data.decrypt(legacy))).toEqual(todoPayload);
	});

	it('seals new entries under the newest key, also one added after opening', async () => {
		// After a revoke the very next entry has to be sealed under the new key,
		// without the list being reopened — the encryptor reads the keyring as it
		// is now, not as it was when the list was opened.
		const keyring = await keyringWith([0]);
		const { data } = await payloadEncryption(keyring);
		const before = await data.encrypt(bytes('before'));

		const next = await epochKey(newKey(), 1);
		keyring.add(next);
		const after = await data.encrypt(bytes('after'));

		expect(before.keyId).not.toBe(next.keyId);
		expect(after.keyId).toBe(next.keyId);
		expect(text(await data.decrypt(before))).toBe('before');
		expect(text(await data.decrypt(after))).toBe('after');
	});

	it('does not throw for an entry sealed under a key this reader lacks', async () => {
		// A removed reader keeps replicating the list and receives entries of
		// the new epoch. A throw here does not refuse one entry — `entry.js`
		// turns it into `Could not decrypt payload`, and that ends OrbitDB's
		// whole heads exchange, so the reader would stop receiving even what it
		// may still read. It becomes an operation the index does not know.
		const writer = await keyringWith([0, 1]);
		const removed = createKeyring([/** @type {any} */ (writer.all()[0])]);
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });
		const sealed = await (await payloadEncryption(writer)).data.encrypt(encoded.bytes);

		const decoded = /** @type {any} */ (
			await asOrbitDbReadsIt(await (await payloadEncryption(removed)).data.decrypt(sealed))
		);

		expect(decoded.op).toBe(SEALED_OP);
		expect(decoded.op).not.toBe('PUT');
		expect(decoded.value).toEqual({ keyId: sealed.keyId, reason: 'no-key' });
		expect(JSON.stringify(decoded)).not.toContain('buy milk');
	});

	it('opens that same entry once the key arrives', async () => {
		// OrbitDB decodes entries from their bytes on every read, so the stand-in
		// is not remembered: the next read with the key in the keyring opens it.
		const writer = await keyringWith([0, 1]);
		const reader = createKeyring([/** @type {any} */ (writer.all()[0])]);
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });
		const sealed = await (await payloadEncryption(writer)).data.encrypt(encoded.bytes);
		const { data } = await payloadEncryption(reader);

		expect(/** @type {any} */ (await asOrbitDbReadsIt(await data.decrypt(sealed))).op).toBe(
			SEALED_OP
		);
		reader.add(/** @type {any} */ (writer.all()[1]));
		expect(await asOrbitDbReadsIt(await data.decrypt(sealed))).toEqual(todoPayload);
	});

	it('does not mistake sealed bytes under a wrong key for a todo', async () => {
		// The passthrough decides on the shape alone. Sealed bytes stay sealed,
		// so a reader without the key gets a stand-in rather than ciphertext
		// that would then fail to decode — and rather than a throw.
		const encoded = await Block.encode({ value: todoPayload, codec: dagCbor, hasher: sha256 });
		const sealed = await (await sealer(newKey())).seal(encoded.bytes);
		const { data } = await payloadEncryption(await keyringWith());

		const decoded = /** @type {any} */ (await asOrbitDbReadsIt(await data.decrypt(sealed)));

		expect(decoded.op).toBe(SEALED_OP);
	});

	it('refuses to open a sealed list with no key at all', async () => {
		await expect(payloadEncryption(createKeyring())).rejects.toThrow();
	});
});
