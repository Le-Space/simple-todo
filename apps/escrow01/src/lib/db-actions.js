import { writable, derived, get } from 'svelte/store';
import { peerIdStore } from './p2p-stores.js';
import { supportsDelegation } from './delegated-access.js';
import {
	applyDelegationActions,
	buildDelegationAction,
	buildDelegationActionKey,
	isDelegationActionKey,
	isDelegationActiveFor
} from './delegation.js';
import { confirmDelegatedWrite } from './delegated-write-auth.js';
import { rememberList, listRegistryStore, openListRegistry } from './list-registry.js';
import { listNameFromDatabase } from './list-name.js';
import {
	scheduleRelayReplicationProof,
	todoReplicationStatusStore,
	verifyRelayReplication
} from './relay-proof.js';
import { createLogStorages } from '@simple-todo/todo/storage-mode.js';
import { translate } from './i18n/index.js';
import {
	actionTextToWrite,
	createSealedList,
	keysAfterWriterLeft,
	keysForList,
	keysForNewWriter,
	NoSealedReaderError,
	recordsToShow,
	valueToChange,
	valueToWrite,
	writersOf
} from './sealed/list-session.js';
import { NoListKeyError, NoTaskKeyError } from './sealed/sealed-list.js';

/**
 * @typedef {{
 *   text: string
 *   completed: boolean
 *   createdBy: string
 *   createdByIdentity?: string | null
 *   delegation?: import('./delegation.js').Delegation | null
 *   budget?: import('./budget/budget.js').Budget | null
 *   updatedBy?: string
 *   assignee: string | null
 *   createdAt: string
 *   updatedAt: string
 * }} TodoValue
 */

/**
 * @typedef {TodoValue & {
 *   id: string
 *   key: string
 *   author?: string
 * }} TodoItem
 */

/**
 * @typedef {{
 *   hash: string
 *   key: string
 *   value: TodoValue
 * }} TodoRecord
 */

/**
 * @typedef {{
 *   address: unknown
 *   name?: string
 *   access?: any
 *   all: () => Promise<TodoRecord[]>
 *   iterator?: (options?: { amount?: number }) => AsyncIterable<TodoRecord>
 *   get: (key: string) => Promise<TodoRecord | TodoValue | null | undefined>
 *   put: (key: string, value: TodoValue) => Promise<unknown>
 *   del: (key: string) => Promise<unknown>
 *   drop: () => Promise<unknown>
 *   log?: {
 *     values?: () => Promise<any[]>
 *     heads?: () => Promise<any[]>
 *     get?: (hash: string) => Promise<any>
 *     joinEntry?: (entry: any) => Promise<unknown>
 *   }
 *   peers?: Set<string>
 *   sync?: {
 *     add?: (entry: any) => Promise<unknown>
 *     start?: () => Promise<unknown>
 *     stop?: () => Promise<unknown>
 *   }
 *   events: {
 *     on: (event: string, handler: (...args: any[]) => void | Promise<void>) => void
 *   }
 * }} TodoDatabase
 */

/**
 * @param {TodoValue | TodoRecord} record
 * @returns {TodoValue}
 */
function unwrapTodoValue(record) {
	return 'value' in record ? record.value : record;
}

// Store for OrbitDB instances
export const orbitdbStore = writable(/** @type {any} */ (null));
export const todoDBStore = writable(/** @type {TodoDatabase | null} */ (null));
export const todoDBAddressStore = writable('');

/**
 * The OrbitDB identity id this session writes with: the passkey DID, or the
 * anonymous identity's public key. Ownership of a todo (delegation01) is
 * decided against this, not against the peer id, which changes on reload.
 */
export const ownIdentityIdStore = derived(
	orbitdbStore,
	($orbitdb) => $orbitdb?.identity?.id ?? null
);

/**
 * Which list is currently open, and how the user got to it. Before this the UI
 * only knew the address, so a freshly created private list was indistinguishable
 * from the shared one and the header kept advertising the shared mnemonic
 * (issue #114).
 *
 * kind: 'shared'  — the public mnemonic list every visitor lands in
 *       'private' — created here, owner-only writes
 *       'guest'   — opened by address, someone else's list
 *
 * @typedef {{ kind: 'shared' | 'private' | 'guest', name: string, address: string }} ActiveList
 */
export const activeListStore = writable(
	/** @type {ActiveList} */ ({ kind: 'shared', name: '', address: '' })
);

// Store for todos
export const todosStore = writable(/** @type {TodoItem[]} */ ([]));

/**
 * #127: how many todos of the open list stay sealed to this session -- handed
 * to someone else, or waiting for a key that has not arrived yet.
 */
export const hiddenTodosStore = writable(0);

/**
 * #127: whether the open list is sealed, and whether this session can write to
 * it yet (it holds a list key).
 */
export const sealedListStore = writable(
	/** @type {{ sealed: boolean, canSeal: boolean }} */ ({ sealed: false, canSeal: false })
);

/** #127: the open sealed list's key store, null otherwise -- for the E2E hook. */
export function activeKeyStore() {
	return activeKeys?.store ?? null;
}

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

const observedDatabases = new WeakSet();
/** @type {Promise<void> | null} */
let pendingTodosLoad = null;
let todosReloadRequested = false;
/** @type {any[]} */
let todoEntriesReceivedDuringLoad = [];
// This is a collaborative demo database with an append-only history. Reading an
// unlimited history can monopolize IndexedDB/IPFS long enough to delay live sync.
const INITIAL_TODO_LIMIT = 250;
/**
 * @param {TodoDatabase | null | undefined} todoDB
 * @returns {string}
 */
function getDatabaseAddress(todoDB) {
	if (!todoDB) return '';

	const address = todoDB.address;
	if (typeof address === 'string') return address;

	if (address && typeof address.toString === 'function') {
		return address.toString();
	}

	return '';
}

/**
 * Counts every change of the open list. Opening a list takes a while, and
 * something that started opening one in the background -- the home list at
 * start -- must not take over from a list somebody opened in the meantime.
 */
let activeListVersion = 0;

/**
 * #127: the keys of the open list when it is sealed, null otherwise.
 * @type {import('./sealed/list-keys.js').ListKeys | null}
 */
let activeKeys = null;
/** @type {(() => void) | null} */
let stopListeningForKeys = null;

/**
 * @param {TodoDatabase | null} todoDB
 * @param {{ kind: 'shared' | 'private' | 'guest', name?: string }} [meta]
 * @param {import('./sealed/list-keys.js').ListKeys | null} [keys] its keys, when it is sealed (#127)
 */
function setActiveTodoDatabase(todoDB, meta, keys = null) {
	activeListVersion += 1;
	stopListeningForKeys?.();
	activeKeys = keys;
	hiddenTodosStore.set(0);
	sealedListStore.set({ sealed: Boolean(keys), canSeal: Boolean(keys?.canSeal()) });
	// A grant that arrives while the list is open opens what was sealed to us.
	stopListeningForKeys = keys
		? keys.onChange(() => {
				sealedListStore.set({ sealed: true, canSeal: keys.canSeal() });
				void loadTodos();
			})
		: null;
	// Whatever is opened now is where the next todo goes, not a home list still
	// to be made.
	homeListPendingStore.set(false);
	const address = getDatabaseAddress(todoDB);
	todoDBStore.set(todoDB);
	todoDBAddressStore.set(address);
	if (meta) activeListStore.set({ kind: meta.kind, name: meta.name ?? '', address });
}

// Initialize database and load existing todos
/**
 * escrow01: the three-word list the start opened. It stays open when another
 * list goes on screen (home-list.js), so {@link openSharedList} can put it
 * back without a restart.
 *
 * @type {TodoDatabase | null}
 */
let sharedTodoDB = null;

/**
 * @param {any} orbitdb
 * @param {TodoDatabase} todoDB
 */
export async function initializeDatabase(orbitdb, todoDB) {
	orbitdbStore.set(orbitdb);
	sharedTodoDB = todoDB;
	setActiveTodoDatabase(todoDB, { kind: 'shared', name: todoDB?.name ?? '' });

	// OrbitDB's non-indexed keyvalue.all() traverses the complete append-only
	// history. Hydrate the UI in the background instead of blocking app startup.
	setupDatabaseListeners(todoDB);
	void loadTodos();

	// Open the registry at startup, not just when something is written to it.
	// Opening it lazily meant a reload showed no lists at all: nothing writes on
	// a fresh load, so the registry was never opened and the switcher stayed
	// hidden even though the entries were there.
	void openListRegistry(orbitdb).catch((error) => {
		console.warn('List registry unavailable:', error);
	});
}

/**
 * escrow01: put this browser's three-word list on screen again.
 *
 * The start opens it and keeps it open, while the list on screen is one's own
 * -- still to be made, or made already. Its three words, link and QR code
 * belong to it alone, so the page offers them only once it is the open list,
 * and this is how it becomes that: a switch to a database already open, with
 * no restart and no passkey prompt.
 *
 * @returns {Promise<{ address: string }>}
 */
export async function openSharedList() {
	if (!sharedTodoDB) throw new Error(translate('errors.orbitdbNotReady'));
	setActiveTodoDatabase(sharedTodoDB, { kind: 'shared', name: sharedTodoDB.name ?? '' });
	setupDatabaseListeners(sharedTodoDB);
	await loadTodos();
	return { address: getDatabaseAddress(sharedTodoDB) };
}

/**
 * Open an OrbitDB todo database by address and make it the active todo list.
 *
 * @param {string} address
 * @param {{ unlessSwitchedSince?: number }} [options] open it, but leave the
 *   open list alone if it changed after this version (see `activeListVersion`)
 * @returns {Promise<{ address: string, count: number, superseded?: boolean }>}
 */
export async function loadTodoDatabase(address, { unlessSwitchedSince } = {}) {
	const orbitdb = get(orbitdbStore);
	const normalizedAddress = address.trim();

	if (!orbitdb) {
		throw new Error(translate('errors.orbitdbNotReady'));
	}

	if (!normalizedAddress) {
		throw new Error(translate('errors.enterAddress'));
	}

	if (!normalizedAddress.startsWith('/orbitdb/')) {
		throw new Error(translate('errors.addressPrefix'));
	}

	try {
		const loadedTodoDB = await orbitdb.open(normalizedAddress, {
			type: 'keyvalue',
			sync: true,
			...(await createLogStorages())
		});
		// #127: a sealed list is opened with its keys, or not at all -- shown
		// without them, it would be a list nobody can write to safely.
		const keys = await keysForList(orbitdb, loadedTodoDB);

		// Prefer what the registry already knows: a list you created is yours even
		// when you reach it through the switcher, and its friendly name is not the
		// suffixed database name. A guest knows only the database name, so the
		// suffix the owner's page added comes off (list-name.js).
		const openedAddressForMeta = getDatabaseAddress(loadedTodoDB) || normalizedAddress;
		const known = get(listRegistryStore).find((entry) => entry.address === openedAddressForMeta);
		// The registry is not the only witness, and not always a present one: after
		// a reload in memory mode it is still empty when the list from the link
		// opens. Asked of the controller instead, a list you own is yours whether
		// or not the registry has caught up -- and it is not written back to the
		// registry as somebody else's.
		const owned = known?.role === 'owner' || (await ownsList(loadedTodoDB, orbitdb.identity?.id));
		if (unlessSwitchedSince !== undefined && activeListVersion !== unlessSwitchedSince) {
			return { address: openedAddressForMeta, count: 0, superseded: true };
		}
		setActiveTodoDatabase(
			loadedTodoDB,
			{
				kind: owned ? 'private' : 'guest',
				// A sealed list's database name is random: its name comes from
				// `meta/name` once that opens (loadTodosSnapshot).
				name: known?.name || (keys ? '' : listNameFromDatabase(loadedTodoDB?.name))
			},
			keys
		);
		setupDatabaseListeners(loadedTodoDB);
		await loadTodos();
		// #127: a writer granted before he had a key for sealed lists gets his
		// copies the next time the owner opens the list.
		if (keys && keys.ownerDid === orbitdb.identity?.id) void giveMissingKeys(loadedTodoDB, keys);

		const openedAddress = getDatabaseAddress(loadedTodoDB) || normalizedAddress;
		try {
			await rememberList(orbitdb, {
				address: openedAddress,
				// The name the registry already has is the one a person gave the list;
				// otherwise the database's own name, without its random suffix -- or,
				// for a sealed list, the one `meta/name` gave the list on screen.
				name:
					known?.name ||
					(keys ? get(activeListStore).name : listNameFromDatabase(loadedTodoDB?.name)),
				role: owned ? 'owner' : 'guest',
				sealed: Boolean(keys)
			});
		} catch (error) {
			console.warn('Could not record the opened list in the registry:', error);
		}

		return {
			address: openedAddress,
			count: get(todosCountStore)
		};
	} catch (error) {
		if (error instanceof NoSealedReaderError) throw new Error(translate('errors.noSealedReader'));
		throw new Error(
			translate('errors.loadFailed', {
				reason: error instanceof Error ? error.message : String(error)
			})
		);
	}
}

/**
 * Create a NEW private todo list: an access-controlled database whose
 * initial write set is only the creator's own identity. Grants/revokes then
 * happen at runtime through the permissions panel without changing the
 * address (acl01). The new list becomes the active list.
 *
 * delegation01: the controller is the delegated-todo one, which is the
 * acl01 controller plus one extra rule — a DID a single todo was delegated
 * to may complete or rename that todo without being in the write set.
 *
 * @param {string} [name] optional human name; a unique suffix is always added
 * @param {{ unlessSwitchedSince?: number }} [options] as for `loadTodoDatabase`:
 *   the list is made and recorded either way, but opened only if nothing else
 *   was opened since
 * @returns {Promise<{ address: string, name: string, superseded?: boolean }>}
 */
export async function createPrivateTodoList(name = 'private-todos', { unlessSwitchedSince } = {}) {
	const orbitdb = get(orbitdbStore);
	if (!orbitdb) throw new Error(translate('errors.orbitdbNotReady'));

	const listName = name.trim() || 'private-todos';
	// #127: always sealed (user decision 2). The database name is random, the
	// readable name goes in sealed as `meta/name`, and the list key is made
	// with it. Without a key for sealed lists in this session there is no
	// private list: one in the clear would be the thing the decision rules out.
	let created;
	try {
		created = await createSealedList(orbitdb, { name: listName });
	} catch (error) {
		if (error instanceof NoSealedReaderError) throw new Error(translate('errors.noSealedReader'));
		throw error;
	}
	const { db: privateDB, keys } = created;

	const superseded = unlessSwitchedSince !== undefined && activeListVersion !== unlessSwitchedSince;
	if (!superseded) {
		setActiveTodoDatabase(privateDB, { kind: 'private', name: listName }, keys);
		setupDatabaseListeners(privateDB);
		await loadTodos();
	}
	const address = getDatabaseAddress(privateDB) || '';
	// Record it, so the list survives a reload and shows up in the switcher.
	// Best effort: a failing registry must not lose the list the user just made.
	try {
		await rememberList(orbitdb, { address, name: listName, role: 'owner', sealed: true });
	} catch (error) {
		console.warn('Could not record the new list in the registry:', error);
	}
	// The caller needs both: the address is what gets shared, the name is what
	// the user recognises it by. Returning only the address is what left the
	// created list invisible (issue #114).
	return superseded ? { address, name: listName, superseded } : { address, name: listName };
}

/**
 * Whether this identity administers the list -- asked of the list's own
 * controller, so it holds before the registry has loaded.
 *
 * `capabilities().admin` includes the write set recorded in the controller's
 * manifest. `access.write` is no use here: a controller opened by address
 * fills it with the *opener's* id.
 *
 * @param {any} db
 * @param {string | undefined} identityId
 */
async function ownsList(db, identityId) {
	if (!identityId || typeof db?.access?.capabilities !== 'function') return false;
	try {
		const capabilities = await db.access.capabilities();
		const admins = capabilities?.admin;
		return Boolean(admins && [...admins].includes(identityId));
	} catch {
		return false;
	}
}

/**
 * True while the start has found no list of this identity's own and the first
 * todo is to make one (`openHomeList` in home-list.js, with `create`). The list on screen
 * is then still the shared one underneath; the page shows the list to come.
 */
export const homeListPendingStore = writable(false);

/**
 * The open list's version, for something that starts opening a list in the
 * background and must not take over from one opened in the meantime
 * (`unlessSwitchedSince`, as `openHomeList` in home-list.js uses it).
 */
export function currentListVersion() {
	return activeListVersion;
}

// Load all todos from the database
export async function loadTodos() {
	todosReloadRequested = true;
	if (pendingTodosLoad) return pendingTodosLoad;

	pendingTodosLoad = (async () => {
		do {
			todosReloadRequested = false;
			await loadTodosSnapshot();
		} while (todosReloadRequested);
		await annotateTodoAuthors();
	})().finally(() => {
		pendingTodosLoad = null;
	});

	return pendingTodosLoad;
}

async function loadTodosSnapshot() {
	const todoDB = get(todoDBStore);
	if (!todoDB) return;

	try {
		const startedAt = performance.now();
		const keys = activeKeys;
		const read = await recordsToShow(keys, await readRecentTodos(todoDB), {
			isAction: isDelegationActionKey
		});
		if (get(todoDBStore) !== todoDB) return;
		const allTodos = read.records;
		hiddenTodosStore.set(read.hidden);
		if (keys) sealedListStore.set({ sealed: true, canSeal: keys.canSeal() });
		if (read.name !== null && read.name !== get(activeListStore).name) {
			activeListStore.update((list) => ({ ...list, name: /** @type {string} */ (read.name) }));
		}

		/** @type {TodoItem[]} */
		const todosArray = [];
		/** @type {any[]} */
		const delegationActions = [];
		for (const record of /** @type {TodoRecord[]} */ (allTodos)) {
			if (isDelegationActionKey(record.key)) {
				delegationActions.push(record.value);
				continue;
			}
			todosArray.push({ id: record.hash, key: record.key, ...record.value });
		}

		// Delegates never touch a todo's own entry; their completions and
		// renames sit beside it as actions and are folded in here (delegation01).
		todosStore.set(sortTodos(applyDelegationActions(todosArray, delegationActions)));
		const pendingEntries = todoEntriesReceivedDuringLoad;
		todoEntriesReceivedDuringLoad = [];
		for (const entry of pendingEntries) applyTodoEntry(entry, false);
		console.log(
			`📋 Loaded ${todosArray.length} todos from the OrbitDB history in ${Math.round(performance.now() - startedAt)}ms`
		);
	} catch (error) {
		console.error('❌ Error loading todos:', error);
	}
}

/**
 * Read a bounded current view when OrbitDB exposes its iterator. This keeps
 * startup and live replication responsive even after years of shared history.
 * Test doubles and older compatible stores can still fall back to `all()`.
 *
 * @param {TodoDatabase} todoDB
 * @returns {Promise<TodoRecord[]>}
 */
async function readRecentTodos(todoDB) {
	if (!todoDB.iterator) return todoDB.all();

	const todos = [];
	for await (const todo of todoDB.iterator({ amount: INITIAL_TODO_LIMIT })) {
		todos.push(todo);
	}
	return todos;
}

/** @param {TodoItem[]} todos */
function sortTodos(todos) {
	return todos.sort((a, b) => {
		const dateA = new Date(a.createdAt || 0).getTime();
		const dateB = new Date(b.createdAt || 0).getTime();
		return dateB - dateA;
	});
}

// Resolve an entry's identity hash to the author's identity id (the DID for
// passkey identities). entry.identity is set by OrbitDB itself, so unlike a
// value field it cannot be spoofed by whoever writes the todo payload.
/** @type {Map<string, string>} */
const authorByIdentityHash = new Map();

/** @param {string | undefined} identityHash */
async function resolveAuthor(identityHash) {
	if (!identityHash) return '';
	const cached = authorByIdentityHash.get(identityHash);
	if (cached !== undefined) return cached;
	try {
		const orbitdb = get(orbitdbStore);
		const identity = await orbitdb?.identities?.getIdentity?.(identityHash);
		const author = identity?.id ?? '';
		authorByIdentityHash.set(identityHash, author);
		return author;
	} catch {
		return '';
	}
}

/** @param {string} key @param {string} author */
function patchTodoAuthor(key, author) {
	if (!author) return;
	todosStore.update((todos) =>
		todos.map((todo) => (todo.key === key && !todo.author ? { ...todo, author } : todo))
	);
}

/**
 * Backfill authors for todos loaded through the iterator (which yields only
 * hash/key/value): fetch the full log entry to reach entry.identity.
 */
async function annotateTodoAuthors() {
	const todoDB = get(todoDBStore);
	if (!todoDB?.log?.get) return;
	const todos = get(todosStore);
	for (const todo of todos) {
		if (todo.author || !todo.id) continue;
		try {
			const entry = await todoDB.log.get(todo.id);
			patchTodoAuthor(todo.key, await resolveAuthor(entry?.identity));
		} catch {
			// entry not locally available yet — a later update event will carry it
		}
	}
}

/**
 * @param {any} entry
 * @param {boolean} [trackDuringLoad=true]
 */
function applyTodoEntry(entry, trackDuringLoad = true) {
	const { op, key, value } = entry?.payload ?? {};
	if (!key || (op !== 'PUT' && op !== 'DEL')) return false;
	// #127: an entry of a sealed list is opened on the way in, with the rest;
	// the caller re-reads.
	if (activeKeys) return false;
	// A delegation action changes a *different* key's todo. Rather than merge
	// one action incrementally, let the caller re-read the log, where all of
	// them are folded in together and in order.
	if (isDelegationActionKey(key)) return false;
	if (trackDuringLoad && pendingTodosLoad) todoEntriesReceivedDuringLoad.push(entry);

	todosStore.update((todos) => {
		const withoutPreviousValue = todos.filter((todo) => todo.key !== key);
		if (op === 'DEL') return withoutPreviousValue;

		return sortTodos([...withoutPreviousValue, { id: entry.hash, key, ...value }]);
	});
	void resolveAuthor(entry?.identity).then((author) => patchTodoAuthor(key, author));
	// The raw entry just replaced a todo that may have had delegate actions
	// folded in; a re-read puts the surviving ones back (or drops them, if
	// this write revoked the delegation).
	if (value?.delegation) void loadTodos();
	return true;
}

// Set up database event listeners
/**
 * @param {TodoDatabase} todoDB
 */
function setupDatabaseListeners(todoDB) {
	if (!todoDB) return;
	if (observedDatabases.has(todoDB)) return;
	observedDatabases.add(todoDB);

	// Listen for new entries being added
	todoDB.events.on('join', (_peerId, heads) => {
		console.log('📝 Database peer joined:', heads);
		void loadTodos();
	});

	// Listen for entries being updated
	todoDB.events.on('update', (...args) => {
		const entry = args.find((value) => value?.payload);
		console.log('🔄 Entry updated:', entry);
		if (!applyTodoEntry(entry)) {
			void loadTodos();
			return;
		}

		const { op, key } = entry?.payload ?? {};
		if (op === 'PUT' && key && entry?.hash) {
			scheduleRelayReplicationProof(
				key,
				String(entry.hash),
				getDatabaseAddress(todoDB),
				resubscribeIfOpen
			);
		}
	});
}

/**
 * @typedef {{ delegateDid?: string | null, expiresAt?: string | null }} DelegationRequest
 */

/**
 * @param {DelegationRequest | null | undefined} request
 * @param {string | null} grantedBy
 * @param {import('./delegation.js').Delegation | null} [previous] kept `grantedAt` when re-delegating to the same DID
 * @returns {import('./delegation.js').Delegation | null}
 */
function buildDelegation(request, grantedBy, previous = null) {
	const delegateDid = request?.delegateDid?.trim();
	if (!delegateDid) return null;
	return {
		delegateDid,
		grantedBy,
		grantedAt:
			previous?.delegateDid === delegateDid && previous?.grantedAt
				? previous.grantedAt
				: new Date().toISOString(),
		expiresAt: request?.expiresAt || null,
		revokedAt: null
	};
}

/** @param {unknown} error */
function describeWriteError(error) {
	// #127: no key to seal with is not a refusal by the list, and must not
	// read like one.
	if (error instanceof NoListKeyError || error instanceof NoTaskKeyError) {
		return { denied: false, message: translate('errors.sealedNoKey') };
	}
	const message = error instanceof Error ? error.message : String(error);
	const denied = /not allowed to write|does not have write access|access denied/i.test(message);
	return { denied, message };
}

/** A key for a new todo. Exported so a budget's `todoRef` can be made before the todo is written. */
export function createTodoKey() {
	return `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Add a new todo
/**
 * @param {string} text
 * @param {string | null} [assignee=null]
 * @param {DelegationRequest | null} [delegation=null] delegation01: hand this todo to a DID on creation
 * @param {{ key?: string, budget?: import('./budget/budget.js').Budget | null }} [extra]
 *   escrow01: the key from `createTodoKey()` and the budget the todo starts
 *   with, so a todo whose budget is being locked is written once, already
 *   saying so
 * @returns {Promise<{ ok: boolean, error?: string, key?: string }>}
 */
export async function addTodo(text, assignee = null, delegation = null, extra = {}) {
	const todoDB = get(todoDBStore);
	const myPeerId = get(peerIdStore);
	const myIdentityId = get(ownIdentityIdStore);

	if (!todoDB || !myPeerId) {
		console.error('❌ Database or peer ID not available');
		return { ok: false, error: translate('errors.databaseNotReady') };
	}

	if (!text || text.trim() === '') {
		console.error('❌ Todo text cannot be empty');
		return { ok: false, error: translate('errors.emptyText') };
	}

	if (delegation?.delegateDid?.trim() && !supportsDelegation(todoDB)) {
		return { ok: false, error: translate('errors.listCannotDelegate') };
	}

	if (extra.budget && !buildDelegation(delegation, myIdentityId)) {
		return { ok: false, error: translate('errors.budgetNeedsDelegate') };
	}

	try {
		const todoId = extra.key ?? createTodoKey();
		/** @type {TodoValue} */
		const todo = {
			text: text.trim(),
			completed: false,
			createdBy: myPeerId,
			// Ownership for delegation is by identity, which survives a reload;
			// the peer id above does not.
			createdByIdentity: myIdentityId,
			delegation: buildDelegation(delegation, myIdentityId),
			assignee: assignee,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
		// Only when there is one: a todo without a budget stays exactly the shape
		// the earlier chapters write.
		if (extra.budget) todo.budget = extra.budget;

		if (todo.delegation && activeKeys) {
			const handed = await handOverKey(todoDB, todoId, todo.delegation.delegateDid);
			if (handed) return { ok: false, error: handed };
		}
		const entryHash = await putTodo(todoDB, todoId, todo);
		scheduleRelayReplicationProof(todoId, entryHash, getDatabaseAddress(todoDB), resubscribeIfOpen);
		console.log('✅ Todo added:', todoId);
		return { ok: true, key: todoId };
	} catch (error) {
		// A denied write throws inside OrbitDB's canAppend gate BEFORE anything
		// is appended locally, so nothing shows up as "saved" — surface why.
		console.error('❌ Error adding todo:', error);
		const { denied, message } = describeWriteError(error);
		return {
			ok: false,
			error: denied
				? translate('errors.noWritePermission')
				: translate('errors.addFailed', { reason: message })
		};
	}
}

/**
 * Re-subscribing makes OrbitDB perform its native heads exchange while the
 * relay has the database open (the relay proof asks for this between its
 * request and the answer). Only for the list still open here.
 *
 * @param {string} dbAddress
 */
async function resubscribeIfOpen(dbAddress) {
	const todoDB = get(todoDBStore);
	if (getDatabaseAddress(todoDB) === dbAddress && todoDB?.sync?.stop && todoDB.sync.start) {
		await todoDB.sync.stop();
		await todoDB.sync.start();
	}
}

// Delete a todo
/**
 * @param {string | number} todoId
 */
export async function deleteTodo(todoId) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		// If todoId is numeric (array index), we need to find the correct database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(String(todoId), 10))) {
			const todo = get(todosStore)[parseInt(String(todoId), 10)];
			if (todo?.key) {
				actualTodoId = todo.key;
			}
		}

		// Delete the todo using the correct key
		await todoDB.del(String(actualTodoId));
		todoReplicationStatusStore.update((statuses) => {
			const next = { ...statuses };
			delete next[String(actualTodoId)];
			return next;
		});
		console.log('🗑️ Todo deleted:', todoId, 'actual key:', actualTodoId);

		return true;
	} catch (error) {
		console.error('❌ Error deleting todo:', error);
		return false;
	}
}

/**
 * Who the caller is to a given todo (delegation01).
 *
 * A todo written before this chapter has no `createdByIdentity`; it keeps the
 * acl01 behaviour, where anyone with write access may change it.
 *
 * @param {TodoValue} todoData
 * @param {string | null} identityId
 * @returns {'owner' | 'delegate' | 'none'}
 */
function roleFor(todoData, identityId) {
	const owner = todoData.createdByIdentity || null;
	if (!owner || owner === identityId) return 'owner';
	if (isDelegationActiveFor(todoData, identityId)) return 'delegate';
	return 'none';
}

/**
 * @param {string} todoKey
 * @returns {Promise<{ todoDB: TodoDatabase, todoData: TodoValue } | { error: string }>}
 */
async function readTodoForWrite(todoKey) {
	const todoDB = get(todoDBStore);
	if (!todoDB) return { error: translate('errors.databaseNotReady') };
	const existing = await todoDB.get(todoKey);
	if (!existing) return { error: translate('errors.todoNotFound') };
	const todoData = await valueToChange(activeKeys, todoKey, unwrapTodoValue(existing));
	if (!todoData) return { error: translate('errors.sealedNoKey') };
	return { todoDB, todoData };
}

/**
 * Write a todo's value, sealed when the open list is (#127).
 *
 * @param {TodoDatabase} todoDB
 * @param {string} todoKey
 * @param {TodoValue} todo
 */
async function putTodo(todoDB, todoKey, todo) {
	return String(
		await todoDB.put(todoKey, /** @type {any} */ (await valueToWrite(activeKeys, todoKey, todo)))
	);
}

/**
 * Write a delegate's change as a delegation action beside the todo. The
 * todo's own entry is never touched by a delegate — the access controller
 * would refuse it — and the passkey is asked to confirm first.
 *
 * @param {TodoDatabase} todoDB
 * @param {string} todoKey
 * @param {TodoValue} todoData
 * @param {string} delegateDid
 * @param {{ setCompleted: boolean } | { patch: { text?: string } }} change
 */
async function writeDelegationAction(todoDB, todoKey, todoData, delegateDid, change) {
	const actionName = 'setCompleted' in change ? 'set-completed' : 'patch-fields';
	if (!(await confirmDelegatedWrite(actionName))) {
		return { ok: false, error: translate('errors.passkeyCancelled') };
	}
	const key = buildDelegationActionKey(todoKey, delegateDid);
	// #127: a rename travels sealed under the todo's task key; the controller
	// only checks that `patch.text` is a string.
	const sealedChange =
		'patch' in change && typeof change.patch.text === 'string'
			? {
					patch: {
						...change.patch,
						text: await actionTextToWrite(activeKeys, todoKey, change.patch.text)
					}
				}
			: change;
	const action = buildDelegationAction(
		{ taskKey: todoKey, delegateDid, expiresAt: todoData.delegation?.expiresAt ?? null },
		sealedChange
	);
	const entryHash = String(await todoDB.put(key, /** @type {any} */ (action)));
	scheduleRelayReplicationProof(key, entryHash, getDatabaseAddress(todoDB), resubscribeIfOpen);
	await loadTodos();
	console.log(`✅ Delegated ${actionName} written:`, key);
	return { ok: true };
}

/** Read when a write is refused, so it is in the language on screen at that moment. */
const notAllowed = () => translate('errors.notAllowed');

// Toggle todo completion status
/**
 * @param {string} todoKey
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function toggleTodoComplete(todoKey) {
	try {
		const read = await readTodoForWrite(String(todoKey));
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		const myIdentityId = get(ownIdentityIdStore);
		const role = roleFor(todoData, myIdentityId);
		if (role === 'none') return { ok: false, error: notAllowed() };

		// Toggle what is on screen: the todo with its delegate's actions folded
		// in. The entry alone still says "open" after a delegate completed it, so
		// the owner's first click on "reopen" wrote "completed" again (escrow01's
		// "Reopen" next to "Release budget" is exactly that click).
		const shown = get(todosStore).find((todo) => todo.key === String(todoKey));
		const nextCompleted = !(shown ? shown.completed : todoData.completed || false);
		if (role === 'delegate' && myIdentityId) {
			return writeDelegationAction(todoDB, String(todoKey), todoData, myIdentityId, {
				setCompleted: nextCompleted
			});
		}

		const updatedTodo = {
			...todoData,
			completed: nextCompleted,
			updatedAt: new Date().toISOString()
		};
		const entryHash = await putTodo(todoDB, String(todoKey), updatedTodo);
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[String(todoKey)]: 'pending'
		}));
		void verifyRelayReplication(
			String(todoKey),
			entryHash,
			getDatabaseAddress(todoDB),
			resubscribeIfOpen
		);
		console.log('✅ Todo toggled:', todoKey, updatedTodo.completed);
		return { ok: true };
	} catch (error) {
		console.error('❌ Error toggling todo:', error);
		const { denied, message } = describeWriteError(error);
		return {
			ok: false,
			error: denied ? notAllowed() : translate('errors.updateFailed', { reason: message })
		};
	}
}

/**
 * Rename a todo. Owners rewrite the todo; a delegate writes a `patch-fields`
 * action, the second of the two things the access controller lets them do.
 *
 * @param {string} todoKey
 * @param {string} text
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function updateTodoText(todoKey, text) {
	const nextText = text.trim();
	if (!nextText) return { ok: false, error: translate('errors.emptyText') };
	try {
		const read = await readTodoForWrite(todoKey);
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		const myIdentityId = get(ownIdentityIdStore);
		const role = roleFor(todoData, myIdentityId);
		if (role === 'none') return { ok: false, error: notAllowed() };

		if (role === 'delegate' && myIdentityId) {
			return writeDelegationAction(todoDB, todoKey, todoData, myIdentityId, {
				patch: { text: nextText }
			});
		}

		const updatedTodo = { ...todoData, text: nextText, updatedAt: new Date().toISOString() };
		const entryHash = await putTodo(todoDB, todoKey, updatedTodo);
		scheduleRelayReplicationProof(
			todoKey,
			entryHash,
			getDatabaseAddress(todoDB),
			resubscribeIfOpen
		);
		return { ok: true };
	} catch (error) {
		console.error('❌ Error renaming todo:', error);
		const { denied, message } = describeWriteError(error);
		return {
			ok: false,
			error: denied ? notAllowed() : translate('errors.renameFailed', { reason: message })
		};
	}
}

/**
 * Hand a todo to another DID, or re-delegate it (delegation01). Owner only:
 * the delegation lives inside the todo's own entry, which only the write set
 * may rewrite.
 *
 * @param {string} todoKey
 * @param {DelegationRequest} request
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function delegateTodo(todoKey, request) {
	if (!request?.delegateDid?.trim()) {
		return { ok: false, error: translate('errors.enterDelegateDid') };
	}
	try {
		const read = await readTodoForWrite(todoKey);
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		if (!supportsDelegation(todoDB)) {
			return { ok: false, error: translate('errors.noDelegation') };
		}
		const myIdentityId = get(ownIdentityIdStore);
		if (roleFor(todoData, myIdentityId) !== 'owner') {
			return { ok: false, error: translate('errors.onlyOwnerDelegates') };
		}
		if (request.delegateDid.trim() === myIdentityId) {
			return { ok: false, error: translate('errors.alreadyOwner') };
		}
		const updatedTodo = {
			...todoData,
			delegation: buildDelegation(request, myIdentityId, todoData.delegation ?? null),
			updatedAt: new Date().toISOString()
		};
		// #127: a new epoch of the todo's own key, for the delegate, the writers
		// and the owner. Without it nothing is written: the todo would go to a
		// delegate who cannot read it, or under a key an earlier one still holds.
		if (activeKeys) {
			const handed = await handOverKey(todoDB, todoKey, request.delegateDid.trim());
			if (handed) return { ok: false, error: handed };
		}
		const entryHash = await putTodo(todoDB, todoKey, updatedTodo);
		scheduleRelayReplicationProof(
			todoKey,
			entryHash,
			getDatabaseAddress(todoDB),
			resubscribeIfOpen
		);
		await loadTodos();
		return { ok: true };
	} catch (error) {
		console.error('❌ Error delegating todo:', error);
		const { message } = describeWriteError(error);
		return { ok: false, error: translate('errors.delegateFailed', { reason: message }) };
	}
}

/**
 * Write a todo's budget metadata (escrow01). Only the todo's owner, by
 * identity — a todo from before delegation01 has no owner and never carries a
 * budget. Throws, so a budget flow can tell a write that did not happen from
 * one that did.
 *
 * A budget write leaves `updatedAt` alone. Delegate actions older than the
 * todo's `updatedAt` are dropped on read, so bumping it for a status change
 * would silently undo the delegate's completion. The one exception is the
 * write that starts a release, `acceptCompletion`: releasing is the owner
 * accepting the work, so the completion moves into the owner's own entry,
 * where a later revocation cannot take it back.
 *
 * @param {string} todoKey
 * @param {import('./budget/budget.js').Budget} budget
 * @param {{ acceptCompletion?: boolean }} [options]
 */
export async function setTodoBudget(todoKey, budget, { acceptCompletion = false } = {}) {
	const read = await readTodoForWrite(todoKey);
	if ('error' in read) throw new Error(read.error);
	const { todoDB, todoData } = read;
	const myIdentityId = get(ownIdentityIdStore);
	if (!todoData.createdByIdentity || todoData.createdByIdentity !== myIdentityId) {
		throw new Error(translate('errors.onlyOwnerBudget'));
	}
	const updatedTodo = acceptCompletion
		? { ...todoData, budget, completed: true, updatedAt: new Date().toISOString() }
		: { ...todoData, budget };
	const entryHash = await putTodo(todoDB, todoKey, updatedTodo);
	scheduleRelayReplicationProof(todoKey, entryHash, getDatabaseAddress(todoDB), resubscribeIfOpen);
	await loadTodos();
}

/**
 * Take a delegation back. The delegate's earlier actions stop applying the
 * moment this entry replicates — see applyDelegationActions — and any they
 * write afterwards are ignored on read.
 *
 * @param {string} todoKey
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function revokeTodoDelegation(todoKey) {
	try {
		const read = await readTodoForWrite(todoKey);
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		if (!todoData.delegation?.delegateDid) {
			return { ok: false, error: translate('errors.notDelegated') };
		}
		const myIdentityId = get(ownIdentityIdStore);
		if (roleFor(todoData, myIdentityId) !== 'owner') {
			return { ok: false, error: translate('errors.onlyOwnerRevokes') };
		}
		const now = new Date().toISOString();
		const updatedTodo = {
			...todoData,
			delegation: { ...todoData.delegation, revokedAt: now, revokedBy: myIdentityId },
			updatedAt: now
		};
		// #127: taken back, the todo goes under the list key again, which the
		// delegate never had (sealTodo): what follows is not his to read.
		const entryHash = await putTodo(todoDB, todoKey, updatedTodo);
		scheduleRelayReplicationProof(
			todoKey,
			entryHash,
			getDatabaseAddress(todoDB),
			resubscribeIfOpen
		);
		await loadTodos();
		return { ok: true };
	} catch (error) {
		console.error('❌ Error revoking delegation:', error);
		const { message } = describeWriteError(error);
		return { ok: false, error: translate('errors.revokeFailed', { reason: message }) };
	}
}

/**
 * #127: the key a delegate needs for his todo in a sealed list, made before
 * the todo names him. Only the list's owner holds the key store, so only she
 * can hand a todo over there.
 *
 * @param {TodoDatabase} todoDB
 * @param {string} todoKey
 * @param {string} delegateDid
 * @returns {Promise<string | null>} an error to show, or null when the key is there
 */
async function handOverKey(todoDB, todoKey, delegateDid) {
	const keys = activeKeys;
	if (!keys) return null;
	if (keys.ownerDid !== get(ownIdentityIdStore)) {
		return translate('errors.sealedDelegateNeedsOwner');
	}
	const { missing } = await keys.delegate(todoKey, delegateDid, await writersOf(todoDB));
	// Whoever has no key in the directory yet -- a delegate who has not started
	// the app since #127, or whose key has not reached this browser -- gets his
	// copy later. Until then he reads nothing of it.
	for (const did of missing) {
		keepGranting(keys, () =>
			did === delegateDid
				? keys.ensureTaskGranted(todoKey, did, { timeoutMs: 20_000 })
				: keys.ensureGranted(did, { timeoutMs: 20_000 })
		);
	}
	return null;
}

/** When the owner's session tries again to hand out a copy that is missing. */
const GRANT_AGAIN_AFTER_MS = [10_000, 30_000, 60_000, 120_000, 300_000];

/**
 * #127: try to write a missing copy again a few times while this session
 * runs, until one attempt writes it. Best effort: the owner's next visit to
 * the list tries as well (`giveMissingKeys`).
 *
 * @param {import('./sealed/list-keys.js').ListKeys} keys
 * @param {() => Promise<string[]>} attempt the slots it wrote
 */
function keepGranting(keys, attempt) {
	let tries = 0;
	const next = () => {
		const wait = GRANT_AGAIN_AFTER_MS[tries++];
		if (wait === undefined) return;
		setTimeout(async () => {
			try {
				if ((await attempt()).length === 0) next();
			} catch (error) {
				// The keys were closed (another list, a restart): nothing to do.
				console.warn('Could not hand out a missing key yet:', error);
			}
		}, wait);
	};
	void attempt()
		.then((written) => written.length === 0 && next())
		.catch(() => next());
}

/**
 * #127: the copies the writers of a sealed list are missing, written by its
 * owner's session. Best effort, in the background.
 *
 * @param {TodoDatabase} todoDB
 * @param {import('./sealed/list-keys.js').ListKeys} keys
 */
async function giveMissingKeys(todoDB, keys) {
	try {
		for (const did of await writersOf(todoDB)) await keys.ensureGranted(did);
		for (const todo of get(todosStore)) {
			const delegateDid = todo.delegation?.delegateDid;
			if (delegateDid && !todo.delegation?.revokedAt) {
				await keys.ensureTaskGranted(todo.key, delegateDid);
			}
		}
	} catch (error) {
		console.warn('Could not hand out the missing keys of a sealed list:', error);
	}
}

/**
 * #127: after the owner gave `did` write access to the open list, every key of
 * it, when it is sealed.
 *
 * @param {string} did
 * @returns {Promise<'granted' | 'no-public-key' | 'not-sealed'>}
 */
export async function giveWriterKeys(did) {
	const keys = activeKeys;
	if (!keys) return 'not-sealed';
	const granted = await keysForNewWriter(keys, did);
	if (granted === 'no-public-key') {
		keepGranting(keys, () => keys.ensureGranted(did, { timeoutMs: 20_000 }));
	}
	return granted;
}

/**
 * #127: after the owner took write access from `did`: new keys for the list
 * and for every todo handed to someone, which `did` does not get.
 *
 * @param {string} did
 * @returns {Promise<{ missing: string[] } | 'not-sealed'>}
 */
export async function rotateKeysWithout(did) {
	const todoDB = get(todoDBStore);
	if (!activeKeys || !todoDB) return 'not-sealed';
	const writers = (await writersOf(todoDB)).filter((writer) => writer !== did);
	const handedOver = get(todosStore)
		.filter((todo) => todo.delegation?.delegateDid && !todo.delegation.revokedAt)
		.map((todo) => ({
			key: todo.key,
			delegateDid: /** @type {string} */ (todo.delegation?.delegateDid)
		}));
	return keysAfterWriterLeft(activeKeys, { writers, handedOver });
}

// Delete the current database
export async function deleteCurrentDatabase() {
	const todoDB = get(todoDBStore);
	const orbitdb = get(orbitdbStore);

	if (!todoDB || !orbitdb) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		console.log('🗑️ Deleting current database...');

		// Close the current database
		await todoDB.drop();
		// console.log('✅ Database closed')

		// Drop the database from OrbitDB
		// await orbitdb.close('todos')
		console.log('✅ Database dropped from OrbitDB');

		// Clear the stores
		setActiveTodoDatabase(null);
		todosStore.set([]);

		console.log('✅ Database recreated successfully');
		return true;
	} catch (error) {
		console.error('❌ Error deleting database:', error);
		return false;
	}
}

// Make the function available globally for browser console access
if (typeof window !== 'undefined') {
	const browserWindow = /** @type {Window & typeof globalThis & {
	 *   deleteCurrentDatabase?: typeof deleteCurrentDatabase,
	 *   forceReloadTodos?: typeof loadTodos,
	 *   loadTodoDatabase?: typeof loadTodoDatabase,
	 *   getTodoDatabaseAddress?: () => string,
	 *   getTodoDatabasePeerCount?: () => number,
	 *   getTodoCount?: () => number
	 * }} */ (window);

	browserWindow.deleteCurrentDatabase = deleteCurrentDatabase;
	browserWindow.forceReloadTodos = loadTodos;
	browserWindow.loadTodoDatabase = loadTodoDatabase;
	browserWindow.getTodoDatabaseAddress = () => getDatabaseAddress(get(todoDBStore));
	browserWindow.getTodoDatabasePeerCount = () => get(todoDBStore)?.peers?.size ?? 0;
	browserWindow.getTodoCount = () => get(todosCountStore);
	console.log('🔧 deleteCurrentDatabase function is now available in browser console');
}
