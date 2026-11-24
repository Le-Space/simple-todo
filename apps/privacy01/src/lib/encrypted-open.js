// Opening a todo list that seals what it holds.
//
// Phase 1 of #277: the seam between OrbitDB's `open` and this chapter's
// encryption, so that neither `db-actions.js` nor `p2p.js` has to know how a
// key is found. Ported in spirit from Le-Space/yogasuci's `encrypted-open.js`.
//
// The identifier is the **address**, and that is the whole difficulty. A list
// is created under a name — `orbitdb.open('groceries-m4x2')` — and after a
// reload it is opened by address, because that is what the registry keeps. A
// key filed under the name would be looked for under the address and not
// found, a fresh one would be generated, and the list somebody wrote yesterday
// would be unreadable today. The address is the only identifier both paths
// share, so a newly created list has its key written down once its address
// exists.
//
// Keys can arrive two ways. This browser made them, because it made the list
// or revoked somebody from it; or an admin of the list sealed copies for this
// reader, and `findSharedKeys` goes and gets them (#277 phase 2, #120). Which
// copies count depends on who the list's admins are, and that is only known
// once the list is open — so a list with no key here is opened in the clear
// first, asked, and reopened sealed if a copy was there.
//
// A list has one **keyring** per address for the life of the page
// (./keyring.js), shared by everything that opens it: the encryptor of an open
// database reads it on every entry, so a key that arrives later — a rotation by
// the owner — is used without reopening anything.
//
// What this does *not* do is invent a key for an address. That would seal
// somebody else's list under a key its owner does not have — a broken list
// rather than a private one. Inventing happens only where a list is created.

import { createLogStorages } from '@simple-todo/todo/storage-mode.js';
import { canRememberKeys, rememberKeys, storedKeys } from './database-keys.js';
import { newKey } from './db-encryption.js';
import { payloadEncryption } from './entry-encryption.js';
import { createKeyring, epochKey } from './keyring.js';

/** @param {string} target */
const isAddress = (target) => target.trim().startsWith('/orbitdb/');

/** @type {Map<string, import('./keyring.js').Keyring>} */
const keyrings = new Map();

/**
 * Instances this module opened without an encryptor. `orbitdb.open` hands back
 * a database it already has open and ignores the options entirely
 * (`orbitdb.js:121-123`), so asking for a sealed one while a plain one is open
 * would get the plain one back — decryptor passed, nothing attached.
 */
const plainDatabases = new WeakSet();

/** Instances opened with this module's encryptor. */
const sealedDatabases = new WeakSet();

/**
 * The keyring of a list, the same object every time for one address.
 *
 * @param {string} address
 */
export function keyringFor(address) {
	let keyring = keyrings.get(address);
	if (!keyring) {
		keyring = createKeyring();
		keyrings.set(address, keyring);
	}
	return keyring;
}

/** For tests: a page that has never seen this list. */
export function forgetKeyring(/** @type {string} */ address) {
	keyrings.delete(address);
}

/** Whether a database was opened with this module's encryptor. */
export function isSealedDatabase(/** @type {any} */ database) {
	return Boolean(database) && sealedDatabases.has(database);
}

/**
 * Open a database whose entries are sealed under keys held on this device.
 *
 * Falls back to opening in the clear when no key can be kept — a browser with
 * storage blocked still gets a working list rather than one it cannot read
 * after the next reload.
 *
 * @param {any} orbitdb
 * @param {string} target an existing `/orbitdb/…` address, or a name to create
 * @param {Record<string, any>} options passed through to `orbitdb.open`
 * @param {{ newKey?: () => Uint8Array, findSharedKeys?: (address: string, database: any) => Promise<import('./keyring.js').EpochKey[]> }} [deps]
 * @returns {Promise<any>}
 */
export async function openEncrypted(orbitdb, target, options = {}, deps = {}) {
	const create = deps.newKey ?? newKey;

	// Memory-only when that is what was chosen, folded in once: every path below
	// hands `options` to `orbitdb.open` unchanged, and `Database` would otherwise
	// default both log storages to LevelStorage -- which browser-level puts in
	// IndexedDB, sealed entries and all.
	options = { ...options, ...(await createLogStorages()) };

	if (isAddress(target)) {
		const address = target.trim();
		const keyring = keyringFor(address);
		// What this browser wrote down before. This, rather than the list
		// registry, is what decides it: the registry does not survive a reload in
		// this chapter (see e2e/list-registry.spec.js) while local storage does.
		keyring.addAll((await storedKeys(address)) ?? []);

		if (keyring.size === 0) {
			// Nothing here. An admin may have sealed copies for this reader when
			// granting access — that is what makes a granted list readable rather
			// than a wall of sealed bytes — and also for herself, which is how the
			// owner reads her own list on a second device (#120).
			const plain = await openPlain(orbitdb, target, options);
			const found = (await deps.findSharedKeys?.(address, plain)) ?? [];
			if (keyring.addAll(found) === 0) return plain;

			// Written down so the next open does not go looking again. Best effort:
			// a browser without storage still reads this session.
			rememberKeys(address, keyring);
			await closeQuietly(plain);
		}

		return openSealed(orbitdb, target, options, keyring);
	}

	// A name: the database does not exist yet, so its address does not either.
	if (!canRememberKeys()) return openPlain(orbitdb, target, options);

	const keyring = createKeyring([await epochKey(create(), 0)]);
	const database = await openSealed(orbitdb, target, options, keyring);

	const address = database?.address?.toString?.() ?? '';
	if (address) {
		keyrings.set(address, keyring);
		rememberKeys(address, keyring);
	} else {
		console.warn('Opened an encrypted list with no address to file its key under.');
	}

	return database;
}

/**
 * @param {any} orbitdb
 * @param {string} target
 * @param {Record<string, any>} options
 */
async function openPlain(orbitdb, target, options) {
	const database = await orbitdb.open(target, options);
	// One that is already open sealed stays sealed; only a fresh instance is
	// recorded as plain.
	if (database && !sealedDatabases.has(database)) plainDatabases.add(database);
	return database;
}

/**
 * @param {any} orbitdb
 * @param {string} target
 * @param {Record<string, any>} options
 * @param {import('./keyring.js').Keyring} keyring
 */
async function openSealed(orbitdb, target, options, keyring) {
	const sealedOptions = { ...options, encryption: await payloadEncryption(keyring) };
	let database = await orbitdb.open(target, sealedOptions);

	if (database && plainDatabases.has(database)) {
		// Opened in the clear earlier in this session, before a key was here.
		// That instance has to go first, or the encryptor is silently dropped.
		await closeQuietly(database);
		database = await orbitdb.open(target, sealedOptions);
	}

	if (database) sealedDatabases.add(database);
	return database;
}

/** @param {any} database */
async function closeQuietly(database) {
	plainDatabases.delete(database);
	try {
		await database?.close?.();
	} catch (error) {
		console.warn('Could not close the list before reopening it sealed:', error);
	}
}
