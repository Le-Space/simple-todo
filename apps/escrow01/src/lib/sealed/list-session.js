/**
 * Sealed lists as db-actions.js uses them (#127): one place that knows which
 * list is sealed, holds its keys, and seals and opens what the list code
 * writes and reads, so the list code itself only asks.
 *
 * Private lists made since #127 are always sealed (user decision 2,
 * 25.11.2026); the shared three-word list and lists made before stay as they
 * were. A list is sealed when its database name says so (sealed-list.js), so
 * every peer knows before a single entry has arrived, and nobody writes into a
 * sealed list in the clear because its key is late.
 */
import { DelegatedListAccessController } from '../delegated-access.js';
import { directoryFor } from '../chain/session-directory.js';
import { createLogStorages } from '@simple-todo/todo/storage-mode.js';
import { LIST_SCOPE, taskScope } from './key-ring.js';
import { createListKeys, openListKeys } from './list-keys.js';
import {
	isSealedListName,
	openActionText,
	openRecord,
	openRecords,
	sealActionText,
	sealedListName,
	sealTodo
} from './sealed-list.js';
import { currentReader } from './session-reader.js';

/** No key for sealed lists in this session: nothing could be sealed, or opened. */
export class NoSealedReaderError extends Error {
	constructor() {
		super('This session has no key for sealed lists.');
		this.name = 'NoSealedReaderError';
	}
}

/** The keys of each sealed list this session opened, by address. @type {Map<string, Promise<import('./list-keys.js').ListKeys>>} */
const opened = new Map();

/**
 * Whether a list is sealed: by its database name.
 *
 * @param {any} db
 */
export function isSealedList(db) {
	return isSealedListName(db?.name);
}

/**
 * Make a sealed list: a random database name, the creator as its only writer
 * and its owner, the first list key, and its readable name sealed in the key
 * store (list-keys.js says why there).
 *
 * @param {any} orbitdb
 * @param {{ name: string }} options
 * @returns {Promise<{ db: any, keys: import('./list-keys.js').ListKeys }>}
 */
export async function createSealedList(orbitdb, { name }) {
	const reader = currentReader();
	if (!reader) throw new NoSealedReaderError();
	const db = await orbitdb.open(sealedListName(), {
		type: 'keyvalue',
		create: true,
		sync: true,
		AccessController: DelegatedListAccessController({ write: [orbitdb.identity.id] }),
		...(await createLogStorages())
	});
	const address = String(db.address);
	const keys = createListKeys(orbitdb, {
		listAddress: address,
		own: reader,
		lookupPublicKey: publicKeyLookup(orbitdb)
	});
	opened.set(address, keys);
	const ready = await keys;
	await ready.setName(name);
	return { db, keys: ready };
}

/**
 * The keys of a sealed list, opened once per address; null for a list that is
 * not sealed.
 *
 * @param {any} orbitdb
 * @param {any} db
 * @returns {Promise<import('./list-keys.js').ListKeys | null>}
 */
export async function keysForList(orbitdb, db) {
	if (!isSealedList(db)) return null;
	const address = String(db.address);
	const known = opened.get(address);
	if (known) return known;

	const reader = currentReader();
	if (!reader) throw new NoSealedReaderError();
	const keys = (async () => {
		const ownerDid = await ownerOf(db);
		if (!ownerDid) throw new Error('A sealed list without an owner.');
		return openListKeys(orbitdb, {
			listAddress: address,
			ownerDid,
			own: reader,
			lookupPublicKey: publicKeyLookup(orbitdb)
		});
	})();
	keys.catch(() => opened.delete(address));
	opened.set(address, keys);
	return keys;
}

/** How long a write waits for the list's key, when the list lets this session write (#127). */
export const WAIT_FOR_LIST_KEY_MS = 20_000;

/**
 * Before a write: a session the list lets write but that holds no key of it
 * yet -- its owner or a writer, on a device that has just opened the list --
 * waits a moment for its copy instead of refusing the first todo. Anyone else
 * is refused at once, as before.
 *
 * @param {import('./list-keys.js').ListKeys | null} keys
 * @param {any} db the list
 * @param {string | undefined} identityId this session's
 * @param {{ timeoutMs?: number }} [options]
 */
export async function keysToWrite(keys, db, identityId, { timeoutMs = WAIT_FOR_LIST_KEY_MS } = {}) {
	if (!keys || keys.canSeal() || !identityId) return keys;
	try {
		const capabilities = await db.access.capabilities();
		const mayWrite = [...(capabilities?.admin ?? []), ...(capabilities?.write ?? [])].includes(
			identityId
		);
		if (mayWrite) await keys.whenSealable(timeoutMs);
	} catch {
		// No answer from the controller: refuse as before.
	}
	return keys;
}

/**
 * A todo's value as it goes into the list: sealed under its key in a sealed
 * list, as it is otherwise.
 *
 * @param {import('./list-keys.js').ListKeys | null} keys
 * @param {string} todoKey
 * @param {any} todo
 */
export function valueToWrite(keys, todoKey, todo) {
	return keys ? sealTodo(keys.ring, todoKey, todo) : todo;
}

/**
 * The text a delegate renames his todo to: sealed under its task key in a
 * sealed list.
 *
 * @param {import('./list-keys.js').ListKeys | null} keys
 * @param {string} todoKey
 * @param {string} text
 */
export function actionTextToWrite(keys, todoKey, text) {
	return keys ? sealActionText(keys.ring, todoKey, text) : text;
}

/**
 * The records of a list as this session may see them: todos opened, the
 * delegates' renames opened, and what stays sealed counted.
 *
 * @template {{ key: string, value: any }} R
 * @param {import('./list-keys.js').ListKeys | null} keys
 * @param {R[]} records
 * @param {{ isAction: (key: string) => boolean }} kinds
 * @returns {Promise<{ records: R[], hidden: number, name: string | null }>}
 */
export async function recordsToShow(keys, records, { isAction }) {
	if (!keys) return { records, hidden: 0, name: null };
	const [read, name] = await Promise.all([openRecords(records, keys.ring), keys.name()]);
	const shown = await Promise.all(
		read.records.map(async (record) =>
			isAction(record.key)
				? { ...record, value: await openActionText(record.value, keys.ring) }
				: record
		)
	);
	return { records: shown, hidden: read.hidden, name: name ?? read.name };
}

/**
 * One todo's current value, opened, for a write that changes it; null when it
 * stays sealed to this session.
 *
 * @param {import('./list-keys.js').ListKeys | null} keys
 * @param {string} todoKey
 * @param {any} value as `db.get` returned it
 */
export async function valueToChange(keys, todoKey, value) {
	if (!keys) return value;
	const read = await openRecord({ key: todoKey, value }, keys.ring);
	return read.state === 'hidden' ? null : read.record.value;
}

/**
 * The writers of a list besides its owner, as its controller says.
 *
 * @param {any} db
 * @returns {Promise<string[]>}
 */
export async function writersOf(db) {
	try {
		const capabilities = await db.access.capabilities();
		const admins = new Set(capabilities?.admin ?? []);
		return [...(capabilities?.write ?? [])].filter((did) => !admins.has(did));
	} catch {
		return [];
	}
}

/**
 * After the owner gave `did` write access: every key of the list, so he reads
 * what is there and seals what he writes.
 *
 * @param {import('./list-keys.js').ListKeys} keys
 * @param {string} did
 */
export function keysForNewWriter(keys, did) {
	return keys.grant(did);
}

/**
 * After the owner took write access from `did`: a new epoch of the list key,
 * and of the key of every todo handed to someone, for everybody but him
 * (user decision 5).
 *
 * @param {import('./list-keys.js').ListKeys} keys
 * @param {{ writers: string[], handedOver: { key: string, delegateDid: string }[] }} remaining
 *   the writers left, and each todo that is handed to someone
 */
export async function keysAfterWriterLeft(keys, { writers, handedOver }) {
	const missing = new Set();
	for (const did of (await keys.rotate(LIST_SCOPE, writers)).missing) missing.add(did);
	for (const todo of handedOver) {
		const rotation = await keys.rotate(taskScope(todo.key), [...writers, todo.delegateDid]);
		for (const did of rotation.missing) missing.add(did);
	}
	return { missing: [...missing] };
}

/** Close the keys of every sealed list, for a stop or a restart. */
export async function closeSealedLists() {
	const all = [...opened.values()];
	opened.clear();
	await Promise.all(all.map(async (keys) => (await keys.catch(() => null))?.close()));
}

/**
 * The list's owner: the first admin its controller names.
 *
 * @param {any} db
 * @returns {Promise<string | null>}
 */
async function ownerOf(db) {
	try {
		const capabilities = await db.access.capabilities();
		const [owner] = [...(capabilities?.admin ?? [])];
		return owner ?? null;
	} catch {
		return null;
	}
}

/**
 * The reader's X25519 key from the account directory.
 *
 * @param {any} orbitdb
 * @returns {(did: string, options?: { timeoutMs?: number }) => Promise<Uint8Array | null>}
 */
function publicKeyLookup(orbitdb) {
	return async (did, options) => {
		const directory = await directoryFor(orbitdb);
		const published = await directory.lookupAgreementKey(did, options);
		return published?.publicKey ?? null;
	};
}
