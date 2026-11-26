/**
 * Where a sealed list keeps the wrapped copies of its keys (#127).
 *
 * One `keyvalue` per list that **only the list's owner writes**
 * (`IPFSAccessController({ write: [owner] })`). Each copy sits under its slot:
 *
 *     list/<epoch>/<did>             K_L of that epoch, for that reader
 *     task/<todoKey>/<epoch>/<did>   K_T of one delegated todo (#127 PR B)
 *
 * Owner-only on purpose. privacy01 kept its copies in a store everyone with
 * write access could write, and #120 showed what that allows: a writer plants
 * a key of his own under another reader's slot, the reader seals with it, and
 * the planter reads along. Here a copy is the owner's word or nothing — OrbitDB
 * refuses any entry the owner's identity did not sign.
 *
 * The store's name follows from the list's address, and its address from that
 * name and its controller. So anyone who can open the list and knows its owner
 * finds the store without being told where it is, as with the account
 * directory. What a reader of the store learns is who holds a copy of which
 * epoch; the keys themselves open only with the reader's private key
 * (./key-agreement.js).
 *
 * The owner wraps to herself as well. Her other devices derive the same
 * X25519 key from the same passkey, and open her own copy like anyone else's.
 */
import { IPFSAccessController } from '@orbitdb/core';
import { unwrapKey, wrapKey } from './key-agreement.js';
import { KeyRingConflictError, LIST_SCOPE, taskScope } from './key-ring.js';

/** Changing this moves every list's key store: treat it as breaking. */
export const KEY_STORE_NAME_PREFIX = 'simple-todo-escrow01-keys-v1:';

/**
 * The key store's database name for a list.
 *
 * @param {string} listAddress `/orbitdb/<cid>`
 */
export function keyStoreName(listAddress) {
	const match = /^\/orbitdb\/([A-Za-z0-9]+)$/.exec(String(listAddress ?? '').trim());
	if (!match) throw new TypeError(`Not a list address: ${listAddress}`);
	return `${KEY_STORE_NAME_PREFIX}${match[1]}`;
}

/**
 * @param {number} epoch
 * @param {string} did
 */
export function listSlot(epoch, did) {
	assertEpoch(epoch);
	assertSegment(did, 'A DID');
	return `list/${epoch}/${did}`;
}

/**
 * @param {string} todoKey
 * @param {number} epoch
 * @param {string} did
 */
export function taskSlot(todoKey, epoch, did) {
	assertSegment(todoKey, 'A todo key');
	assertEpoch(epoch);
	assertSegment(did, 'A DID');
	return `task/${todoKey}/${epoch}/${did}`;
}

/**
 * What a slot names, or null for any other key.
 *
 * @param {unknown} slot
 * @returns {{ scopeId: string, epoch: number, did: string } | null}
 */
export function parseSlot(slot) {
	if (typeof slot !== 'string') return null;
	const parts = slot.split('/');
	if (parts[0] === 'list' && parts.length === 3) {
		const epoch = epochOf(parts[1]);
		return epoch === null || !parts[2] ? null : { scopeId: LIST_SCOPE, epoch, did: parts[2] };
	}
	if (parts[0] === 'task' && parts.length === 4) {
		const epoch = epochOf(parts[2]);
		return epoch === null || !parts[1] || !parts[3]
			? null
			: { scopeId: taskScope(parts[1]), epoch, did: parts[3] };
	}
	return null;
}

/**
 * Open a list's key store. Everyone opens the same one: the name comes from
 * the list, the controller from its owner.
 *
 * @param {any} orbitdb the session's (wrapped) OrbitDB instance, which keeps
 *   the log where the storage choice says (instance-wrappers.js)
 * @param {{ listAddress: string, ownerDid: string }} list
 */
export function openKeyStore(orbitdb, { listAddress, ownerDid }) {
	if (!orbitdb) throw new Error('OrbitDB is not running.');
	assertSegment(ownerDid, 'The owner’s DID');
	return orbitdb.open(keyStoreName(listAddress), {
		type: 'keyvalue',
		AccessController: IPFSAccessController({ write: [ownerDid] })
	});
}

/**
 * @typedef {{ did: string, publicKey: Uint8Array }} Recipient
 *   a reader, with the public key their directory entry names
 */

/**
 * Store one copy of the list key of `epoch` for one reader. Only the owner's
 * session can: OrbitDB refuses the entry otherwise.
 *
 * @param {any} store from `openKeyStore`
 * @param {{ epoch: number, key: Uint8Array, recipient: Recipient }} copy
 */
export async function putListKeyCopy(store, { epoch, key, recipient }) {
	const slot = listSlot(epoch, recipient.did);
	await store.put(slot, await wrapKey(key, recipient.publicKey, { slot }));
	return slot;
}

/**
 * Give a reader every list key the ring holds, so he reads what came before
 * him too. What a grant hands over cannot be taken back; a revocation starts
 * a new epoch instead.
 *
 * @param {any} store
 * @param {import('./key-ring.js').KeyRing} ring the owner's
 * @param {Recipient} recipient
 * @returns {Promise<string[]>} the slots written
 */
export async function grantListKeys(store, ring, recipient) {
	const slots = [];
	for (const epoch of ring.epochs(LIST_SCOPE)) {
		const key = /** @type {Uint8Array} */ (ring.raw(LIST_SCOPE, epoch));
		try {
			slots.push(await putListKeyCopy(store, { epoch, key, recipient }));
		} finally {
			key.fill(0);
		}
	}
	return slots;
}

/**
 * Open every copy addressed to this reader and put the keys in the ring.
 *
 * A copy that does not open is reported, not thrown: one bad copy — sealed for
 * a key this device no longer has, or for another device's random key — must
 * not keep the others out.
 *
 * @param {any} store
 * @param {import('./key-ring.js').KeyRing} ring
 * @param {{ did: string, agreementKey: import('./key-agreement.js').AgreementKey }} reader
 * @returns {Promise<{ added: string[], failed: { slot: string, reason: 'unwrap' | 'conflict' }[] }>}
 */
export async function loadOwnKeys(store, ring, { did, agreementKey }) {
	/** @type {string[]} */
	const added = [];
	/** @type {{ slot: string, reason: 'unwrap' | 'conflict' }[]} */
	const failed = [];

	for (const { key: slot, value } of await store.all()) {
		const parsed = parseSlot(slot);
		if (!parsed || parsed.did !== did) continue;

		let key;
		try {
			key = await unwrapKey(value, agreementKey, { slot });
		} catch {
			failed.push({ slot, reason: 'unwrap' });
			continue;
		}
		try {
			if (ring.add(parsed.scopeId, parsed.epoch, key)) added.push(slot);
		} catch (error) {
			if (!(error instanceof KeyRingConflictError)) throw error;
			failed.push({ slot, reason: 'conflict' });
		} finally {
			key.fill(0);
		}
	}
	return { added, failed };
}

/** @param {string} text @returns {number | null} */
function epochOf(text) {
	if (!/^(0|[1-9][0-9]*)$/.test(text)) return null;
	const epoch = Number(text);
	return Number.isSafeInteger(epoch) ? epoch : null;
}

/** @param {unknown} epoch */
function assertEpoch(epoch) {
	if (!Number.isSafeInteger(epoch) || /** @type {number} */ (epoch) < 0) {
		throw new TypeError('An epoch is a whole number, zero or more.');
	}
}

/**
 * A slot segment must not contain the separator, or a slot could be read two
 * ways. DIDs (`did:key:z…`) and todo keys do not.
 *
 * @param {unknown} value
 * @param {string} what
 */
function assertSegment(value, what) {
	if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
		throw new TypeError(`${what} must be a non-empty string without "/".`);
	}
}
