// The wrapped copies: each key of a list, sealed once per reader who may have it.
//
// Phase 2 of #277. `key-directory.js` says where to find a reader's public
// key; `key-wrapping.js` seals to it; this is where the results are kept so
// the reader can come and get one.
//
// **Not inside the list they unlock.** That is the obvious place and it cannot
// work: the list is sealed under the very key the copy carries, so a reader
// without it could not read the copy either. A separate, unsealed store is
// what breaks the circle.
//
// One store for all lists, keyed by list address, recipient and epoch, rather
// than one store per list: a reader opening a list they were granted has to
// find their copy knowing only the address, and a store per list would mean
// deriving and opening a second database before the first.
//
// **Publicly writable, so a copy counts only if an admin of the list wrote
// it** (#120). This used to say that a forged copy is simply one that does not
// open, and that is true of a copy somebody *altered*. It is not true of a copy
// somebody *made*: Bob's public key is in the directory for anyone to read, so
// Eve can seal a key of her own choosing to it and file it under Bob's entry
// for Alice's list. It opens. Taken as the newest copy, it would make Bob unable
// to read anything Alice wrote — and seal everything Bob writes under a key Eve
// holds. So every candidate is checked for who wrote it, the way the directory
// checks its own entries, and only the list's admins are believed: the identity
// that signed the entry has to be in `capabilities().admin` of that list's
// access controller. OrbitDB carries that identity on the log entry, verified,
// and writing as Alice needs Alice's signing key.

import { createLogStorages } from '@simple-todo/todo/storage-mode.js';
import { IPFSAccessController } from '@orbitdb/core';

import { unwrapKey, wrapKey } from './key-wrapping.js';
import { importDeviceKey } from './device-keys.js';
import { lookupKey } from './key-directory.js';
import { epochKey } from './keyring.js';
import { newKey } from './db-encryption.js';

export const SHARED_KEYS_NAME = 'privacy01-shared-keys';

/** @param {string} listAddress @param {string} did */
const copyPrefix = (listAddress, did) => `${listAddress}|${did}|`;

/** @param {string} listAddress @param {string} did @param {number} epoch */
const copyKey = (listAddress, did, epoch) => `${copyPrefix(listAddress, did)}${epoch}`;

/**
 * Open the store the wrapped copies live in.
 *
 * @param {any} orbitdb
 * @returns {Promise<any>}
 */
export async function openSharedKeys(orbitdb) {
	return orbitdb.open(SHARED_KEYS_NAME, {
		type: 'keyvalue',
		create: true,
		sync: true,
		AccessController: IPFSAccessController({ write: ['*'] }),
		// Memory-only when that is what was chosen; this database is no more
		// exempt than the lists it serves.
		...(await createLogStorages())
	});
}

/**
 * Whose copies of a list's key count: its admins.
 *
 * For the lists this chapter seals — an `OrbitDBAccessController` — that is
 * the creator, fixed in the controller's own manifest and known as soon as
 * the list is open, plus anyone the creator later made an admin. A list on an
 * `IPFSAccessController` has no admins; its fixed writers are the nearest
 * thing. `'*'` is never an admin: "anyone" vouching for a key is the attack.
 *
 * @param {any} access the list's access controller
 * @returns {Promise<Set<string>>}
 */
export async function adminsOf(access) {
	/** @type {Iterable<string>} */
	let admins = [];
	if (typeof access?.capabilities === 'function') {
		admins = (await access.capabilities())?.admin ?? [];
	} else if (Array.isArray(access?.write)) {
		admins = access.write;
	}
	return new Set([...admins].filter((id) => typeof id === 'string' && id !== '*'));
}

/**
 * Seal a list's keys for one reader and publish the copies.
 *
 * Returns what happened rather than throwing on the ordinary case: a DID that
 * has been granted write access but has never opened this chapter has no
 * published key, and the person who granted it needs to be told that in words
 * rather than shown a failure. #277 asks for exactly that — "a DID with no
 * published encryption key is named rather than silently skipped".
 *
 * `recipientPublicKey` skips the directory, for the one recipient whose key is
 * already at hand: the owner sealing a copy for herself.
 *
 * @param {any} orbitdb
 * @param {{ directory: any, store: any }} databases
 * @param {{ listAddress: string, recipientDid: string, keys: import('./keyring.js').EpochKey[], recipientPublicKey?: string }} what
 * @returns {Promise<{ shared: boolean, reason?: 'no-published-key' }>}
 */
export async function shareKeyWith(orbitdb, { directory, store }, what) {
	const { listAddress, recipientDid, keys } = what;
	const published = what.recipientPublicKey ?? (await lookupKey(orbitdb, directory, recipientDid));
	if (!published) return { shared: false, reason: 'no-published-key' };

	const recipient = await importDeviceKey(published);
	for (const { epoch, keyId, key } of keys) {
		const copy = await wrapKey(key, recipient);
		await store.put(copyKey(listAddress, recipientDid, epoch), { epoch, keyId, ...copy });
	}

	return { shared: true };
}

/**
 * The keys of a list an admin sealed for this reader, every epoch of them.
 *
 * Walks the log rather than asking the index: the index keeps the last value
 * under each key and cannot say who wrote it, and "who wrote it" is the only
 * question that makes a copy trustworthy. A copy from anybody else is skipped
 * before it is even opened — opening proves only that it was sealed to this
 * reader, which anybody can do.
 *
 * Tries the reader's current pair first and its earlier ones after
 * (./device-keys.js): copies sealed before the pair came from the PRF output
 * went to the one derived from the signing key. `onlyUnderEarlier` names the
 * keys no copy for the current pair opened yet, so an owner can seal them to
 * herself again.
 *
 * @param {any} store
 * @param {{ listAddress: string, did: string, privateKey: CryptoKey, earlierPrivateKeys?: CryptoKey[], admins: Set<string>, identities: any }} who
 * @returns {Promise<{ keys: import('./keyring.js').EpochKey[], onlyUnderEarlier: Set<string> }>}
 */
export async function keysForRecipient(
	store,
	{ listAddress, did, privateKey, earlierPrivateKeys = [], admins, identities }
) {
	if (!admins?.size) return { keys: [], onlyUnderEarlier: new Set() };

	const prefix = copyPrefix(listAddress, did);
	const entries = (await store?.log?.values?.()) ?? [];
	/** @type {Map<string, boolean>} */
	const byAdmin = new Map();
	/** @type {Map<string, import('./keyring.js').EpochKey>} */
	const found = new Map();
	/** @type {Set<string>} */
	const underCurrent = new Set();

	for (const entry of entries) {
		const payload = entry?.payload;
		const value = payload?.value;
		if (typeof payload?.key !== 'string' || !payload.key.startsWith(prefix) || !value) continue;
		if (typeof value.keyId !== 'string' || underCurrent.has(value.keyId)) continue;
		if (!(await writtenByAdmin(entry.identity))) continue;

		const current = await opened(value, privateKey);
		if (current) {
			found.set(current.keyId, current);
			underCurrent.add(current.keyId);
			continue;
		}
		if (found.has(value.keyId)) continue;

		for (const earlierKey of earlierPrivateKeys) {
			const earlier = await opened(value, earlierKey);
			if (earlier) {
				found.set(earlier.keyId, earlier);
				break;
			}
		}
	}

	return {
		keys: [...found.values()],
		onlyUnderEarlier: new Set([...found.keys()].filter((keyId) => !underCurrent.has(keyId)))
	};

	/** @param {string} identityHash */
	async function writtenByAdmin(identityHash) {
		if (typeof identityHash !== 'string') return false;
		const known = byAdmin.get(identityHash);
		if (known !== undefined) return known;

		let isAdmin = false;
		try {
			const identity = await identities?.getIdentity?.(identityHash);
			isAdmin = typeof identity?.id === 'string' && admins.has(identity.id);
		} catch {
			// Not resolvable now. Not believed, and asked again next time.
			return false;
		}
		byAdmin.set(identityHash, isAdmin);
		return isAdmin;
	}
}

/**
 * The key inside one copy, when it opens under this private key and is what
 * its admin said it is.
 *
 * @param {any} value the copy, as stored
 * @param {CryptoKey} privateKey
 * @returns {Promise<import('./keyring.js').EpochKey | null>}
 */
async function opened(value, privateKey) {
	try {
		const key = await epochKey(await unwrapKey(value, privateKey), value.epoch);
		// The id is part of what the admin signed, and it has to be the id of
		// what was inside — otherwise entries tagged with it would be looked up
		// under a key that does not open them.
		return key.keyId === value.keyId ? key : null;
	} catch {
		// Sealed for somebody else, or altered. Both look the same from here,
		// and both mean: not this one.
		return null;
	}
}

/**
 * Start a new epoch: a fresh key, sealed for everyone who keeps access.
 *
 * What makes removing a reader mean something (#120). The removed DID is
 * simply not among the recipients, so it holds every key up to here and none
 * from here on. Entries written before stay readable to it — they were
 * replicated under keys it has, and nothing can take those back.
 *
 * The owner's own copy is written first, and the keyring only learns the key
 * once that worked: a key nobody but this tab holds would seal entries that
 * the owner's other devices could never open.
 *
 * @param {any} orbitdb
 * @param {{ directory: any, store: any }} databases
 * @param {{ listAddress: string, keyring: import('./keyring.js').Keyring, recipients: string[], own: { did: string, publicKey: string } }} what
 * @returns {Promise<{ key: import('./keyring.js').EpochKey, results: { did: string, shared: boolean, reason?: string }[] }>}
 */
export async function rotateKey(orbitdb, databases, { listAddress, keyring, recipients, own }) {
	const next = await epochKey(newKey(), keyring.nextEpoch());

	await shareKeyWith(orbitdb, databases, {
		listAddress,
		recipientDid: own.did,
		keys: [next],
		recipientPublicKey: own.publicKey
	});
	keyring.add(next);

	const results = [];
	for (const did of recipients) {
		if (did === own.did) continue;
		results.push({
			did,
			...(await shareKeyWith(orbitdb, databases, { listAddress, recipientDid: did, keys: [next] }))
		});
	}

	return { key: next, results };
}
