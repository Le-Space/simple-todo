import { readable } from 'svelte/store';
import { libp2pStore } from './p2p-stores.js';
import { todoDBStore } from './db-actions.js';
import { listPeerState } from './list-peers.js';

/**
 * How this browser reaches the other browsers on the open list, as a store
 * (escrow01): the LED under the list's name and the header's dot read the same
 * answer, on every tab, and it is worked out once.
 *
 * It updates on new and closed connections, on the list topic's subscription
 * changes and on OrbitDB's `join`/`leave`, and every few seconds besides,
 * because an event can be missed.
 */

/** Recompute this often even without an event. */
const REFRESH_MS = 3000;

/** @typedef {ReturnType<typeof listPeerState>} ListPeers */

/**
 * @param {any} node
 * @param {any} db
 * @returns {ListPeers}
 */
function compute(node, db) {
	if (!node || !db) return listPeerState({});
	const topic = db.address?.toString?.() ?? '';
	/** @type {unknown[]} */
	let subscribers = [];
	try {
		subscribers = Array.from(node.services?.pubsub?.getSubscribers?.(topic) ?? []);
	} catch {
		// Not subscribed yet: nobody to list.
	}
	return listPeerState({
		connections: node.getConnections?.() ?? [],
		subscribers: [...subscribers, ...Array.from(db.peers ?? [])],
		selfId: node.peerId?.toString?.() ?? null
	});
}

/** @type {import('svelte/store').Readable<ListPeers>} */
export const listPeerStateStore = readable(listPeerState({}), (set) => {
	/** @type {any} */
	let node = null;
	/** @type {any} */
	let db = null;
	/** @type {Array<() => void>} */
	let unlisten = [];
	let last = '';

	const update = () => {
		const next = compute(node, db);
		// Only a change reaches the subscribers, not every refresh.
		const key = JSON.stringify(next);
		if (key === last) return;
		last = key;
		set(next);
	};

	/**
	 * @param {any} target
	 * @param {string} event
	 */
	const on = (target, event) => {
		if (typeof target?.addEventListener === 'function') {
			target.addEventListener(event, update);
			unlisten.push(() => target.removeEventListener(event, update));
		} else if (typeof target?.on === 'function') {
			target.on(event, update);
			unlisten.push(() => target.off?.(event, update));
		}
	};

	const rebind = () => {
		for (const off of unlisten) off();
		unlisten = [];
		on(node, 'connection:open');
		on(node, 'connection:close');
		on(node?.services?.pubsub, 'subscription-change');
		on(db?.events, 'join');
		on(db?.events, 'leave');
		update();
	};

	const stopNode = libp2pStore.subscribe((value) => {
		node = value;
		rebind();
	});
	const stopDb = todoDBStore.subscribe((value) => {
		db = value;
		rebind();
	});
	const timer = setInterval(update, REFRESH_MS);

	return () => {
		stopNode();
		stopDb();
		clearInterval(timer);
		for (const off of unlisten) off();
		unlisten = [];
	};
});
