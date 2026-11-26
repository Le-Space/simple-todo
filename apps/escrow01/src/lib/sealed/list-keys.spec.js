import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import { createLibp2p } from 'libp2p';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@libp2p/gossipsub';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import * as json from 'multiformats/codecs/json';
import { sha512 } from 'multiformats/hashes/sha2';
import { createOrbitDB } from '@orbitdb/core';
import { createMemoryIdentities } from '@simple-todo/todo/memory-identities.js';
import { setPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
import { wrapInstance } from '../instance-wrappers.js';
import { agreementKeyFromPrf } from './key-agreement.js';
import { LIST_SCOPE } from './key-ring.js';
import { createListKeys, openListKeys } from './list-keys.js';
import { openRecords, sealForList } from './sealed-list.js';

const LIST = '/orbitdb/zdpuAuK3BHpS7NvMBivynypqciYCuy2UW77XYBPUYRnLjnw13';
const BOB = 'did:key:zDnaeBobExample';

/** @type {any[]} */
let running = [];

async function orbitdbInMemory() {
	const libp2p = await createLibp2p({
		services: { identify: identify(), pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) }
	});
	const ipfs = await withLibp2p(
		createHeliaLight({ codecs: [dagCbor, dagJson, json], hashers: [sha512] }),
		libp2p
	).start();
	// @ts-expect-error `identities` is documented; the bundled declaration omits it (see p2p.js)
	const orbitdb = wrapInstance(await createOrbitDB({ ipfs, identities: await createMemoryIdentities(ipfs) }));
	running.push(orbitdb, ipfs);
	return orbitdb;
}

const keyFor = (/** @type {number} */ fill) => agreementKeyFromPrf(new Uint8Array(32).fill(fill));

/** Resolves on the next `onChange`. @param {import('./list-keys.js').ListKeys} keys */
const nextChange = (keys) => new Promise((resolve) => keys.onChange(() => resolve(undefined)));

describe('the keys of one sealed list', () => {
	beforeEach(() => setPersistentStorageEnabled(false));

	afterEach(async () => {
		for (const node of running.splice(0)) await node.stop?.();
	});

	it('are made by the creator, who reads her list again on her next visit', async () => {
		const orbitdb = await orbitdbInMemory();
		const own = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const created = await createListKeys(orbitdb, {
			listAddress: LIST,
			own,
			lookupPublicKey: async () => null
		});
		expect(created.canSeal()).toBe(true);
		expect(created.ring.epochs(LIST_SCOPE)).toEqual([0]);

		const record = { key: 'todo-1', value: await sealForList(created.ring, 'todo-1', { text: 'Pay rent' }) };
		// The next visit derives the same X25519 key from the same passkey.
		const nextVisit = await openListKeys(orbitdb, {
			listAddress: LIST,
			ownerDid: own.did,
			own: { did: own.did, agreementKey: await keyFor(1) },
			lookupPublicKey: async () => null
		});

		expect(nextVisit.canSeal()).toBe(true);
		await expect(openRecords([record], nextVisit.ring)).resolves.toMatchObject({
			records: [{ key: 'todo-1', value: { text: 'Pay rent' } }],
			hidden: 0
		});
	});

	it('reach a reader once the owner grants him, while his list is open', async () => {
		const orbitdb = await orbitdbInMemory();
		const owner = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const bob = { did: BOB, agreementKey: await keyFor(2) };
		const ownersKeys = await createListKeys(orbitdb, {
			listAddress: LIST,
			own: owner,
			lookupPublicKey: async (did) => (did === BOB ? bob.agreementKey.publicKey : null)
		});
		const record = { key: 'todo-1', value: await sealForList(ownersKeys.ring, 'todo-1', { text: 'Pay rent' }) };

		const bobsKeys = await openListKeys(orbitdb, {
			listAddress: LIST,
			ownerDid: owner.did,
			own: bob,
			lookupPublicKey: async () => null
		});
		expect(bobsKeys.canSeal()).toBe(false);
		await expect(openRecords([record], bobsKeys.ring)).resolves.toMatchObject({ records: [], hidden: 1 });

		const arrived = nextChange(bobsKeys);
		await expect(ownersKeys.grant(BOB)).resolves.toBe('granted');
		await arrived;

		expect(bobsKeys.canSeal()).toBe(true);
		await expect(openRecords([record], bobsKeys.ring)).resolves.toMatchObject({
			records: [{ key: 'todo-1', value: { text: 'Pay rent' } }],
			hidden: 0
		});
	});

	it('are not handed to a reader who published no key', async () => {
		const orbitdb = await orbitdbInMemory();
		const owner = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const keys = await createListKeys(orbitdb, {
			listAddress: LIST,
			own: owner,
			lookupPublicKey: async () => null
		});

		await expect(keys.grant(BOB)).resolves.toBe('no-public-key');
	});

	it('are handed out by the owner only', async () => {
		const orbitdb = await orbitdbInMemory();
		const owner = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		await createListKeys(orbitdb, { listAddress: LIST, own: owner, lookupPublicKey: async () => null });
		const bobsKeys = await openListKeys(orbitdb, {
			listAddress: LIST,
			ownerDid: owner.did,
			own: { did: BOB, agreementKey: await keyFor(2) },
			lookupPublicKey: async () => new Uint8Array(32).fill(7)
		});

		await expect(bobsKeys.grant('did:key:zDnaeCarolExample')).rejects.toThrow(/owner/);
	});

	it('are forgotten on close', async () => {
		const orbitdb = await orbitdbInMemory();
		const own = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const keys = await createListKeys(orbitdb, { listAddress: LIST, own, lookupPublicKey: async () => null });
		await keys.close();

		expect(keys.canSeal()).toBe(false);
	});
});
