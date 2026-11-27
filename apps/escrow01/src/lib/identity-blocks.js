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
 */
import { CID } from 'multiformats/cid';
import * as dagCbor from '@ipld/dag-cbor';
import { sha256 } from 'multiformats/hashes/sha2';

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

/**
 * File one identity document in the blockstore, under the CID of its bytes.
 *
 * @param {{ has: (cid: CID) => Promise<boolean>, put: (cid: CID, bytes: Uint8Array) => Promise<unknown> }} blockstore
 * @param {Uint8Array} bytes
 * @returns {Promise<CID | null>} where it was filed; null for anything else
 */
export async function fileIdentityBlock(blockstore, bytes) {
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
	return cid;
}

/**
 * Listen for identity documents for this session.
 *
 * @param {{ pubsub: any, blockstore: any }} parts the session's gossipsub and Helia blockstore
 * @returns {() => void} stops listening
 */
export function receiveIdentityBlocks({ pubsub, blockstore }) {
	/** @param {any} event */
	const onMessage = (event) => {
		const { topic, data } = event?.detail ?? {};
		if (topic !== IDENTITY_BLOCKS_TOPIC) return;
		void fileIdentityBlock(blockstore, data).catch((error) =>
			console.warn('Could not file an identity document:', error)
		);
	};
	pubsub.addEventListener('message', onMessage);
	pubsub.subscribe(IDENTITY_BLOCKS_TOPIC);
	return () => {
		pubsub.removeEventListener('message', onMessage);
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
