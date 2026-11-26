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
import { createKeyRing, LIST_SCOPE, newEpochKey, taskScope } from './key-ring.js';
import {
	grantListKeys,
	keyStoreName,
	listSlot,
	loadOwnKeys,
	openKeyStore,
	parseSlot,
	putListKeyCopy,
	taskSlot
} from './key-store.js';

const LIST = '/orbitdb/zdpuAuK3BHpS7NvMBivynypqciYCuy2UW77XYBPUYRnLjnw13';
const BOB = 'did:key:zDnaeBobExample';
const MALLORY = 'did:key:zDnaeMalloryExample';

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
	// `identities` is documented; the bundled declaration omits it (see p2p.js).
	const options = /** @type {any} */ ({ ipfs, identities: await createMemoryIdentities(ipfs) });
	const orbitdb = wrapInstance(await createOrbitDB(options));
	running.push(orbitdb, ipfs);
	return orbitdb;
}

const key = (/** @type {number} */ fill) => agreementKeyFromPrf(new Uint8Array(32).fill(fill));

describe('the key store’s names', () => {
	it('follows from the list’s address', () => {
		expect(keyStoreName(LIST)).toBe(
			'simple-todo-escrow01-keys-v1:zdpuAuK3BHpS7NvMBivynypqciYCuy2UW77XYBPUYRnLjnw13'
		);
		for (const notAnAddress of ['', 'private-todos', '/orbitdb/', '/orbitdb/a/b', null]) {
			expect(() => keyStoreName(/** @type {any} */ (notAnAddress))).toThrow(TypeError);
		}
	});

	it('reads back what each slot names, and nothing else', () => {
		expect(parseSlot(listSlot(0, BOB))).toEqual({ scopeId: LIST_SCOPE, epoch: 0, did: BOB });
		expect(parseSlot(taskSlot('todo-1', 3, BOB))).toEqual({
			scopeId: taskScope('todo-1'),
			epoch: 3,
			did: BOB
		});
		for (const other of [
			'meta/name',
			'list/x/' + BOB,
			'list/01/' + BOB,
			'list/0/',
			'task/t/0',
			42
		]) {
			expect(parseSlot(other)).toBeNull();
		}
		expect(() => listSlot(0, 'did:with/slash')).toThrow(TypeError);
		expect(() => taskSlot('a/b', 0, BOB)).toThrow(TypeError);
	});
});

describe('the key store', () => {
	beforeEach(() => setPersistentStorageEnabled(false));

	afterEach(async () => {
		for (const node of running.splice(0)) await node.stop?.();
	});

	it('gives each reader the key, and only his own', async () => {
		const owner = await orbitdbInMemory();
		const ownerDid = owner.identity.id;
		const store = await openKeyStore(owner, { listAddress: LIST, ownerDid });
		const [aliceKey, bobKey, malloryKey] = [await key(1), await key(2), await key(3)];

		const ownerRing = createKeyRing();
		ownerRing.add(LIST_SCOPE, 0, newEpochKey());
		await grantListKeys(store, ownerRing, { did: ownerDid, publicKey: aliceKey.publicKey });
		await grantListKeys(store, ownerRing, { did: BOB, publicKey: bobKey.publicKey });

		const aliceElsewhere = createKeyRing();
		const bobs = createKeyRing();
		const mallorys = createKeyRing();
		await expect(
			loadOwnKeys(store, aliceElsewhere, { did: ownerDid, agreementKey: aliceKey })
		).resolves.toEqual({
			added: [listSlot(0, ownerDid)],
			failed: []
		});
		await expect(loadOwnKeys(store, bobs, { did: BOB, agreementKey: bobKey })).resolves.toEqual({
			added: [listSlot(0, BOB)],
			failed: []
		});
		await expect(
			loadOwnKeys(store, mallorys, { did: MALLORY, agreementKey: malloryKey })
		).resolves.toEqual({
			added: [],
			failed: []
		});

		expect(aliceElsewhere.raw(LIST_SCOPE, 0)).toEqual(ownerRing.raw(LIST_SCOPE, 0));
		expect(bobs.raw(LIST_SCOPE, 0)).toEqual(ownerRing.raw(LIST_SCOPE, 0));
		expect(mallorys.epochs(LIST_SCOPE)).toEqual([]);

		// Claiming Bob's DID does not open Bob's copy.
		await expect(
			loadOwnKeys(store, mallorys, { did: BOB, agreementKey: malloryKey })
		).resolves.toEqual({
			added: [],
			failed: [{ slot: listSlot(0, BOB), reason: 'unwrap' }]
		});
	});

	it('takes copies from the owner only', async () => {
		const owner = await orbitdbInMemory();
		const mallory = await orbitdbInMemory();
		const ownerDid = owner.identity.id;
		const ownersStore = await openKeyStore(owner, { listAddress: LIST, ownerDid });
		const mallorysView = await openKeyStore(mallory, { listAddress: LIST, ownerDid });

		expect(mallorysView.address.toString()).toBe(ownersStore.address.toString());
		await expect(
			putListKeyCopy(mallorysView, {
				epoch: 0,
				key: newEpochKey(),
				recipient: { did: BOB, publicKey: (await key(3)).publicKey }
			})
		).rejects.toThrow(/not allowed to write/i);
	});

	it('hands a new reader every epoch there is', async () => {
		const owner = await orbitdbInMemory();
		const store = await openKeyStore(owner, { listAddress: LIST, ownerDid: owner.identity.id });
		const bobKey = await key(2);
		const ring = createKeyRing();
		ring.add(LIST_SCOPE, 0, newEpochKey());
		ring.add(LIST_SCOPE, 1, newEpochKey());

		await expect(
			grantListKeys(store, ring, { did: BOB, publicKey: bobKey.publicKey })
		).resolves.toEqual([listSlot(0, BOB), listSlot(1, BOB)]);
		const bobs = createKeyRing();
		await loadOwnKeys(store, bobs, { did: BOB, agreementKey: bobKey });
		expect(bobs.epochs(LIST_SCOPE)).toEqual([0, 1]);
		// The owner's ring still holds its keys: what was wrapped was a copy.
		expect(ring.raw(LIST_SCOPE, 1)).not.toEqual(new Uint8Array(32));
	});

	it('reports a copy that clashes with a key the ring holds, and keeps the rest', async () => {
		const owner = await orbitdbInMemory();
		const store = await openKeyStore(owner, { listAddress: LIST, ownerDid: owner.identity.id });
		const bobKey = await key(2);
		const ring = createKeyRing();
		ring.add(LIST_SCOPE, 0, newEpochKey());
		ring.add(LIST_SCOPE, 1, newEpochKey());
		await grantListKeys(store, ring, { did: BOB, publicKey: bobKey.publicKey });

		const bobs = createKeyRing();
		const stale = newEpochKey();
		bobs.add(LIST_SCOPE, 0, stale);
		await expect(loadOwnKeys(store, bobs, { did: BOB, agreementKey: bobKey })).resolves.toEqual({
			added: [listSlot(1, BOB)],
			failed: [{ slot: listSlot(0, BOB), reason: 'conflict' }]
		});
		expect(bobs.raw(LIST_SCOPE, 0)).toEqual(stale);
	});
});
