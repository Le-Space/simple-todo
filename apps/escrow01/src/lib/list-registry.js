import { accessControllerKeepingLogsInMemory } from '@simple-todo/todo/keep-logs-in-memory.js';
import { createLogStorages } from '@simple-todo/todo/storage-mode.js';
import { writable, get } from 'svelte/store';
import { OrbitDBAccessController } from '@orbitdb/core';
import { listNameFromDatabase } from './list-name.js';
import { sealRegistryName, withOpenedNames } from './sealed/registry-names.js';
import { currentReader } from './sealed/session-reader.js';

/**
 * The list registry (acl01, issue #114).
 *
 * Which lists you own is itself data, so it lives in its own OrbitDB database
 * rather than in localStorage: it then replicates with the identity, and the
 * same passkey on a second device finds the same lists.
 *
 * ## Why the name is derived from a signature
 *
 * OrbitDB's access controller governs *append*, not read. Anyone who knows an
 * address can replicate and read it. A registry named after the identity — say
 * `todo-lists-${identity.id}` — would therefore be derivable by anyone who has
 * seen your DID, and your DID is attached to every todo you write. That would
 * turn "someone must hand you the address" into "anyone who saw one of your
 * entries can enumerate and read every list you own".
 *
 * Instead the name is derived from a signature the identity produces over a
 * fixed domain string. Ed25519 signatures are deterministic (RFC 8032), so the
 * same identity always derives the same name, on any device, with no extra
 * storage — while nobody without the private key can compute it.
 *
 * The registry itself is still world-readable to anyone who obtains its
 * address. It hides *which* registry is yours, not its contents.
 */

const DOMAIN = 'simple-todo/list-registry/v1';

/**
 * `sealedName`: a sealed list's name, sealed to this identity's own X25519 key
 * (#127, sealed/registry-names.js); `name` is then empty in the registry, and
 * filled in the store when it opens. `nameSealed`: it did not open here.
 *
 * @typedef {{ address: string, name: string, role: 'owner' | 'guest', createdAt: number,
 *   sealedName?: unknown, nameSealed?: boolean }} ListEntry
 */

/** Lists known to this identity, newest first. */
export const listRegistryStore = writable(/** @type {ListEntry[]} */ ([]));

/** True once the registry database is open; the UI hides the switcher until then. */
export const listRegistryReadyStore = writable(false);

/**
 * The derived database name. Surfaced so the property this whole design rests
 * on — that the name is not derivable from the public DID — is observable, and
 * therefore testable. It is your own name in your own browser; nothing about
 * exposing it here weakens the guarantee.
 */
export const listRegistryNameStore = writable('');

/** @type {any} */
let registryDB = null;
/** @type {Promise<any> | null} */
let opening = null;

/**
 * Derive the registry's database name for this identity.
 *
 * @param {any} orbitdb
 * @returns {Promise<string>}
 */
export async function deriveRegistryName(orbitdb) {
	const identities = orbitdb?.identities;
	const identity = orbitdb?.identity;
	if (!identities?.sign || !identity) {
		throw new Error('Cannot derive the registry name without a signing identity.');
	}

	const signature = await identities.sign(identity, DOMAIN);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(signature)));
	const hex = Array.from(new Uint8Array(digest))
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `list-registry-${hex}`;
}

/**
 * Open (or create) this identity's registry. Safe to call repeatedly; the
 * database is opened once and reused, and concurrent callers share the same
 * in-flight promise.
 *
 * @param {any} orbitdb
 */
export async function openListRegistry(orbitdb) {
	if (registryDB) return registryDB;
	if (opening) return opening;

	opening = (async () => {
		const name = await deriveRegistryName(orbitdb);
		listRegistryNameStore.set(name);
		console.log(`📇 list registry: ${name}`);
		const db = await orbitdb.open(name, {
			type: 'keyvalue',
			create: true,
			sync: true,
			AccessController: accessControllerKeepingLogsInMemory(
				OrbitDBAccessController({ write: [orbitdb.identity.id] })
			),
			// Memory-only when that is what was chosen: the registry is a database
			// like any other, and its log defaults to LevelStorage.
			...(await createLogStorages())
		});
		registryDB = db;
		db.events.on('update', () => {
			void refreshRegistry();
		});
		await refreshRegistry();
		listRegistryReadyStore.set(true);
		// Nothing persists locally in this chapter — Helia runs in memory — so
		// after a reload the entries have to come back from the relay. The first
		// heads exchange is routinely lost when a peer opens a database it has no
		// entries for, which shows up as a database that is connected but empty.
		// A bounded sync restart re-triggers it; this is the same workaround the
		// todo lists need.
		void recoverEntriesFromPeers(db);
		return db;
	})().finally(() => {
		opening = null;
	});

	return opening;
}

/**
 * Re-ask peers for the registry's history when the local copy came up empty.
 * Gives up quietly: an empty registry is a legitimate state for a new identity.
 *
 * @param {any} db
 */
async function recoverEntriesFromPeers(db) {
	for (let attempt = 0; attempt < 3; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 4000));
		if (get(listRegistryStore).length) return;
		try {
			await db.sync?.stop?.();
			await db.sync?.start?.();
		} catch (error) {
			console.warn('registry sync restart failed:', error);
			return;
		}
		await refreshRegistry();
	}
}

/** Re-read the registry into the store. */
async function refreshRegistry() {
	if (!registryDB) return;
	const records = await registryDB.all();
	const entries = records
		.map((/** @type {any} */ record) => (record && 'value' in record ? record.value : record))
		.filter((/** @type {any} */ entry) => entry && typeof entry.address === 'string')
		// Lists opened before list-name.js were recorded under their database
		// name, suffix and all; shown without it, as the owner shows them.
		.map((/** @type {ListEntry} */ entry) => ({
			...entry,
			name: listNameFromDatabase(entry.name)
		}));
	/** @type {ListEntry[]} */
	const shown = await withOpenedNames(
		/** @type {ListEntry[]} */ (entries),
		currentReader()?.agreementKey ?? null
	);
	shown.sort(
		(/** @type {ListEntry} */ a, /** @type {ListEntry} */ b) =>
			(b.createdAt ?? 0) - (a.createdAt ?? 0)
	);
	listRegistryStore.set(shown);
}

/**
 * Record a list. Keyed by address, so re-opening a list you already know
 * updates the entry instead of duplicating it.
 *
 * A sealed list's name never goes into the registry in the clear (#127): the
 * relay pins the registry like any database. It is sealed to this identity's
 * own key instead, and an entry that already holds the same name is left as
 * it is -- each seal is new bytes, and would grow the log on every visit.
 *
 * @param {any} orbitdb
 * @param {{ address: string, name: string, role: 'owner' | 'guest', sealed?: boolean }} entry
 */
export async function rememberList(orbitdb, { address, name, role, sealed = false }) {
	if (!address) return;
	const db = await openListRegistry(orbitdb);
	const known = get(listRegistryStore).find((e) => e.address === address);
	// Keep the name we already had if the caller has none — a guest opening a
	// list by address knows no name for it.
	const listName = name || known?.name || '';
	const nextRole = known?.role === 'owner' ? 'owner' : role;
	const createdAt = known?.createdAt ?? Date.now();

	if (sealed) {
		const reader = currentReader();
		const unchanged =
			known && known.role === nextRole && known.name === listName && known.sealedName !== undefined;
		if (unchanged || !reader) return;
		/** @type {ListEntry} */
		const value = { address, name: '', role: nextRole, createdAt };
		if (listName) {
			value.sealedName = await sealRegistryName(listName, {
				address,
				publicKey: reader.agreementKey.publicKey
			});
		}
		await db.put(address, value);
		await refreshRegistry();
		return;
	}

	/** @type {ListEntry} */
	const value = { address, name: listName, role: nextRole, createdAt };
	await db.put(address, value);
	await refreshRegistry();
}

/**
 * Drop a list from the registry. The database itself is untouched — this only
 * removes it from your list of lists.
 *
 * @param {any} orbitdb
 * @param {string} address
 */
export async function forgetList(orbitdb, address) {
	const db = await openListRegistry(orbitdb);
	await db.del(address);
	await refreshRegistry();
}

/** The open registry, null before it opens -- for the E2E hook (#127). */
export function openedListRegistry() {
	return registryDB;
}

/** Drop the cached handle; used when the OrbitDB instance goes away. */
export function resetListRegistry() {
	registryDB = null;
	opening = null;
	listRegistryStore.set([]);
	listRegistryReadyStore.set(false);
	listRegistryNameStore.set('');
}
