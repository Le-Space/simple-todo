// Where a database key lives on this device.
//
// Phase 1 of #277 and deliberately the simplest thing that can be true: one
// random key per database, never leaving this browser -- and, since #9, only
// reaching the device at all when the reader asked for that. In memory mode it
// lives in the tab and dies with it, which is what sealing a list without
// keeping anything has to mean.
// That is enough for a single device to seal its own list and read it back
// after a reload, and it is not enough for two devices to share one — they
// would each invent a key and neither could read the other.
//
// Sharing is Phase 2, where the key is wrapped to the other device's public
// key and handed over with the QR code that already travels between them. This
// module is the seam that will change: callers ask for the key of a database,
// not for local storage.

import { forget, recall, remember } from '@simple-todo/todo/browser-memory.js';

const STORAGE_PREFIX = 'privacy01.dbKey.';

/** @param {string} databaseKey how this database is identified locally */
function storageKeyFor(databaseKey) {
	return `${STORAGE_PREFIX}${databaseKey}`;
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
 * The key for a database, generating and remembering one on first use.
 *
 * Returns null when there is no storage to remember it in. A key that only
 * lives for this page load is worse than none: it would seal entries nothing
 * can ever open again, including this device after a reload.
 *
 * @param {string} databaseKey
 * @param {{ newKey?: () => Uint8Array }} [deps]
 * @returns {Uint8Array | null}
 */
export function keyForDatabase(databaseKey, deps = {}) {
	const create = deps.newKey ?? (() => crypto.getRandomValues(new Uint8Array(32)));

	let stored = null;
	try {
		stored = recall(storageKeyFor(databaseKey));
	} catch {
		return null;
	}

	if (stored) {
		try {
			const bytes = fromBase64(stored);
			if (bytes.length === 32) return bytes;
		} catch {
			// Unreadable rather than absent. Replacing it would seal new entries
			// under a key that cannot open the old ones, so say so instead.
			throw new Error(`The stored key for ${databaseKey} is not readable.`);
		}
		throw new Error(`The stored key for ${databaseKey} has the wrong length.`);
	}

	const fresh = create();
	try {
		remember(storageKeyFor(databaseKey), toBase64(fresh));
	} catch {
		return null;
	}
	return fresh;
}

/** @param {string} databaseKey */
export function forgetDatabaseKey(databaseKey) {
	try {
		forget(storageKeyFor(databaseKey));
	} catch {
		// Nothing to forget without storage.
	}
}
