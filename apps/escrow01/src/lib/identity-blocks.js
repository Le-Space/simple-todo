/**
 * Identity documents travel with an answer, over gossipsub (#127).
 *
 * OrbitDB accepts an entry only once it holds the signer's identity document,
 * which it fetches by CID through bitswap. Measured in the long local suite
 * (27.11.2026): an owner's browser received a delegate's directory entry over
 * gossipsub and refused it every time, because the delegate's identity
 * document did not arrive within OrbitDB's 30 s -- although the two browsers
 * held a direct WebRTC connection. Every block that failed to load on the
 * owner's side was a delegate's identity document. The relay could not supply
 * it either: it had not synced the delegate's directory yet.
 *
 * So an answer to a newcomer (./newcomers.js) carries the identity documents
 * of the database's writers, on one topic every session listens on, and a
 * session files each document it hears in its blockstore under the CID of its
 * own bytes. OrbitDB's `getIdentity` then finds it there. Nothing is trusted
 * that a bitswap fetch would not have been: a block is filed under the hash of
 * its bytes, and OrbitDB verifies the identity and the entry exactly as
 * before. Identity documents are public; every entry names its signer's.
 *
 * Order is not guaranteed: an entry may be checked before its signer's
 * document is filed, and OrbitDB's fetch then waits out its 30 s, with the
 * database's queue behind it. So `getIdentity` also listens for a carried
 * document (`withCarriedIdentityDocuments`). And each session offers its own
 * document to every peer that joins the topic, so a peer often has it before
 * the first entry it signed.
 */
import { CID } from 'multiformats/cid';
import * as dagCbor from '@ipld/dag-cbor';
import { sha256 } from 'multiformats/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';

export const IDENTITY_BLOCKS_TOPIC = 'simple-todo/escrow01/identity-blocks/v1';

/** A document from this app's provider is well under 2 KiB; anything far larger is not one. */
export const MAX_IDENTITY_BLOCK_BYTES = 8 * 1024;

/**
 * The shape OrbitDB encodes an identity document in (`_encodeIdentity` in
 * `@orbitdb/core/src/identities/identity.js`).
 *
 * @param {unknown} value
 */
export function isIdentityDocument(value) {
	if (!value || typeof value !== 'object') return false;
	const { id, publicKey, signatures, type } = /** @type {Record<string, any>} */ (value);
	return (
		typeof id === 'string' &&
		id.length > 0 &&
		typeof publicKey === 'string' &&
		publicKey.length > 0 &&
		typeof type === 'string' &&
		typeof signatures?.id === 'string' &&
		typeof signatures?.publicKey === 'string'
	);
}

/** Joins of the topic closer together than this get one offer of this session's document. */
export const MIN_OFFER_INTERVAL_MS = 1_000;

/**
 * Who is waiting for which identity document, by OrbitDB's hash of it.
 *
 * @typedef {{ arrived: (hash: string) => void, whenArrives: (hash: string) => { promise: Promise<void>, cancel: () => void } }} CarriedDocuments
 * @returns {CarriedDocuments}
 */
export function createCarriedDocuments() {
	/** @type {Map<string, Set<() => void>>} */
	const waiting = new Map();
	return {
		arrived(hash) {
			const wakes = waiting.get(hash);
			waiting.delete(hash);
			for (const wake of wakes ?? []) wake();
		},
		whenArrives(hash) {
			/** @type {() => void} */
			let wake = () => {};
			const promise = new Promise((resolve) => {
				wake = () => resolve(undefined);
			});
			const wakes = waiting.get(hash) ?? new Set();
			wakes.add(wake);
			waiting.set(hash, wakes);
			return {
				promise: /** @type {Promise<void>} */ (promise),
				cancel() {
					wakes.delete(wake);
					if (wakes.size === 0 && waiting.get(hash) === wakes) waiting.delete(hash);
				}
			};
		}
	};
}

/**
 * Let OrbitDB's `getIdentity` take a document that is carried in while it
 * fetches: the fetch then asks the blockstore again, where it now is. The
 * first fetch runs on and is let go.
 *
 * @template {{ getIdentity: (hash: string) => Promise<any> }} T
 * @param {T} identities
 * @param {CarriedDocuments} carried
 * @returns {T}
 */
export function withCarriedIdentityDocuments(identities, carried) {
	const fetch = identities.getIdentity;
	identities.getIdentity = async (hash) => {
		const arrival = carried.whenArrives(hash);
		const fetching = fetch(hash);
		fetching.catch(() => {});
		try {
			return await Promise.race([fetching, arrival.promise.then(() => fetch(hash))]);
		} finally {
			arrival.cancel();
		}
	};
	return identities;
}

/**
 * File one identity document in the blockstore, under the CID of its bytes.
 *
 * @param {{ has: (cid: CID) => Promise<boolean>, put: (cid: CID, bytes: Uint8Array) => Promise<unknown> }} blockstore
 * @param {Uint8Array} bytes
 * @param {CarriedDocuments} [carried] told of the arrival
 * @returns {Promise<CID | null>} where it was filed; null for anything else
 */
export async function fileIdentityBlock(blockstore, bytes, carried) {
	if (!(bytes instanceof Uint8Array) || bytes.length > MAX_IDENTITY_BLOCK_BYTES) return null;
	let value;
	try {
		value = dagCbor.decode(bytes);
	} catch {
		return null;
	}
	if (!isIdentityDocument(value)) return null;
	const cid = CID.create(1, dagCbor.code, await sha256.digest(bytes));
	if (!(await blockstore.has(cid))) await blockstore.put(cid, bytes);
	carried?.arrived(cid.toString(base58btc));
	return cid;
}

/**
 * Listen for identity documents for this session, and offer its own to every
 * peer that joins the topic.
 *
 * @param {{
 *   pubsub: any,
 *   blockstore: any,
 *   carried?: CarriedDocuments,
 *   ownDocument?: () => Uint8Array | null | undefined
 * }} parts the session's gossipsub and Helia blockstore; who waits for a
 *   document; this session's own
 * @returns {() => void} stops listening
 */
export function receiveIdentityBlocks({ pubsub, blockstore, carried, ownDocument = () => null }) {
	/** @param {any} event */
	const onMessage = (event) => {
		const { topic, data } = event?.detail ?? {};
		if (topic !== IDENTITY_BLOCKS_TOPIC) return;
		void fileIdentityBlock(blockstore, data, carried).catch((error) =>
			console.warn('Could not file an identity document:', error)
		);
	};
	let offeredAt = 0;
	const offer = () => {
		const own = ownDocument();
		if (!own || Date.now() - offeredAt < MIN_OFFER_INTERVAL_MS) return;
		offeredAt = Date.now();
		void offerIdentityBlocks(pubsub, [own]);
	};
	/** @param {any} event */
	const onSubscriptionChange = (event) => {
		const joined = (event?.detail?.subscriptions ?? []).some(
			(/** @type {any} */ subscription) =>
				subscription.subscribe && subscription.topic === IDENTITY_BLOCKS_TOPIC
		);
		if (joined) offer();
	};
	pubsub.addEventListener('message', onMessage);
	pubsub.addEventListener('subscription-change', onSubscriptionChange);
	pubsub.subscribe(IDENTITY_BLOCKS_TOPIC);
	if ((pubsub.getSubscribers?.(IDENTITY_BLOCKS_TOPIC) ?? []).length > 0) offer();
	return () => {
		pubsub.removeEventListener('message', onMessage);
		pubsub.removeEventListener('subscription-change', onSubscriptionChange);
		try {
			pubsub.unsubscribe(IDENTITY_BLOCKS_TOPIC);
		} catch {
			// Already stopped with the node.
		}
	};
}

/**
 * Publish identity documents, for the peers that are about to receive entries
 * they signed. Nobody listening is not an error.
 *
 * @param {any} pubsub
 * @param {Uint8Array[]} documents
 */
export async function offerIdentityBlocks(pubsub, documents) {
	for (const bytes of documents) {
		await pubsub.publish(IDENTITY_BLOCKS_TOPIC, bytes).catch(() => {});
	}
}
