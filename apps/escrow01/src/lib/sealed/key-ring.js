/**
 * The keys this session holds for sealed lists, one per scope and epoch (#127).
 *
 * A scope is the list (`'list'`, key `K_L`) or one delegated todo
 * (`'task/<todoKey>'`, key `K_T`). Each key is 32 random bytes. An epoch
 * number orders a scope's keys: new entries are sealed under the highest, and
 * every revocation starts the next one, so a reader who was removed keeps the
 * old keys but gets none of the new. Old entries stay under their old keys —
 * an append-only log is not re-encrypted — so the ring keeps every epoch it
 * was given.
 *
 * Nothing in here is stored. The keys reach the ring unwrapped from the
 * owner's key store (./key-store.js) and go with the tab.
 *
 * One key per scope and epoch. A second, different key for an epoch the ring
 * already holds is refused rather than replacing the first: entries sealed
 * under the first would then be lost to this session without a word.
 */

export const KEY_BYTES = 32;

/** The scope id of the list's own key. */
export const LIST_SCOPE = 'list';

/**
 * The scope id of one delegated todo's key.
 *
 * @param {string} todoKey
 */
export const taskScope = (todoKey) => `task/${todoKey}`;

/** Two different keys for one scope and epoch. */
export class KeyRingConflictError extends Error {
	/** @param {string} scopeId @param {number} epoch */
	constructor(scopeId, epoch) {
		super(`A different key for ${scopeId} epoch ${epoch} is already in the ring.`);
		this.name = 'KeyRingConflictError';
		this.scopeId = scopeId;
		this.epoch = epoch;
	}
}

/** A fresh key for a new scope or a new epoch. */
export function newEpochKey() {
	return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/**
 * The AES-GCM key for raw key bytes. Not extractable: the ring keeps the raw
 * bytes itself, because the owner wraps them again for each reader.
 *
 * @param {Uint8Array} raw
 * @returns {Promise<CryptoKey>}
 */
export async function importEpochKey(raw) {
	assertKeyBytes(raw);
	return crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (raw),
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * @typedef {object} KeyRing
 * @property {(scopeId: string, epoch: number, raw: Uint8Array) => boolean} add
 *   true when the key is new to the ring, false when it held the same one
 * @property {(scopeId: string, epoch: number) => boolean} has
 * @property {(scopeId: string, epoch: number) => Uint8Array | null} raw
 *   a copy of the key bytes, for wrapping them for another reader
 * @property {(scopeId: string, epoch: number) => Promise<CryptoKey | null>} cryptoKey
 * @property {(scopeId: string) => { epoch: number, key: Promise<CryptoKey> } | null} current
 *   the highest epoch, the one new entries are sealed under
 * @property {(scopeId: string) => number[]} epochs ascending
 * @property {() => string[]} scopes every scope the ring holds a key for
 * @property {import('./envelope.js').KeyLookup} keyFor
 *   for `openValue`: the key an envelope names
 * @property {() => void} clear
 */

/** @returns {KeyRing} */
export function createKeyRing() {
	/** @type {Map<string, Map<number, { raw: Uint8Array, key?: Promise<CryptoKey> }>>} */
	const scopes = new Map();

	/** @param {string} scopeId @param {number} epoch */
	const slot = (scopeId, epoch) => scopes.get(scopeId)?.get(epoch);

	/** @param {{ raw: Uint8Array, key?: Promise<CryptoKey> }} held */
	const keyOf = (held) => (held.key ??= importEpochKey(held.raw));

	/** @param {string} scopeId @param {number} epoch */
	async function cryptoKey(scopeId, epoch) {
		const held = slot(scopeId, epoch);
		return held ? keyOf(held) : null;
	}

	return {
		add(scopeId, epoch, raw) {
			assertScopeId(scopeId);
			assertEpoch(epoch);
			assertKeyBytes(raw);
			const held = slot(scopeId, epoch);
			if (held) {
				if (sameBytes(held.raw, raw)) return false;
				throw new KeyRingConflictError(scopeId, epoch);
			}
			let epochs = scopes.get(scopeId);
			if (!epochs) scopes.set(scopeId, (epochs = new Map()));
			epochs.set(epoch, { raw: Uint8Array.from(raw) });
			return true;
		},

		has: (scopeId, epoch) => Boolean(slot(scopeId, epoch)),

		raw(scopeId, epoch) {
			const held = slot(scopeId, epoch);
			return held ? Uint8Array.from(held.raw) : null;
		},

		cryptoKey,

		current(scopeId) {
			const epochs = scopes.get(scopeId);
			if (!epochs || epochs.size === 0) return null;
			const epoch = Math.max(...epochs.keys());
			return { epoch, key: keyOf(/** @type {{ raw: Uint8Array }} */ (epochs.get(epoch))) };
		},

		epochs: (scopeId) => [...(scopes.get(scopeId)?.keys() ?? [])].sort((a, b) => a - b),

		scopes: () => [...scopes.keys()].filter((scopeId) => (scopes.get(scopeId)?.size ?? 0) > 0),

		keyFor: ({ scope, epoch, entryKey }) =>
			cryptoKey(scope === 'list' ? LIST_SCOPE : taskScope(entryKey), epoch),

		clear() {
			for (const epochs of scopes.values()) {
				for (const held of epochs.values()) held.raw.fill(0);
			}
			scopes.clear();
		}
	};
}

/** @param {unknown} raw */
function assertKeyBytes(raw) {
	if (!(raw instanceof Uint8Array) || raw.length !== KEY_BYTES) {
		throw new TypeError(`A list or task key is ${KEY_BYTES} bytes.`);
	}
}

/** @param {unknown} epoch */
function assertEpoch(epoch) {
	if (!Number.isSafeInteger(epoch) || /** @type {number} */ (epoch) < 0) {
		throw new TypeError('An epoch is a whole number, zero or more.');
	}
}

/** @param {unknown} scopeId */
function assertScopeId(scopeId) {
	if (scopeId === LIST_SCOPE) return;
	if (typeof scopeId === 'string' && scopeId.startsWith('task/') && scopeId.length > 5) return;
	throw new TypeError(`Unknown key scope: ${String(scopeId)}`);
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameBytes(a, b) {
	return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
