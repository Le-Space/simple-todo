/**
 * Who may write to the open list, and what that makes this session (#127 PR C).
 *
 * The lists tab shows it twice: as the role beside the list's name, and as
 * "Who can write" under it. Read once, here, from the list's access
 * controller, and again whenever the controller replicates a change -- a
 * grant arriving from the owner turns a guest into a writer on screen.
 *
 * `admin` is the owner: the controller's own entries and the manifest's write
 * list. It used to be left out, so the owner's own list showed an empty
 * "Write permissions" and nobody in it (seen live on 26.11.2026). `write` holds
 * the granted identities; an admin found there too is listed once, as owner.
 */
import { derived, writable } from 'svelte/store';
import { ownIdentityIdStore, todoDBStore } from './db-actions.js';

/**
 * @typedef {{
 *   known: boolean,
 *   canGrant: boolean,
 *   admins: string[],
 *   writers: string[]
 * }} ListAccess
 */

/** @type {ListAccess} */
const NOTHING_KNOWN = { known: false, canGrant: false, admins: [], writers: [] };

export const listAccessStore = writable(/** @type {ListAccess} */ (NOTHING_KNOWN));

/** @type {any} */
let current = null;
/** @type {(() => void) | null} */
let detach = null;

todoDBStore.subscribe((db) => {
	if (db === current) return;
	detach?.();
	detach = null;
	current = db;
	listAccessStore.set({
		...NOTHING_KNOWN,
		canGrant: Boolean(/** @type {any} */ (db)?.access?.grant)
	});
	if (!db) return;
	void refreshListAccess();
	const events = /** @type {any} */ (db).access?.events;
	if (events?.on) {
		const onUpdate = () => void refreshListAccess();
		events.on('update', onUpdate);
		detach = () => events.off?.('update', onUpdate);
	}
});

/** Read the open list's controller again; a list opened since is left alone. */
export async function refreshListAccess() {
	const db = current;
	if (!db?.access?.capabilities) return;
	try {
		const capabilities = await db.access.capabilities();
		if (db !== current) return;
		const admins = Array.from(capabilities?.admin ?? [])
			.map(String)
			.sort();
		const writers = Array.from(capabilities?.write ?? [])
			.map(String)
			.filter((id) => id !== '*' && !admins.includes(id))
			.sort();
		listAccessStore.set({ known: true, canGrant: Boolean(db.access.grant), admins, writers });
	} catch (error) {
		console.warn('Could not read access capabilities:', error);
	}
}

/**
 * This session's part in the open list: `owner`, `writer`, `guest`, or null
 * while the controller has not answered (or the list has none).
 *
 * @param {ListAccess} access
 * @param {string | null} identityId
 * @returns {'owner' | 'writer' | 'guest' | null}
 */
export function roleIn(access, identityId) {
	if (!access.known || !identityId) return null;
	if (access.admins.includes(identityId)) return 'owner';
	if (access.writers.includes(identityId)) return 'writer';
	return 'guest';
}

export const listRoleStore = derived([listAccessStore, ownIdentityIdStore], ([access, id]) =>
	roleIn(access, id)
);
