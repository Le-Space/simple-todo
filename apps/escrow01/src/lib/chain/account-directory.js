/**
 * Which account belongs to a DID (escrow01).
 *
 * Alice delegates a todo to Bob's DID; the escrow pays an address. Nothing
 * derives one from the other: Bob's account is a random key's address that
 * his passkey took over. So every passkey publishes its account in a small
 * OrbitDB database of its own, and Alice's app looks it up there before a
 * lock.
 *
 * The database is keyed to the DID through its access controller: write
 * `[did]`. Its address follows from its name and that controller, so anyone
 * can open Bob's without being told where it is, and OrbitDB accepts only
 * entries Bob's identity signed. That is what makes an entry Bob's claim.
 *
 * It is not enough on its own, and the caller checks the chain as well: an
 * account whose passkey is registered in Calibur (`isPasskeyAccount` in
 * sepolia-chain.js). Registering a public key needs no private key, so a stranger
 * could register Bob's key in their own account — but they cannot publish
 * that account under Bob's DID.
 *
 * How the entry reaches Alice. Bob writes it once, usually long before Alice
 * looks, so it is never a live update for her. OrbitDB hands an existing entry
 * to a newcomer only in its join-time heads exchange, and that does not reach
 * her when the two browsers first meet over the relay's circuit: the protocol
 * is refused on a limited connection and never tried again, not even once a
 * direct one is up (AGENTS.md). Measured on 2026-11-26: no entry in 60 s,
 * with WebRTC between the two for most of it. The relay may hold the
 * directory, but only when its queue gets to the topic in time, which it did
 * in some runs and not in others. So Bob's browser answers every newcomer
 * itself, over gossipsub, which does cross a circuit (`serve`), and sends
 * the identity document along: OrbitDB fetches that by bitswap, which a
 * circuit does not carry either, and without it the entry is refused
 * (`listenForIdentities`). With both, the entry arrived in 0.35 s over a
 * circuit alone.
 */

import { IPFSAccessController } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { getAddress, isAddress } from 'viem';

/**
 * v2 since provider 0.14.0. Readers refuse identity proofs in the first format
 * (`acceptLegacyProofs: false`, GHSA-7j39-c465-x35x), and OrbitDB checks every
 * entry from a head back, so a v1 directory written before the switch does not
 * open on a fresh reader at all, and rewriting the entry in it does not help:
 * the new one builds on the old. Every owner publishes its account again on its
 * next start (`publishOnce` in budget-service-zama.js), into the fresh v2 log.
 */
export const ACCOUNT_DIRECTORY_NAME = 'simple-todo-escrow01-account-v2';
const ENTRY_KEY = 'account';

/** The owner answers a newcomer twice: at once, and again in case gossipsub had no stream to it yet. */
const ANSWER_AGAIN_AFTER_MS = 3_000;
/** Joins that come closer together than this get one answer. */
const MIN_ANSWER_INTERVAL_MS = 1_000;
/** The identity first, so it is there when OrbitDB checks the entry. */
const HEADS_AFTER_IDENTITY_MS = 300;
/** While a lookup waits, the reader joins the identity topic again, which the owner answers. */
const ASK_AGAIN_AFTER_MS = [4_000, 10_000];
/** An identity document is a few hundred bytes; anything far larger is not one. */
const MAX_IDENTITY_BYTES = 8 * 1024;
/** Documents taken per DID and session: a passkey has one, a few sessions at most. */
const MAX_IDENTITIES_PER_DID = 8;

/**
 * Where the owner of `did` sends its identity document. Named after the DID,
 * so a reader joins it before the directory's own topic; not under
 * `/orbitdb/`, which a relay takes for a database to sync.
 *
 * @param {string} did
 */
export const identityTopicOf = (did) => `/simple-todo/escrow01/account-identity/${did}`;

/**
 * @typedef {{ address: `0x${string}`, chainId: number, publishedAt: string }} PublishedAccount
 */

/**
 * @param {() => any} getOrbitdb the session's OrbitDB instance
 */
export function createAccountDirectory(getOrbitdb) {
	/** @type {Map<string, Promise<any>>} */
	const opened = new Map();

	/** @param {string} did */
	function open(did) {
		const orbitdb = getOrbitdb();
		if (!orbitdb) throw new Error('OrbitDB is not running.');
		const key = `${orbitdb.identity.id}\n${did}`;
		const known = opened.get(key);
		if (known) return known;
		const database = orbitdb.open(ACCOUNT_DIRECTORY_NAME, {
			type: 'keyvalue',
			AccessController: IPFSAccessController({ write: [did] })
		});
		database.catch(() => opened.delete(key));
		opened.set(key, database);
		return database;
	}

	/** Directories this session answers for, by database address. @type {Set<string>} */
	const serving = new Set();

	/**
	 * Answer every peer that joins the directory, from the browser that owns it:
	 * the identity document on its own topic, then the heads on the directory's,
	 * as `Sync.add()` publishes a new entry. Over gossipsub both cross a circuit.
	 * A peer that has the entry already drops it again in its log.
	 *
	 * @param {string} did
	 * @param {any} database
	 */
	function serve(did, database) {
		const topic = String(database.address);
		const pubsub = getOrbitdb()?.ipfs?.libp2p?.services?.pubsub;
		if (!pubsub || serving.has(topic)) return;
		serving.add(topic);
		const identityTopic = identityTopicOf(did);

		const answer = async () => {
			const heads = await database.log.heads();
			const identities = getOrbitdb()?.identities;
			for (const head of heads) {
				const identity = await identities?.getIdentity?.(head.identity);
				// Nobody on the topic: nobody to tell.
				if (identity?.bytes) await pubsub.publish(identityTopic, identity.bytes).catch(() => {});
			}
			await new Promise((resolve) => setTimeout(resolve, HEADS_AFTER_IDENTITY_MS));
			for (const head of heads) {
				const bytes = await database.log.storage.get(head.hash);
				if (bytes) await pubsub.publish(topic, bytes).catch(() => {});
			}
		};
		let answeredAt = 0;
		/** @param {any} event */
		const onSubscriptionChange = (event) => {
			const joined = (event.detail?.subscriptions ?? []).some(
				(/** @type {any} */ subscription) =>
					subscription.subscribe &&
					(subscription.topic === topic || subscription.topic === identityTopic)
			);
			if (!joined || Date.now() - answeredAt < MIN_ANSWER_INTERVAL_MS) return;
			answeredAt = Date.now();
			void answer().catch(() => {});
			setTimeout(() => void answer().catch(() => {}), ANSWER_AGAIN_AFTER_MS);
		};
		pubsub.addEventListener('subscription-change', onSubscriptionChange);
		database.events.once('close', () => {
			pubsub.removeEventListener('subscription-change', onSubscriptionChange);
			serving.delete(topic);
		});
	}

	/**
	 * Identity topics listened on, per pubsub: a new identity starts a new
	 * libp2p node, which listens afresh.
	 *
	 * @type {WeakMap<object, Set<string>>}
	 */
	const listening = new WeakMap();
	/** @param {any} pubsub */
	const topicsOf = (pubsub) => {
		let topics = listening.get(pubsub);
		if (!topics) listening.set(pubsub, (topics = new Set()));
		return topics;
	};

	/**
	 * Take the owner's identity document from the owner, for a directory this
	 * session reads (`serve` sends it).
	 *
	 * Stored under the hash of its own bytes, which is all a content address
	 * promises, and only when it names `did`: whether it is a valid identity,
	 * and whether it may write, OrbitDB still checks as for any entry.
	 *
	 * @param {string} did
	 */
	function listenForIdentities(did) {
		const orbitdb = getOrbitdb();
		const pubsub = orbitdb?.ipfs?.libp2p?.services?.pubsub;
		const blockstore = orbitdb?.ipfs?.blockstore;
		const identityTopic = identityTopicOf(did);
		if (!pubsub || !blockstore || topicsOf(pubsub).has(identityTopic)) return;
		topicsOf(pubsub).add(identityTopic);
		let taken = 0;
		/** @param {any} event */
		const onMessage = (event) => {
			const { topic: received, data } = event.detail ?? {};
			if (received !== identityTopic || !(data instanceof Uint8Array)) return;
			if (data.length > MAX_IDENTITY_BYTES || taken >= MAX_IDENTITIES_PER_DID) return;
			void (async () => {
				/** @type {any} */
				const document = dagCbor.decode(data);
				if (document?.id !== did) return;
				const cid = CID.create(1, dagCbor.code, await sha256.digest(data));
				if (await blockstore.has(cid)) return;
				taken += 1;
				await blockstore.put(cid, data);
			})().catch(() => {});
		};
		pubsub.addEventListener('message', onMessage);
		pubsub.subscribe(identityTopic);
	}

	/**
	 * Join the identity topic again, which the owner answers with its entry.
	 *
	 * @param {string} did
	 */
	function askAgain(did) {
		const pubsub = getOrbitdb()?.ipfs?.libp2p?.services?.pubsub;
		const identityTopic = identityTopicOf(did);
		if (!pubsub || !topicsOf(pubsub).has(identityTopic)) return;
		pubsub.unsubscribe(identityTopic);
		pubsub.subscribe(identityTopic);
	}

	return {
		/**
		 * The directory database of `did`, as this directory opened it: for
		 * diagnostics and the E2E hook, which must not open the address a second
		 * time.
		 *
		 * @param {string} did
		 */
		database: (did) => open(did),

		/**
		 * Publish this session's account. Only its own DID can: OrbitDB refuses
		 * the entry otherwise. The directory stays open and answers peers that
		 * join it later (`serve`).
		 *
		 * @param {string} did
		 * @param {{ address: `0x${string}`, chainId: number }} account
		 */
		async publish(did, { address, chainId }) {
			const database = await open(did);
			serve(did, database);
			const current = parsePublished(await database.get(ENTRY_KEY), chainId);
			if (current && current.address === getAddress(address)) return;
			await database.put(ENTRY_KEY, {
				address: getAddress(address),
				chainId,
				publishedAt: new Date().toISOString()
			});
		},

		/**
		 * The account `did` published, waiting up to `timeoutMs` for it to
		 * replicate from another peer.
		 *
		 * @param {string} did
		 * @param {{ chainId: number, timeoutMs?: number }} options
		 * @returns {Promise<PublishedAccount | null>}
		 */
		async lookup(did, { chainId, timeoutMs = 20_000 }) {
			// Before the directory's own topic, so the owner's answer finds it.
			listenForIdentities(did);
			const database = await open(did);
			const read = async () => parsePublished(await database.get(ENTRY_KEY), chainId);
			const found = await read();
			if (found || timeoutMs <= 0) return found;

			return new Promise((resolve) => {
				let settled = false;
				/** @param {PublishedAccount | null} value */
				const finish = (value) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					for (const ask of asks) clearTimeout(ask);
					database.events.off('update', onUpdate);
					resolve(value);
				};
				const onUpdate = () => {
					void read().then((value) => value && finish(value));
				};
				const timer = setTimeout(() => void read().then(finish), timeoutMs);
				// The directory may have been open since before the owner was
				// reachable, and its answer went nowhere: ask again.
				const asks = ASK_AGAIN_AFTER_MS.filter((ms) => ms < timeoutMs).map((ms) =>
					setTimeout(() => settled || askAgain(did), ms)
				);
				database.events.on('update', onUpdate);
			});
		}
	};
}

/**
 * A published entry, or null for anything malformed or for another chain.
 *
 * @param {any} value
 * @param {number} chainId
 * @returns {PublishedAccount | null}
 */
export function parsePublished(value, chainId) {
	if (!value || typeof value !== 'object' || value.chainId !== chainId) return null;
	if (typeof value.address !== 'string' || !isAddress(value.address)) return null;
	return {
		address: getAddress(value.address),
		chainId,
		publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : ''
	};
}
