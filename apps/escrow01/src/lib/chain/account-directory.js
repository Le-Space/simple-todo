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
 *
 * The same database carries a second entry, the public half of the DID's
 * X25519 key for sealed lists (#127, `list-key-agreement`). An owner looks it
 * up to wrap a list key for a reader (sealed/key-agreement.js), and the
 * directory's controller is what makes the key the reader's own: nobody else
 * can publish one under his DID, so nobody can slip the owner a key of their
 * own to wrap for. Sealed lists exist in every build, so this entry is
 * published and read outside Zama mode too; only the account entry is
 * Sepolia's. It reaches a newcomer the way the account does.
 */

import { IPFSAccessController } from '@orbitdb/core';
import { getAddress, isAddress } from 'viem';
import { createNewcomerAnswers } from '../newcomers.js';
import {
	LIST_KEY_AGREEMENT_INFO,
	publicKeyFromText,
	publicKeyToText
} from '../sealed/key-agreement.js';

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
const AGREEMENT_KEY_ENTRY = 'list-key-agreement';

/** While a lookup waits, the reader joins the directory's topic again, which the owner answers. */
const ASK_AGAIN_AFTER_MS = [4_000, 10_000];

/**
 * @typedef {{ address: `0x${string}`, chainId: number, publishedAt: string }} PublishedAccount
 */

/**
 * @typedef {{ publicKey: Uint8Array, publishedAt: string }} PublishedAgreementKey
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

	// The owner's browser answers every newcomer to its directory, and a reader
	// asks again while it waits (../newcomers.js, measured in #164).
	const newcomers = createNewcomerAnswers(() => getOrbitdb()?.ipfs?.libp2p?.services?.pubsub);
	const serve = newcomers.serve;
	const askAgain = newcomers.askAgain;

	/**
	 * What `read` finds, now or once an update brings it, within `timeoutMs`,
	 * asking the owner again while it waits.
	 *
	 * @template T
	 * @param {any} database
	 * @param {() => Promise<T | null>} read
	 * @param {number} timeoutMs
	 * @returns {Promise<T | null>}
	 */
	async function waitForEntry(database, read, timeoutMs) {
		const found = await read();
		if (found || timeoutMs <= 0) return found;

		return new Promise((resolve) => {
			let settled = false;
			/** @param {T | null} value */
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

	/**
	 * Put `value` under `key` unless `same` says it is there already, and
	 * answer the peers on the topic, as `publish` does for the account.
	 *
	 * @param {string} did
	 * @param {string} key
	 * @param {() => any} value builds the entry, only when it is written
	 * @param {(current: any) => boolean} same
	 */
	async function putAndAnswer(did, key, value, same) {
		const database = await open(did);
		const answer = serve(database);
		if (!same(await database.get(key))) await database.put(key, value());
		newcomers.answerThoseThere(database, answer);
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
			await putAndAnswer(
				did,
				ENTRY_KEY,
				() => ({ address: getAddress(address), chainId, publishedAt: new Date().toISOString() }),
				(value) => parsePublished(value, chainId)?.address === getAddress(address)
			);
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
			return waitForEntry(
				database,
				async () => parsePublished(await database.get(ENTRY_KEY), chainId),
				timeoutMs
			);
		},

		/**
		 * Publish this session's public X25519 key for sealed lists. Only its own
		 * DID can, as for the account, and the directory answers newcomers with
		 * it the same way.
		 *
		 * @param {string} did
		 * @param {Uint8Array} publicKey 32 bytes (`AgreementKey.publicKey`)
		 */
		async publishAgreementKey(did, publicKey) {
			if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
				throw new TypeError('An X25519 public key is 32 bytes.');
			}
			const text = publicKeyToText(publicKey);
			await putAndAnswer(
				did,
				AGREEMENT_KEY_ENTRY,
				() => ({
					publicKey: text,
					info: LIST_KEY_AGREEMENT_INFO,
					publishedAt: new Date().toISOString()
				}),
				(value) => {
					const current = parsePublishedAgreementKey(value);
					return current !== null && publicKeyToText(current.publicKey) === text;
				}
			);
		},

		/**
		 * The public X25519 key `did` published, waiting up to `timeoutMs` for it
		 * to replicate.
		 *
		 * @param {string} did
		 * @param {{ timeoutMs?: number }} [options]
		 * @returns {Promise<PublishedAgreementKey | null>}
		 */
		async lookupAgreementKey(did, { timeoutMs = 20_000 } = {}) {
			const database = await open(did);
			const found = await waitForEntry(
				database,
				async () => parsePublishedAgreementKey(await database.get(AGREEMENT_KEY_ENTRY)),
				timeoutMs
			);
			if (!found && timeoutMs > 0) {
				// Tells "nothing arrived" from "arrived and could not be joined",
				// which is a LoadBlockFailedError beside it (#127).
				const held = (await database.log.values().catch(() => [])).length;
				console.warn(
					`No key agreement key for ${did.slice(0, 20)}… after ${timeoutMs} ms; entries of that directory here: ${held}`
				);
			}
			return found;
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

/**
 * A published X25519 key, or null for anything malformed or derived under
 * another info (a later version of the key).
 *
 * @param {any} value
 * @returns {PublishedAgreementKey | null}
 */
export function parsePublishedAgreementKey(value) {
	if (!value || typeof value !== 'object' || value.info !== LIST_KEY_AGREEMENT_INFO) return null;
	const publicKey = publicKeyFromText(value.publicKey);
	if (!publicKey) return null;
	return {
		publicKey,
		publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : ''
	};
}
