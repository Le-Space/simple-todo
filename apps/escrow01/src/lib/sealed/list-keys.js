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
 * - **A writer** gets every key: the list's, and the task key of every todo
 *   that was handed to someone (`grant`).
 * - **A delegate** gets the key of his own todo and nothing else (user
 *   decision 1, 25.11.2026; no interim with the list key, 26.11.2026). Every
 *   delegation starts a new epoch of that todo's key, so an earlier delegate
 *   of the same todo reads nothing written after him (`delegate`).
 * - **A revocation** starts a new epoch (user decision 5): a writer who leaves
 *   keeps the keys he had and gets none of the new ones (`rotate`). A revoked
 *   delegation needs no new key: the todo goes back under the list key, which
 *   the delegate never had.
 *
 * Only the owner wraps, because only her session can write the store; only
 * she can delegate in a sealed list. A device that opens a list and finds no
 * copy waits for one; it never makes a key of its own, which would seal
 * entries nobody else could read.
 */
import { createKeyRing, LIST_SCOPE, newEpochKey, taskScope } from './key-ring.js';
import { openValue } from './envelope.js';
import { META_NAME_KEY, sealForList } from './sealed-list.js';
import { loadOwnKeys, openKeyStore, putKeyCopy, putListKeyCopy, slotFor } from './key-store.js';
import { createNewcomerAnswers } from '../newcomers.js';

/** While a reader holds no key, he joins the store's topic again, which the owner answers. */
const ASK_AGAIN_AFTER_MS = [4_000, 10_000, 30_000, 60_000];
/**
 * How long a write waits for a reader's key in the directory. Not longer: a
 * reader whose key is not there yet gets his copy later (`ensureGranted`,
 * `ensureTaskGranted`), and the owner should not wait for it.
 */
const LOOKUP_DURING_WRITE_MS = 5_000;

/**
 * @typedef {{ did: string, agreementKey: import('./key-agreement.js').AgreementKey }} Reader
 */

/**
 * Who could not be given a key: their DID has no X25519 key in the account
 * directory yet (they have not started the app since #127), so there is
 * nothing to wrap for. The owner's session gives it to them later
 * (`ensureGranted`).
 *
 * @typedef {{ epoch: number, missing: string[] }} Rotation
 */

/**
 * @typedef {object} ListKeys
 * @property {import('./key-ring.js').KeyRing} ring
 * @property {any} store the key store database
 * @property {string} ownerDid
 * @property {() => boolean} canSeal true once this session holds a list key
 * @property {(timeoutMs: number) => Promise<boolean>} whenSealable
 *   resolves true once this session holds a list key, false after `timeoutMs`
 * @property {(did: string) => Promise<'granted' | 'no-public-key'>} grant
 *   a writer: every epoch of every key this ring holds; owner only
 * @property {(todoKey: string, delegateDid: string, readers: string[]) => Promise<Rotation>} delegate
 *   a new epoch of the todo's key, for the owner, `readers` and the delegate;
 *   whoever has no key in the directory yet is in `missing`, and gets his
 *   copy later (`ensureTaskGranted`)
 * @property {(scopeId: string, readers: string[]) => Promise<Rotation>} rotate
 *   a new epoch of one key, for the owner and `readers`
 * @property {(did: string, options?: { timeoutMs?: number }) => Promise<string[]>} ensureGranted
 *   write the copies a writer is missing; the slots written
 * @property {(todoKey: string, did: string, options?: { timeoutMs?: number }) => Promise<string[]>} ensureTaskGranted
 *   write a delegate's copy of the current epoch of his todo's key, if it is
 *   missing; the slots written
 * @property {(name: string) => Promise<void>} setName
 *   the list's readable name, sealed under the list key, in the key store;
 *   owner only
 * @property {() => Promise<string | null>} name
 *   the list's name, when this session holds the key it was sealed under
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
 *   lookupPublicKey: (did: string, options?: { timeoutMs?: number }) => Promise<Uint8Array | null>
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
	return listKeys({ orbitdb, store, ring, own, ownerDid: own.did, lookupPublicKey });
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
 *   lookupPublicKey: (did: string, options?: { timeoutMs?: number }) => Promise<Uint8Array | null>
 * }} options
 * @returns {Promise<ListKeys>}
 */
export async function openListKeys(orbitdb, { listAddress, ownerDid, own, lookupPublicKey }) {
	const store = await openKeyStore(orbitdb, { listAddress, ownerDid });
	const ring = createKeyRing();
	await loadOwnKeys(store, ring, own);
	return listKeys({ orbitdb, store, ring, own, ownerDid, lookupPublicKey });
}

/**
 * @param {{
 *   orbitdb: any,
 *   store: any,
 *   ring: import('./key-ring.js').KeyRing,
 *   own: Reader,
 *   ownerDid: string,
 *   lookupPublicKey: (did: string, options?: { timeoutMs?: number }) => Promise<Uint8Array | null>
 * }} parts
 * @returns {ListKeys}
 */
function listKeys({ orbitdb, store, ring, own, ownerDid, lookupPublicKey }) {
	/** @type {Set<() => void>} */
	const listeners = new Set();
	/** @type {Promise<void>} */
	let loading = Promise.resolve();

	// A copy the owner wrote before a reader opened the store does not reach
	// him over the relay's circuit by itself (../newcomers.js). So the owner's
	// browser answers every newcomer with the store's heads, and whoever holds
	// no key yet asks again, a few times, while the list is open -- the owner
	// too, on a device that never saw the list: her copy is with the relay,
	// whose first heads exchange can be lost like anyone's.
	const newcomers = createNewcomerAnswers(() => orbitdb?.ipfs?.libp2p?.services?.pubsub);
	if (own.did === ownerDid) newcomers.answerThoseThere(store, newcomers.serve(store));
	/** @type {ReturnType<typeof setTimeout>[]} */
	const asks = ASK_AGAIN_AFTER_MS.map((ms) =>
		setTimeout(() => {
			if (ring.scopes().length === 0) newcomers.askAgain(store);
		}, ms)
	);

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

	const assertOwner = () => {
		if (own.did !== ownerDid) throw new Error('Only the list’s owner hands out its keys.');
	};

	/**
	 * The owner's own key and each reader's from the directory; the DIDs
	 * without one are returned apart.
	 *
	 * @param {string[]} readers
	 */
	async function recipientsFor(readers) {
		/** @type {import('./key-store.js').Recipient[]} */
		const recipients = [{ did: own.did, publicKey: own.agreementKey.publicKey }];
		/** @type {string[]} */
		const missing = [];
		for (const did of new Set(readers)) {
			if (did === own.did) continue;
			const publicKey = await lookupPublicKey(did, { timeoutMs: LOOKUP_DURING_WRITE_MS });
			if (publicKey) recipients.push({ did, publicKey });
			else missing.push(did);
		}
		return { recipients, missing };
	}

	/**
	 * A fresh key for the next epoch of `scopeId`, in the ring and wrapped for
	 * every recipient.
	 *
	 * @param {string} scopeId
	 * @param {import('./key-store.js').Recipient[]} recipients
	 */
	async function nextEpoch(scopeId, recipients) {
		const epochs = ring.epochs(scopeId);
		const epoch = epochs.length === 0 ? 0 : epochs[epochs.length - 1] + 1;
		const key = newEpochKey();
		try {
			ring.add(scopeId, epoch, key);
			for (const recipient of recipients) {
				await putKeyCopy(store, { scopeId, epoch, key, recipient });
			}
		} finally {
			key.fill(0);
		}
		return epoch;
	}

	return {
		ring,
		store,
		ownerDid,
		canSeal: () => ring.current(LIST_SCOPE) !== null,

		whenSealable(timeoutMs) {
			if (ring.current(LIST_SCOPE) !== null) return Promise.resolve(true);
			return new Promise((resolve) => {
				/** @param {boolean} sealable */
				const done = (sealable) => {
					clearTimeout(timer);
					listeners.delete(check);
					resolve(sealable);
				};
				const check = () => {
					if (ring.current(LIST_SCOPE) !== null) done(true);
				};
				const timer = setTimeout(() => done(false), timeoutMs);
				listeners.add(check);
			});
		},

		async grant(did) {
			assertOwner();
			const publicKey = await lookupPublicKey(did);
			if (!publicKey) return 'no-public-key';
			await writeCopies(did, publicKey, { onlyMissing: false });
			return 'granted';
		},

		async delegate(todoKey, delegateDid, readers) {
			assertOwner();
			const { recipients, missing } = await recipientsFor([...readers, delegateDid]);
			return { epoch: await nextEpoch(taskScope(todoKey), recipients), missing };
		},

		async rotate(scopeId, readers) {
			assertOwner();
			const { recipients, missing } = await recipientsFor(readers);
			return { epoch: await nextEpoch(scopeId, recipients), missing };
		},

		async ensureGranted(did, { timeoutMs = 0 } = {}) {
			assertOwner();
			const publicKey = await lookupPublicKey(did, { timeoutMs });
			if (!publicKey) return [];
			return writeCopies(did, publicKey, { onlyMissing: true });
		},

		async ensureTaskGranted(todoKey, did, { timeoutMs = 0 } = {}) {
			assertOwner();
			const scopeId = taskScope(todoKey);
			const current = ring.current(scopeId);
			if (!current) return [];
			const slot = slotFor(scopeId, current.epoch, did);
			if ((await store.get(slot)) !== undefined) return [];
			const publicKey = await lookupPublicKey(did, { timeoutMs });
			if (!publicKey) return [];
			const key = /** @type {Uint8Array} */ (ring.raw(scopeId, current.epoch));
			try {
				await putKeyCopy(store, {
					scopeId,
					epoch: current.epoch,
					key,
					recipient: { did, publicKey }
				});
			} finally {
				key.fill(0);
			}
			return [slot];
		},

		// The name lives here rather than in the list (#127): only the owner
		// writes this store, so the name is hers, and the list itself holds
		// todos only -- the relay's proof for a todo compares it with the list's
		// last record, which a name written beside the todos would be.
		async setName(name) {
			assertOwner();
			await store.put(META_NAME_KEY, await sealForList(ring, META_NAME_KEY, name));
		},

		async name() {
			const opened = await openValue(await store.get(META_NAME_KEY), {
				keyFor: ring.keyFor,
				entryKey: META_NAME_KEY
			});
			return opened.state === 'open' && typeof opened.value === 'string' ? opened.value : null;
		},

		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		async close() {
			for (const ask of asks) clearTimeout(ask);
			store.events.off('update', onUpdate);
			listeners.clear();
			await loading;
			ring.clear();
			await store.close();
		}
	};

	/**
	 * Every epoch of every scope, for a writer.
	 *
	 * @param {string} did
	 * @param {Uint8Array} publicKey
	 * @param {{ onlyMissing: boolean }} options
	 */
	async function writeCopies(did, publicKey, { onlyMissing }) {
		/** @type {string[]} */
		const written = [];
		for (const scopeId of ring.scopes()) {
			for (const epoch of ring.epochs(scopeId)) {
				if (onlyMissing && (await store.get(slotFor(scopeId, epoch, did))) !== undefined) continue;
				const key = /** @type {Uint8Array} */ (ring.raw(scopeId, epoch));
				try {
					written.push(
						await putKeyCopy(store, { scopeId, epoch, key, recipient: { did, publicKey } })
					);
				} finally {
					key.fill(0);
				}
			}
		}
		return written;
	}
}
