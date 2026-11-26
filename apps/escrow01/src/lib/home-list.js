/**
 * escrow01: the private start. Without a link, the start ends in a list of
 * one's own rather than in the shared three-word list, because delegation and
 * budgets exist only on a private list (#140).
 *
 * Moved here from db-actions.js as it was. The store that says a home list is
 * still to be made, `homeListPendingStore`, stays there: opening any list
 * clears it, and db-actions.js is where lists are opened.
 */
import { get } from 'svelte/store';
import { recall, remember } from '@simple-todo/todo/browser-memory.js';
import { listRegistryStore, openListRegistry } from './list-registry.js';
import { translate } from './i18n/index.js';
import {
	activeListStore,
	createPrivateTodoList,
	currentListVersion,
	homeListPendingStore,
	loadTodoDatabase,
	orbitdbStore
} from './db-actions.js';

const HOME_LIST_KEY = 'simpleTodo.homeList';

/**
 * escrow01: the list someone starts in when no link brings one.
 *
 * Delegation and budgets exist only on a list with the delegation controller,
 * and the shared three-word list cannot have one -- everybody may write there.
 * So a first visit opened the one list where this chapter's feature is not,
 * and nothing said where it was. The start now lands in a private list of
 * one's own: the one this identity started in before, or the newest list it
 * owns, or a new one.
 *
 * The shared list is not closed for this: it was opened first, as before, and
 * stays open for whoever arrives with the same three words, and for "Open this
 * list" in the lists tab (`openSharedList` in db-actions.js). Until then the
 * page offers neither its words nor its link: they are not where the next
 * todo goes.
 *
 * Runs in the background after the start, so anything opened meanwhile -- a
 * list by address, another shared list -- wins: the home list is then made or
 * found, but not put on screen.
 *
 * @param {string} name for a list created here
 * @param {{ create?: boolean }} [options] `create`: make the list if there is
 *   none yet. Without it, an identity with no list of its own is left with
 *   {@link homeListPendingStore} set, and the first todo makes the list --
 *   unless the registry names one first ({@link openWhenTheRegistryNamesOne}).
 * @returns {Promise<{ address: string, name: string, created: boolean, superseded?: boolean, pending?: boolean }>}
 */
export async function openHomeList(name, { create = false } = {}) {
	const orbitdb = get(orbitdbStore);
	if (!orbitdb) throw new Error(translate('errors.orbitdbNotReady'));
	stopWatchingRegistry?.();
	// The first todo while the registry's list is being opened: it goes there,
	// not into a list made beside it.
	if (openingFromRegistry) {
		await openingFromRegistry;
		if (!get(homeListPendingStore)) {
			const active = get(activeListStore);
			return { address: active.address, name: active.name, created: false };
		}
	}
	const unlessSwitchedSince = currentListVersion();
	// Per identity: a second passkey on this device has lists of its own, and an
	// anonymous identity cannot write to the list an earlier one made.
	const key = `${HOME_LIST_KEY}.${orbitdb.identity?.id ?? ''}`;

	// The registry first, so a list opened below is recognised as one's own.
	try {
		await openListRegistry(orbitdb);
	} catch (error) {
		console.warn('List registry unavailable:', error);
	}

	const remembered = recall(key);
	if (remembered) {
		try {
			const { address, superseded } = await loadTodoDatabase(remembered, { unlessSwitchedSince });
			return { address, name: get(activeListStore).name, created: false, superseded };
		} catch (error) {
			console.warn('The list this identity started in could not be opened:', error);
		}
	}

	const owned = get(listRegistryStore).find((entry) => entry.role === 'owner');
	if (owned) {
		try {
			const { address, superseded } = await loadTodoDatabase(owned.address, {
				unlessSwitchedSince
			});
			remember(key, address);
			return { address, name: owned.name, created: false, superseded };
		} catch (error) {
			console.warn('The newest own list could not be opened:', error);
		}
	}

	if (!create) {
		// None yet. It is made with the first todo (`create: true`), not now: a
		// database made at start costs every visitor who only looks one empty
		// list, and the relay one manifest to chase for every such visitor --
		// measured, that load is what kept it from holding the lists people did
		// write to. Until then the start shows where the first todo will go.
		if (currentListVersion() === unlessSwitchedSince) {
			homeListPendingStore.set(true);
			openWhenTheRegistryNamesOne(key, unlessSwitchedSince);
		}
		return { address: '', name, created: false, pending: true };
	}

	const created = await createPrivateTodoList(name, { unlessSwitchedSince });
	remember(key, created.address);
	homeListPendingStore.set(false);
	return { ...created, created: true };
}

/** @type {(() => void) | null} */
let stopWatchingRegistry = null;
/** @type {Promise<void> | null} */
let openingFromRegistry = null;

/**
 * A device that has never seen this passkey starts with an empty registry:
 * nothing of it is kept here, so its entries come from the relay, some
 * seconds after the start has looked (list-registry.js). The start then found
 * no list of its own and said the home list was still to come, and only the
 * first todo looked again -- so the home list stayed "to come" for as long as
 * nobody wrote (~45 s and more, measured 26.11.2026), and a todo written
 * before the registry arrived went into a new list beside the old one.
 *
 * Now the home list opens as soon as the registry names a list this identity
 * owns, while it is still to come: opening anything else clears
 * {@link homeListPendingStore}, and with it this watch.
 *
 * @param {string} key where this identity's home list is remembered
 * @param {number} unlessSwitchedSince the list version the start saw
 */
function openWhenTheRegistryNamesOne(key, unlessSwitchedSince) {
	/** @type {Array<() => void>} */
	const unsubscribers = [];
	let stopped = false;
	const stop = () => {
		stopped = true;
		for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
		if (stopWatchingRegistry === stop) stopWatchingRegistry = null;
	};
	stopWatchingRegistry = stop;

	unsubscribers.push(
		homeListPendingStore.subscribe((pending) => {
			if (!pending) stop();
		})
	);
	unsubscribers.push(
		listRegistryStore.subscribe((entries) => {
			if (stopped) return;
			const owned = entries.find((entry) => entry.role === 'owner');
			if (!owned) return;
			stop();
			openingFromRegistry = loadTodoDatabase(owned.address, { unlessSwitchedSince })
				.then(({ address, superseded }) => {
					if (!superseded) remember(key, address);
				})
				.catch((error) => {
					console.warn('The list the registry names could not be opened:', error);
				})
				.finally(() => {
					openingFromRegistry = null;
				});
		})
	);
	// A store calls back as it is subscribed to, before handing out its
	// unsubscribe: a watch that ended right there is ended here.
	if (stopped) stop();
}
