// Where a list's keys are kept on this device.
//
// Phase 1 of #277 kept one random key per database in local storage, never
// leaving this browser. Phase 2 handed copies to other readers. #120 changed
// two things about what is kept here:
//
// - **A list has a key per epoch,** not one key. Revoking somebody starts a new
//   one (./keyring.js), so this keeps all of them, oldest to newest.
// - **This is a cache, not the only copy.** The owner gets a wrapped copy of
//   every key, like any reader (./shared-keys.js), so a second device with the
//   same passkey — or this one after its storage was cleared — finds the keys
//   again. What is kept here only spares the next visit the lookup.
//
// The format is `{"v":1,"keys":[{"epoch":0,"key":"<base64>"}, …]}`. A bare
// base64 string, which is what phase 1 wrote, reads as a single key in epoch 0.
//
// Still in the clear, as before: local storage is no better protected than
// anything else in this browser, and the README says so.

import { canKeepForThisMode, forget, recall, remember } from '@simple-todo/todo/browser-memory.js';
import { epochKey } from './keyring.js';

const STORAGE_PREFIX = 'privacy01.dbKey.';
const KEY_BYTES = 32;

/** @param {string} address how this database is identified locally */
function storageKeyFor(address) {
	return `${STORAGE_PREFIX}${address}`;
}

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** @param {string} value */
function fromBase64(value) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * What is stored for a list, parsed but not yet checked against anything.
 *
 * Throws when something is stored and cannot be read. Treating that as "no
 * key" would let a caller invent a fresh one and seal new entries under a key
 * that cannot open the old ones — silently, and only noticed once something is
 * unreadable.
 *
 * @param {string} address
 * @returns {{ epoch: number, key: Uint8Array }[] | null}
 */
function readStored(address) {
	let stored = null;
	try {
		stored = recall(storageKeyFor(address));
	} catch {
		return null;
	}
	if (!stored) return null;

	/** @type {{ epoch: number, key: Uint8Array }[]} */
	let entries;
	try {
		entries = stored.startsWith('{')
			? JSON.parse(stored).keys.map((/** @type {any} */ entry) => ({
					epoch: entry.epoch,
					key: fromBase64(entry.key)
				}))
			: [{ epoch: 0, key: fromBase64(stored) }];
	} catch {
		throw new Error(`The stored keys for ${address} are not readable.`);
	}

	if (
		entries.length === 0 ||
		entries.some(
			({ epoch, key }) => key.length !== KEY_BYTES || !Number.isSafeInteger(epoch) || epoch < 0
		)
	) {
		throw new Error(`The stored keys for ${address} are not valid.`);
	}
	return entries;
}

/**
 * Every key this device holds for a list, or null.
 *
 * Read-only on purpose. It is what distinguishes a list this browser can read
 * from somebody else's list reached by address; generating a key on the way
 * past would seal a guest's list under a key its owner does not have.
 *
 * @param {string} address
 * @returns {Promise<import('./keyring.js').EpochKey[] | null>}
 */
export async function storedKeys(address) {
	const entries = readStored(address);
	if (!entries) return null;
	return Promise.all(entries.map(({ key, epoch }) => epochKey(key, epoch)));
}

/**
 * The key new entries of this list are sealed under, or null.
 *
 * Synchronous for the places that only ask "can this browser read it?".
 *
 * @param {string} address
 * @returns {Uint8Array | null}
 */
export function storedDatabaseKey(address) {
	const entries = readStored(address);
	if (!entries) return null;
	return entries.reduce((newest, entry) => (entry.epoch >= newest.epoch ? entry : newest)).key;
}

/**
 * Whether a key stored now would still be here after a reload.
 *
 * Asked *before* a database is created rather than after: opening one with an
 * encryptor whose key cannot be written down seals entries that nothing will
 * ever open again, including this browser. Better to find that out while the
 * list is still empty.
 *
 * @returns {boolean}
 */
export function canRememberKeys() {
	// "For as long as this mode needs it", not "forever": in memory mode the tab
	// is the lifetime, and sealing is still right -- the entries go with the tab
	// and the copies peers hold stay unreadable. What this module refuses is
	// sealing when the key cannot even be kept that long, which is a blocked
	// `localStorage` in persistent mode (#9).
	return canKeepForThisMode();
}

/**
 * Write down the keys of a list, all of them.
 *
 * @param {string} address
 * @param {{ all: () => import('./keyring.js').EpochKey[] }} keyring
 * @returns {boolean} whether they were written down
 */
export function rememberKeys(address, keyring) {
	const keys = keyring.all().map(({ epoch, key }) => ({ epoch, key: toBase64(key) }));
	try {
		remember(storageKeyFor(address), JSON.stringify({ v: 1, keys }));
		return true;
	} catch {
		return false;
	}
}

/** @param {string} address */
export function forgetDatabaseKey(address) {
	try {
		forget(storageKeyFor(address));
	} catch {
		// Nothing to forget without storage.
	}
}
