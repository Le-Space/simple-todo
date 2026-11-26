/**
 * The keys of one sealed list in this session (#127).
 *
 * Ties a list's key store (./key-store.js) to a key ring (./key-ring.js) for
 * this reader:
 *
 * - **Creating** a list makes its first key, epoch 0, and the owner wraps it
 *   for herself straight away. Her other devices derive the same X25519 key
 *   from the same passkey, so they open her copy like anyone else's.
 * - **Opening** a list loads every copy addressed to this reader, and loads
 *   again whenever the store changes: a grant arrives while the list is open,
 *   or the owner's copy replicates after the list did.
 * - **Granting** looks up the reader's public key in the account directory
 *   and wraps every list epoch for it. Only the owner can, because only her
 *   session can write the store.
 *
 * Only the list's creator makes a key. A device that opens a list and finds no
 * copy waits for one; it never makes a key of its own, which would seal
 * entries nobody else could read.
 */
import { createKeyRing, LIST_SCOPE, newEpochKey } from './key-ring.js';
import { grantListKeys, loadOwnKeys, openKeyStore, putListKeyCopy } from './key-store.js';

/**
 * @typedef {{ did: string, agreementKey: import('./key-agreement.js').AgreementKey }} Reader
 */

/**
 * @typedef {object} ListKeys
 * @property {import('./key-ring.js').KeyRing} ring
 * @property {any} store the key store database
 * @property {string} ownerDid
 * @property {() => boolean} canSeal true once this session holds a list key
 * @property {(did: string) => Promise<'granted' | 'no-public-key'>} grant
 *   wrap every list epoch for `did`; owner only
 * @property {(listener: () => void) => () => void} onChange
 *   hears that new keys arrived; returns the unsubscribe
 * @property {() => Promise<void>} close
 */

/**
 * Keys for a list this session has just created.
 *
 * @param {any} orbitdb
 * @param {{
 *   listAddress: string,
 *   own: Reader,
 *   lookupPublicKey: (did: string) => Promise<Uint8Array | null>
 * }} options `lookupPublicKey` reads a reader's key from the account directory
 * @returns {Promise<ListKeys>}
 */
export async function createListKeys(orbitdb, { listAddress, own, lookupPublicKey }) {
	const store = await openKeyStore(orbitdb, { listAddress, ownerDid: own.did });
	const ring = createKeyRing();
	const key = newEpochKey();
	try {
		ring.add(LIST_SCOPE, 0, key);
		await putListKeyCopy(store, {
			epoch: 0,
			key,
			recipient: { did: own.did, publicKey: own.agreementKey.publicKey }
		});
	} finally {
		key.fill(0);
	}
	return listKeys({ store, ring, own, ownerDid: own.did, lookupPublicKey });
}

/**
 * Keys for a list this session opens: its own on another device or after a
 * reload, or one it was granted.
 *
 * @param {any} orbitdb
 * @param {{
 *   listAddress: string,
 *   ownerDid: string,
 *   own: Reader,
 *   lookupPublicKey: (did: string) => Promise<Uint8Array | null>
 * }} options
 * @returns {Promise<ListKeys>}
 */
export async function openListKeys(orbitdb, { listAddress, ownerDid, own, lookupPublicKey }) {
	const store = await openKeyStore(orbitdb, { listAddress, ownerDid });
	const ring = createKeyRing();
	await loadOwnKeys(store, ring, own);
	return listKeys({ store, ring, own, ownerDid, lookupPublicKey });
}

/**
 * @param {{
 *   store: any,
 *   ring: import('./key-ring.js').KeyRing,
 *   own: Reader,
 *   ownerDid: string,
 *   lookupPublicKey: (did: string) => Promise<Uint8Array | null>
 * }} parts
 * @returns {ListKeys}
 */
function listKeys({ store, ring, own, ownerDid, lookupPublicKey }) {
	/** @type {Set<() => void>} */
	const listeners = new Set();
	/** @type {Promise<void>} */
	let loading = Promise.resolve();

	const onUpdate = () => {
		// One load at a time: two at once would race to add the same key.
		loading = loading
			.then(() => loadOwnKeys(store, ring, own))
			.then(({ added }) => {
				if (added.length === 0) return;
				for (const listener of listeners) listener();
			})
			.catch((error) => console.warn('Could not load the keys of a sealed list:', error));
	};
	store.events.on('update', onUpdate);

	return {
		ring,
		store,
		ownerDid,
		canSeal: () => ring.current(LIST_SCOPE) !== null,

		async grant(did) {
			if (own.did !== ownerDid) {
				throw new Error('Only the list’s owner hands out its keys.');
			}
			const publicKey = await lookupPublicKey(did);
			if (!publicKey) return 'no-public-key';
			await grantListKeys(store, ring, { did, publicKey });
			return 'granted';
		},

		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		async close() {
			store.events.off('update', onUpdate);
			listeners.clear();
			await loading;
			ring.clear();
			await store.close();
		}
	};
}
