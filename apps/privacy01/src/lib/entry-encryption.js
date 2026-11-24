// The seam between sealed bytes and an OrbitDB log.
//
// Ported from Le-Space/yogasuci `src/lib/db/entry-encryption.js`
// (Le-Space/yogasuci#95), including the migration below, which is the half
// that is not obvious and whose absence destroys data.
//
// OrbitDB takes `encryption: { data: { encrypt, decrypt } }` and applies it to
// an entry's payload: `entry.js` encodes the payload to dag-cbor, hands the
// bytes to `encrypt`, and on the way back hands whatever it stored to
// `decrypt` and decodes the result. So both halves speak bytes, and the
// cryptography itself stays in ./db-encryption.js where it can be proven on
// its own.
//
// Encryption is not part of an OrbitDB manifest — that is
// `{ name, type, accessController }` and nothing else (`manifest-store.js`) —
// so switching it on does not change an address. An existing list therefore
// keeps every plaintext entry it already had and starts receiving sealed ones
// beside them, and `entry.js` is unforgiving about the mixture:
//
//   if (decryptPayloadFn) {
//     try { … } catch (e) { throw new Error('Could not decrypt payload') }
//   }
//
// Every todo written so far would become unreadable. Since this function is
// the one being called, it can recognise a payload that was never sealed and
// hand it back in the form OrbitDB expects, which turns a data loss into a
// migration that needs nobody to run anything.
//
// The same line of `entry.js` is the reason for the second rule here (#120):
// **decrypt does not throw.** A list's key changes when somebody is removed
// (./keyring.js), and a reader who was removed — or one whose copy of the new
// key has not arrived yet — will be handed entries it has no key for. A throw
// there is not a refusal of one entry: `Sync` decodes the heads a peer sends
// with this same function, and one throw ends the whole exchange, so that
// reader would stop receiving the list altogether, including what it may still
// read. So an entry this reader cannot open becomes a stand-in — an operation
// called `SEALED`, which the keyvalue index skips like any operation it does
// not know — and the next read, once the key is here, opens the real one:
// OrbitDB keeps entries as bytes and decodes them again on every read.
//
// What a sealed entry looks like on the log, then:
//
//   { keyId: '<16 hex>', sealed: <nonce ‖ AES-GCM ciphertext> }
//
// The key id says which of the list's keys sealed it. Bare bytes, without the
// object around them, are what a list sealed before #120 holds; they are tried
// against every key there is.

import * as dagCbor from '@ipld/dag-cbor';
import * as Block from 'multiformats/block';
import { sha256 } from 'multiformats/hashes/sha2';

import { sealer } from './db-encryption.js';

/** The operation an entry turns into when this reader holds no key that opens it. */
export const SEALED_OP = 'SEALED';

/** @param {any} value */
const encode = async (value) =>
	(await Block.encode({ value, codec: dagCbor, hasher: sha256 })).bytes;

/**
 * OrbitDB's `encryption` option for one database.
 *
 * @param {import('./keyring.js').Keyring} keyring every key of the list; read
 *   again on every call, so a key added later is used without reopening
 * @returns {Promise<{ data: { encrypt: (bytes: Uint8Array) => Promise<any>, decrypt: (value: any) => Promise<Uint8Array> } }>}
 */
export async function payloadEncryption(keyring) {
	if (!keyring?.current?.()) throw new Error('A sealed list needs at least one key.');

	/** @type {Map<string, Promise<Awaited<ReturnType<typeof sealer>>>>} */
	const sealers = new Map();
	/** @param {import('./keyring.js').EpochKey} entry */
	const sealerFor = (entry) => {
		let found = sealers.get(entry.keyId);
		if (!found) {
			found = sealer(entry.key);
			sealers.set(entry.keyId, found);
		}
		return found;
	};

	/**
	 * @param {string | null} keyId
	 * @param {'no-key' | 'refused'} reason
	 */
	const standIn = (keyId, reason) => encode({ op: SEALED_OP, key: null, value: { keyId, reason } });

	return {
		data: {
			/** @param {Uint8Array} bytes */
			async encrypt(bytes) {
				// The newest key, looked up now rather than when the list was opened:
				// after a revoke, the very next entry is sealed under the new one.
				const current = keyring.current();
				if (!current) throw new Error('This list has no key to seal with.');
				const sealed = await (await sealerFor(current)).seal(bytes);
				return { keyId: current.keyId, sealed };
			},

			/** @param {any} value the stored payload: tagged, bare sealed bytes, or an entry from before */
			async decrypt(value) {
				if (value instanceof Uint8Array) return openUntagged(value);

				if (value?.sealed instanceof Uint8Array && typeof value.keyId === 'string') {
					const entry = keyring.get(value.keyId);
					if (!entry) return standIn(value.keyId, 'no-key');
					try {
						return await (await sealerFor(entry)).open(value.sealed);
					} catch {
						// Under a key this reader has, and still does not open: written by
						// somebody allowed to write, with bytes that are not what the id
						// claims. Shown as nothing rather than thrown, for the reason in
						// the header -- one such entry must not stop the list syncing.
						return standIn(value.keyId, 'refused');
					}
				}

				// Written before this database was encrypted. Re-encoded rather than
				// returned as-is because the caller decodes what comes back, and it
				// only ever held bytes.
				return encode(value);
			}
		}
	};

	/**
	 * Sealed before keys had ids (before #120): one key per list then, so one of
	 * these will open it if this reader has it at all.
	 *
	 * @param {Uint8Array} bytes
	 */
	async function openUntagged(bytes) {
		for (const entry of keyring.all()) {
			try {
				return await (await sealerFor(entry)).open(bytes);
			} catch {
				// Not this one.
			}
		}
		return standIn(null, 'no-key');
	}
}
