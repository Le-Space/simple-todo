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
import { LIST_SCOPE, taskScope } from './key-ring.js';
import { createListKeys, openListKeys } from './list-keys.js';
import { openRecords, sealForList, sealTodo } from './sealed-list.js';

const LIST = '/orbitdb/zdpuAuK3BHpS7NvMBivynypqciYCuy2UW77XYBPUYRnLjnw13';
const BOB = 'did:key:zDnaeBobExample';
const CAROL = 'did:key:zDnaeCarolExample';

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

		const record = {
			key: 'todo-1',
			value: await sealForList(created.ring, 'todo-1', { text: 'Pay rent' })
		};
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
		const record = {
			key: 'todo-1',
			value: await sealForList(ownersKeys.ring, 'todo-1', { text: 'Pay rent' })
		};

		const bobsKeys = await openListKeys(orbitdb, {
			listAddress: LIST,
			ownerDid: owner.did,
			own: bob,
			lookupPublicKey: async () => null
		});
		expect(bobsKeys.canSeal()).toBe(false);
		await expect(openRecords([record], bobsKeys.ring)).resolves.toMatchObject({
			records: [],
			hidden: 1
		});

		const arrived = nextChange(bobsKeys);
		await expect(ownersKeys.grant(BOB)).resolves.toBe('granted');
		await arrived;

		expect(bobsKeys.canSeal()).toBe(true);
		await expect(openRecords([record], bobsKeys.ring)).resolves.toMatchObject({
			records: [{ key: 'todo-1', value: { text: 'Pay rent' } }],
			hidden: 0
		});
	});

	it('let a write wait for them: until a grant arrives, or until its time is up', async () => {
		const orbitdb = await orbitdbInMemory();
		const owner = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const bob = { did: BOB, agreementKey: await keyFor(2) };
		const ownersKeys = await createListKeys(orbitdb, {
			listAddress: LIST,
			own: owner,
			lookupPublicKey: async (did) => (did === BOB ? bob.agreementKey.publicKey : null)
		});
		const bobsKeys = await openListKeys(orbitdb, {
			listAddress: LIST,
			ownerDid: owner.did,
			own: bob,
			lookupPublicKey: async () => null
		});

		await expect(bobsKeys.whenSealable(50)).resolves.toBe(false);
		const waiting = bobsKeys.whenSealable(10_000);
		await ownersKeys.grant(BOB);
		await expect(waiting).resolves.toBe(true);
		await expect(bobsKeys.whenSealable(0)).resolves.toBe(true);
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
		await createListKeys(orbitdb, {
			listAddress: LIST,
			own: owner,
			lookupPublicKey: async () => null
		});
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
		const keys = await createListKeys(orbitdb, {
			listAddress: LIST,
			own,
			lookupPublicKey: async () => null
		});
		await keys.close();

		expect(keys.canSeal()).toBe(false);
	});
});

describe('the name of a sealed list', () => {
	beforeEach(() => setPersistentStorageEnabled(false));

	afterEach(async () => {
		for (const node of running.splice(0)) await node.stop?.();
	});

	it('is kept sealed by the owner, and read by whoever holds the list key', async () => {
		const orbitdb = await orbitdbInMemory();
		const owner = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const bob = { did: BOB, agreementKey: await keyFor(2) };
		const ownersKeys = await createListKeys(orbitdb, {
			listAddress: LIST,
			own: owner,
			lookupPublicKey: async (did) => (did === BOB ? bob.agreementKey.publicKey : null)
		});
		await ownersKeys.setName('Household');

		expect(await ownersKeys.name()).toBe('Household');
		expect(JSON.stringify(await ownersKeys.store.all())).not.toContain('Household');

		const bobsKeys = await openListKeys(orbitdb, {
			listAddress: LIST,
			ownerDid: owner.did,
			own: bob,
			lookupPublicKey: async () => null
		});
		expect(await bobsKeys.name()).toBeNull();
		await expect(bobsKeys.setName('Mine now')).rejects.toThrow(/owner/);

		const arrived = nextChange(bobsKeys);
		await ownersKeys.grant(BOB);
		await arrived;
		expect(await bobsKeys.name()).toBe('Household');
	});
});

describe('the task keys of a sealed list', () => {
	beforeEach(() => setPersistentStorageEnabled(false));

	afterEach(async () => {
		for (const node of running.splice(0)) await node.stop?.();
	});

	/** The owner, Bob the delegate, Carol a writer, each with a key of their own. */
	async function cast() {
		const orbitdb = await orbitdbInMemory();
		const owner = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const bob = { did: BOB, agreementKey: await keyFor(2) };
		const carol = { did: CAROL, agreementKey: await keyFor(3) };
		/** @param {string} did */
		const lookupPublicKey = async (did) =>
			({ [BOB]: bob.agreementKey.publicKey, [CAROL]: carol.agreementKey.publicKey })[did] ?? null;
		const ownersKeys = await createListKeys(orbitdb, {
			listAddress: LIST,
			own: owner,
			lookupPublicKey
		});
		/** @param {{ did: string, agreementKey: any }} reader */
		const openAs = (reader) =>
			openListKeys(orbitdb, {
				listAddress: LIST,
				ownerDid: owner.did,
				own: reader,
				lookupPublicKey
			});
		return { orbitdb, owner, bob, carol, ownersKeys, openAs };
	}

	const handedTo = (/** @type {string} */ did, /** @type {string | null} */ revokedAt = null) => ({
		text: 'Fix the gate',
		delegation: { delegateDid: did, revokedAt }
	});

	it('let the delegate read his todo and nothing else of the list', async () => {
		const { ownersKeys, bob, openAs } = await cast();
		await expect(ownersKeys.delegate('todo-gate', BOB, [])).resolves.toEqual({
			epoch: 0,
			missing: []
		});
		const records = [
			{ key: 'todo-gate', value: await sealTodo(ownersKeys.ring, 'todo-gate', handedTo(BOB)) },
			{
				key: 'todo-rent',
				value: await sealTodo(ownersKeys.ring, 'todo-rent', { text: 'Pay rent' })
			}
		];

		const bobsKeys = await openAs(bob);
		expect(bobsKeys.canSeal()).toBe(false);
		await expect(openRecords(records, bobsKeys.ring)).resolves.toMatchObject({
			records: [{ key: 'todo-gate', value: { text: 'Fix the gate' } }],
			hidden: 1
		});
	});

	it('go to the writers too, who read every todo', async () => {
		const { ownersKeys, carol, openAs } = await cast();
		await expect(ownersKeys.grant(CAROL)).resolves.toBe('granted');
		await ownersKeys.delegate('todo-gate', BOB, [CAROL]);
		const records = [
			{ key: 'todo-gate', value: await sealTodo(ownersKeys.ring, 'todo-gate', handedTo(BOB)) },
			{
				key: 'todo-rent',
				value: await sealTodo(ownersKeys.ring, 'todo-rent', { text: 'Pay rent' })
			}
		];

		const carolsKeys = await openAs(carol);
		await expect(openRecords(records, carolsKeys.ring)).resolves.toMatchObject({ hidden: 0 });
	});

	it('start a new epoch with every delegation, which an earlier delegate does not get', async () => {
		const { ownersKeys, bob, openAs } = await cast();
		await ownersKeys.delegate('todo-gate', BOB, []);
		const second = await ownersKeys.delegate('todo-gate', CAROL, []);
		expect(second).toEqual({ epoch: 1, missing: [] });

		const afterBob = {
			key: 'todo-gate',
			value: await sealTodo(ownersKeys.ring, 'todo-gate', handedTo(CAROL))
		};
		const bobsKeys = await openAs(bob);
		expect(bobsKeys.ring.epochs(taskScope('todo-gate'))).toEqual([0]);
		await expect(openRecords([afterBob], bobsKeys.ring)).resolves.toMatchObject({ hidden: 1 });
	});

	it('are made at once for a delegate without a key yet, who gets his copy once he has one', async () => {
		const orbitdb = await orbitdbInMemory();
		const owner = { did: orbitdb.identity.id, agreementKey: await keyFor(1) };
		const bob = { did: BOB, agreementKey: await keyFor(2) };
		let published = false;
		const ownersKeys = await createListKeys(orbitdb, {
			listAddress: LIST,
			own: owner,
			lookupPublicKey: async (did) => (published && did === BOB ? bob.agreementKey.publicKey : null)
		});

		await expect(ownersKeys.delegate('todo-gate', BOB, [])).resolves.toEqual({
			epoch: 0,
			missing: [BOB]
		});
		await expect(ownersKeys.ensureTaskGranted('todo-gate', BOB)).resolves.toEqual([]);

		published = true;
		await expect(ownersKeys.ensureTaskGranted('todo-gate', BOB)).resolves.toEqual([
			`task/todo-gate/0/${BOB}`
		]);
		await expect(ownersKeys.ensureTaskGranted('todo-gate', BOB)).resolves.toEqual([]);

		const record = {
			key: 'todo-gate',
			value: await sealTodo(ownersKeys.ring, 'todo-gate', handedTo(BOB))
		};
		const bobsKeys = await openListKeys(orbitdb, {
			listAddress: LIST,
			ownerDid: owner.did,
			own: bob,
			lookupPublicKey: async () => null
		});
		await expect(openRecords([record], bobsKeys.ring)).resolves.toMatchObject({ hidden: 0 });
	});

	it('leave a writer who was removed without the next list key', async () => {
		const { ownersKeys, carol, openAs } = await cast();
		await ownersKeys.grant(CAROL);
		await expect(ownersKeys.rotate(LIST_SCOPE, [])).resolves.toEqual({ epoch: 1, missing: [] });
		const later = {
			key: 'todo-new',
			value: await sealForList(ownersKeys.ring, 'todo-new', { text: 'After Carol' })
		};

		const carolsKeys = await openAs(carol);
		expect(carolsKeys.ring.epochs(LIST_SCOPE)).toEqual([0]);
		await expect(openRecords([later], carolsKeys.ring)).resolves.toMatchObject({ hidden: 1 });
	});

	it('give a writer only the copies he is missing', async () => {
		const { ownersKeys } = await cast();
		await ownersKeys.grant(CAROL);
		await ownersKeys.delegate('todo-gate', BOB, []);

		await expect(ownersKeys.ensureGranted(CAROL)).resolves.toEqual([`task/todo-gate/0/${CAROL}`]);
		await expect(ownersKeys.ensureGranted(CAROL)).resolves.toEqual([]);
	});

	it('are made and rotated by the owner only', async () => {
		const { bob, openAs } = await cast();
		const bobsKeys = await openAs(bob);

		await expect(bobsKeys.delegate('todo-gate', CAROL, [])).rejects.toThrow(/owner/);
		await expect(bobsKeys.rotate(LIST_SCOPE, [])).rejects.toThrow(/owner/);
	});
});
