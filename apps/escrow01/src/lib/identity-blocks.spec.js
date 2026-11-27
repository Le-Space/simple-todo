import { describe, expect, it } from 'vitest';
import { Identities, KeyStore, MemoryStorage } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import { base58btc } from 'multiformats/bases/base58';
import {
	fileIdentityBlock,
	IDENTITY_BLOCKS_TOPIC,
	MAX_IDENTITY_BLOCK_BYTES,
	offerIdentityBlocks,
	receiveIdentityBlocks
} from './identity-blocks.js';

/** A blockstore in memory, keyed by CID string. */
function memoryBlockstore() {
	/** @type {Map<string, Uint8Array>} */
	const blocks = new Map();
	return {
		blocks,
		has: async (/** @type {any} */ cid) => blocks.has(cid.toString()),
		put: async (/** @type {any} */ cid, /** @type {Uint8Array} */ bytes) => {
			blocks.set(cid.toString(), bytes);
		}
	};
}

async function identityOf(/** @type {string} */ id) {
	const identities = await Identities({
		keystore: await KeyStore({ storage: await MemoryStorage() })
	});
	return identities.createIdentity({ id });
}

describe('identity documents that travel with an answer', () => {
	it('are filed under the hash OrbitDB fetches them by', async () => {
		const identity = await identityOf('alice');
		const blockstore = memoryBlockstore();

		const cid = await fileIdentityBlock(blockstore, identity.bytes);

		expect(cid?.toString(base58btc)).toBe(identity.hash);
		expect(blockstore.blocks.get(String(cid))).toEqual(identity.bytes);
	});

	it('are the only thing filed: no other block, nothing malformed, nothing oversized', async () => {
		const blockstore = memoryBlockstore();
		const entryLike = dagCbor.encode({ id: '/orbitdb/zdpu', payload: { op: 'PUT' }, v: 2 });
		const oversized = dagCbor.encode({
			id: 'did:key:z',
			publicKey: 'x'.repeat(MAX_IDENTITY_BLOCK_BYTES),
			signatures: { id: 's', publicKey: 's' },
			type: 'webauthn'
		});

		await expect(fileIdentityBlock(blockstore, entryLike)).resolves.toBeNull();
		await expect(fileIdentityBlock(blockstore, oversized)).resolves.toBeNull();
		await expect(fileIdentityBlock(blockstore, new Uint8Array([0xff, 0x00]))).resolves.toBeNull();
		await expect(
			fileIdentityBlock(blockstore, /** @type {any} */ ('not bytes'))
		).resolves.toBeNull();
		expect(blockstore.blocks.size).toBe(0);
	});

	it('are heard on their own topic only, and no longer once the session stops', async () => {
		const identity = await identityOf('bob');
		const blockstore = memoryBlockstore();
		const pubsub = Object.assign(new EventTarget(), {
			subscribed: /** @type {string[]} */ ([]),
			subscribe(/** @type {string} */ topic) {
				this.subscribed.push(topic);
			},
			unsubscribe(/** @type {string} */ topic) {
				this.subscribed = this.subscribed.filter((known) => known !== topic);
			}
		});
		const deliver = (/** @type {string} */ topic) =>
			pubsub.dispatchEvent(new CustomEvent('message', { detail: { topic, data: identity.bytes } }));

		const stop = receiveIdentityBlocks({ pubsub, blockstore });
		expect(pubsub.subscribed).toEqual([IDENTITY_BLOCKS_TOPIC]);

		deliver('/orbitdb/zdpuSomeDatabase');
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(blockstore.blocks.size).toBe(0);

		deliver(IDENTITY_BLOCKS_TOPIC);
		await expect.poll(() => blockstore.blocks.size).toBe(1);

		stop();
		blockstore.blocks.clear();
		deliver(IDENTITY_BLOCKS_TOPIC);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(blockstore.blocks.size).toBe(0);
		expect(pubsub.subscribed).toEqual([]);
	});

	it('are offered on their topic, and nobody listening is not an error', async () => {
		/** @type {Array<[string, Uint8Array]>} */
		const published = [];
		const pubsub = {
			publish: async (/** @type {string} */ topic, /** @type {Uint8Array} */ bytes) => {
				published.push([topic, bytes]);
				if (published.length === 2) throw new Error('NoPeersSubscribedToTopic');
			}
		};
		const one = new Uint8Array([1]);
		const two = new Uint8Array([2]);
		const three = new Uint8Array([3]);

		await expect(offerIdentityBlocks(pubsub, [one, two, three])).resolves.toBeUndefined();
		expect(published).toEqual([
			[IDENTITY_BLOCKS_TOPIC, one],
			[IDENTITY_BLOCKS_TOPIC, two],
			[IDENTITY_BLOCKS_TOPIC, three]
		]);
	});
});
