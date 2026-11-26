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
 * itself, over gossipsub, which does cross a circuit (`serve`). OrbitDB then
 * fetches the signer's identity document by bitswap, which crosses the
 * circuit too since p2p.js turns on `runOnLimitedConnections`.
 */

import { IPFSAccessController } from '@orbitdb/core';
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
/** While a lookup waits, the reader joins the directory's topic again, which the owner answers. */
const ASK_AGAIN_AFTER_MS = [4_000, 10_000];

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

	/** How this session answers for a directory, by database address. @type {Map<string, () => void>} */
	const serving = new Map();

	/**
	 * Answer every peer that joins the directory, from the browser that owns it:
	 * its heads on the directory's topic, as `Sync.add()` publishes a new entry.
	 * A peer that has the entry already drops it again in its log.
	 *
	 * Peers on the topic before this browser started answering never join in
	 * its sight, a payer whose page was open before the owner's, say; `publish`
	 * answers them at once with what this returns.
	 *
	 * @param {any} database
	 * @returns {(() => void) | undefined}
	 */
	function serve(database) {
		const topic = String(database.address);
		const pubsub = getOrbitdb()?.ipfs?.libp2p?.services?.pubsub;
		if (!pubsub) return undefined;
		const known = serving.get(topic);
		if (known) return known;

		const announce = async () => {
			for (const head of await database.log.heads()) {
				const bytes = await database.log.storage.get(head.hash);
				// Nobody on the topic: nobody to tell.
				if (bytes) await pubsub.publish(topic, bytes).catch(() => {});
			}
		};
		let answeredAt = 0;
		const answer = () => {
			if (Date.now() - answeredAt < MIN_ANSWER_INTERVAL_MS) return;
			answeredAt = Date.now();
			void announce().catch(() => {});
			setTimeout(() => void announce().catch(() => {}), ANSWER_AGAIN_AFTER_MS);
		};
		/** @param {any} event */
		const onSubscriptionChange = (event) => {
			const joined = (event.detail?.subscriptions ?? []).some(
				(/** @type {any} */ subscription) => subscription.subscribe && subscription.topic === topic
			);
			if (joined) answer();
		};
		pubsub.addEventListener('subscription-change', onSubscriptionChange);
		database.events.once('close', () => {
			pubsub.removeEventListener('subscription-change', onSubscriptionChange);
			serving.delete(topic);
		});
		serving.set(topic, answer);
		return answer;
	}

	/**
	 * Join the directory's topic again, which its owner answers with the entry.
	 * Through gossipsub alone: OrbitDB's Sync keeps listening, and only the
	 * subscription is sent anew.
	 *
	 * @param {any} database
	 */
	function askAgain(database) {
		const topic = String(database.address);
		const pubsub = getOrbitdb()?.ipfs?.libp2p?.services?.pubsub;
		if (!pubsub) return;
		pubsub.unsubscribe(topic);
		pubsub.subscribe(topic);
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
			const answer = serve(database);
			const current = parsePublished(await database.get(ENTRY_KEY), chainId);
			if (!current || current.address !== getAddress(address)) {
				await database.put(ENTRY_KEY, {
					address: getAddress(address),
					chainId,
					publishedAt: new Date().toISOString()
				});
			}
			const pubsub = getOrbitdb()?.ipfs?.libp2p?.services?.pubsub;
			if (answer && (pubsub?.getSubscribers?.(String(database.address)) ?? []).length > 0) {
				answer();
			}
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
					setTimeout(() => settled || askAgain(database), ms)
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
