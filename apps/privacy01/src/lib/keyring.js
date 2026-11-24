// Every key a sealed list has had, one per epoch (#120).
//
// A list used to have one key for life. That made removing somebody a
// pretence: the person removed kept the key, and with it every entry written
// afterwards. Now a revoke starts a new **epoch** — a new random key, handed to
// everybody who stays — and what is written from then on is sealed under it.
//
// Old entries stay sealed under old keys; nothing is re-encrypted, because an
// append-only log cannot be rewritten and the removed reader has a copy anyway.
// So a reader keeps all the keys of a list, and each sealed entry says which one
// it needs (./entry-encryption.js).
//
// It says so by **key id**, not by epoch number. The number orders the keys and
// decides which one new entries are written under; it can collide — the same
// passkey revoking somebody from two devices at once makes two "epoch 2"s. The
// id is a hash of the key itself and cannot: whichever "epoch 2" an entry was
// sealed under, its id finds exactly that key.

const KEY_BYTES = 32;
const KEY_ID_LABEL = new TextEncoder().encode('privacy01/key-id/1|');

/** @typedef {{ epoch: number, keyId: string, key: Uint8Array }} EpochKey */

/**
 * A short public name for a key: the first 8 bytes of a labelled SHA-256 of it.
 *
 * Safe to publish next to the ciphertext. A hash of 32 random bytes says
 * nothing about them, and the label keeps it from being any other hash of the
 * same key that some other code might publish.
 *
 * @param {Uint8Array} key
 * @returns {Promise<string>}
 */
export async function keyIdOf(key) {
	const input = new Uint8Array(KEY_ID_LABEL.length + key.length);
	input.set(KEY_ID_LABEL, 0);
	input.set(key, KEY_ID_LABEL.length);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
	return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {Uint8Array} key
 * @param {number} epoch
 * @returns {Promise<EpochKey>}
 */
export async function epochKey(key, epoch) {
	if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
		throw new Error(`A list key must be ${KEY_BYTES} bytes.`);
	}
	if (!Number.isSafeInteger(epoch) || epoch < 0) {
		throw new Error('An epoch is a whole number, zero or more.');
	}
	return { epoch, keyId: await keyIdOf(key), key };
}

/** @param {EpochKey} a @param {EpochKey} b */
const byEpoch = (a, b) => a.epoch - b.epoch || (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0);

/**
 * The keys of one list, held in memory and shared by everything that reads it.
 *
 * Deliberately a live object rather than a value: the encryptor of an open
 * database holds this same keyring, so a key that arrives later — a rotation
 * by the owner — is used for the next entry without reopening anything.
 *
 * @param {EpochKey[]} [initial]
 */
export function createKeyring(initial = []) {
	/** @type {Map<string, EpochKey>} */
	const byId = new Map();

	/** @param {EpochKey} key @returns {boolean} whether it was new */
	const add = (key) => {
		if (byId.has(key.keyId)) return false;
		byId.set(key.keyId, key);
		return true;
	};
	for (const key of initial) add(key);

	const all = () => [...byId.values()].sort(byEpoch);

	return {
		add,
		/** @param {EpochKey[]} keys @returns {number} how many were new */
		addAll: (keys) => keys.filter(add).length,
		/** @param {string} keyId */
		get: (keyId) => byId.get(keyId),
		all,
		/**
		 * The key new entries are sealed under: the highest epoch, and among two
		 * of the same epoch the higher id, so that every device holding both
		 * makes the same choice.
		 *
		 * @returns {EpochKey | null}
		 */
		current: () => all().at(-1) ?? null,
		/** The epoch a rotation from here would start. */
		nextEpoch: () => (all().at(-1)?.epoch ?? -1) + 1,
		get size() {
			return byId.size;
		}
	};
}

/** @typedef {ReturnType<typeof createKeyring>} Keyring */
