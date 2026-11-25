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
 * stays open for whoever arrives with the same three words.
 *
 * Runs in the background after the start, so anything opened meanwhile -- a
 * list by address, another shared list -- wins: the home list is then made or
 * found, but not put on screen.
 *
 * @param {string} name for a list created here
 * @param {{ create?: boolean }} [options] `create`: make the list if there is
 *   none yet. Without it, an identity with no list of its own is left with
 *   {@link homeListPendingStore} set, and the first todo makes the list.
 * @returns {Promise<{ address: string, name: string, created: boolean, superseded?: boolean, pending?: boolean }>}
 */
export async function openHomeList(name, { create = false } = {}) {
	const orbitdb = get(orbitdbStore);
	if (!orbitdb) throw new Error(translate('errors.orbitdbNotReady'));
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
		if (currentListVersion() === unlessSwitchedSince) homeListPendingStore.set(true);
		return { address: '', name, created: false, pending: true };
	}

	const created = await createPrivateTodoList(name, { unlessSwitchedSince });
	remember(key, created.address);
	homeListPendingStore.set(false);
	return { ...created, created: true };
}
