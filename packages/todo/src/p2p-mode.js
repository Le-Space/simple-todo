// Whether the app joins the peer-to-peer network at all.
//
// Off, the chapter starts libp2p with no transports, no relay, no discovery
// and no pubsub, and opens its databases without sync: nothing leaves the
// device and nothing arrives from a peer. That is the honest way to test a
// restore from an archive — with the relay reachable, a wiped browser can get
// its list back by replication and nobody would know the archive did nothing.
// It is also what somebody on a metered or hostile network may simply want.
//
// Decided on the consent screen, like the storage choice, because the node is
// built from it; changing it afterwards means tearing the node down. Kept the
// way the storage choice allows (`remember`/`recall`), default on.
import { recall, remember } from './browser-memory.js';
import { writable } from 'svelte/store';

export const P2P_ENABLED_STORAGE_KEY = 'simpleTodo.p2pEnabled';

let current = true;
export const p2pEnabledStore = writable(current);
p2pEnabledStore.subscribe((enabled) => {
	current = enabled;
});

/** Read the remembered choice, if there is one. Called once before the dialog renders. */
export function initializeP2PMode() {
	if (typeof localStorage === 'undefined') return;
	const stored = recall(P2P_ENABLED_STORAGE_KEY);
	if (stored == null) return;
	setP2PEnabled(stored !== 'false');
}

/** @param {boolean} enabled */
export function setP2PEnabled(enabled) {
	current = enabled;
	p2pEnabledStore.set(enabled);
	try {
		remember(P2P_ENABLED_STORAGE_KEY, String(enabled));
	} catch {
		// No storage: the choice holds for this session and no longer.
	}
}

export function getP2PEnabled() {
	return current;
}
