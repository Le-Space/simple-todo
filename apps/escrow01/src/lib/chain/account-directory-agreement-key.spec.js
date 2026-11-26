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
import { agreementKeyFromPrf, LIST_KEY_AGREEMENT_INFO } from '../sealed/key-agreement.js';
import { toBase64 } from '../sealed/bytes.js';
import { createAccountDirectory, parsePublishedAgreementKey } from './account-directory.js';

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

describe('the directory’s key for sealed lists', () => {
	beforeEach(() => setPersistentStorageEnabled(false));

	afterEach(async () => {
		for (const node of running.splice(0)) await node.stop?.();
	});

	it('publishes the public key under the DID and finds it again', async () => {
		const orbitdb = await orbitdbInMemory();
		const directory = createAccountDirectory(() => orbitdb);
		const did = orbitdb.identity.id;
		const { publicKey } = await agreementKeyFromPrf(new Uint8Array(32).fill(4));

		await expect(directory.lookupAgreementKey(did, { timeoutMs: 0 })).resolves.toBeNull();
		await directory.publishAgreementKey(did, publicKey);
		const found = await directory.lookupAgreementKey(did, { timeoutMs: 0 });

		expect(found?.publicKey).toEqual(publicKey);
		expect(found?.publishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
	});

	it('writes nothing new for the key it already published', async () => {
		const orbitdb = await orbitdbInMemory();
		const directory = createAccountDirectory(() => orbitdb);
		const did = orbitdb.identity.id;
		const { publicKey } = await agreementKeyFromPrf(new Uint8Array(32).fill(4));

		await directory.publishAgreementKey(did, publicKey);
		const before = await directory.lookupAgreementKey(did, { timeoutMs: 0 });
		await directory.publishAgreementKey(did, publicKey);
		const after = await directory.lookupAgreementKey(did, { timeoutMs: 0 });

		expect(after?.publishedAt).toBe(before?.publishedAt);
	});

	it('takes no key for somebody else’s DID', async () => {
		const orbitdb = await orbitdbInMemory();
		const other = await orbitdbInMemory();
		const directory = createAccountDirectory(() => orbitdb);
		const { publicKey } = await agreementKeyFromPrf(new Uint8Array(32).fill(4));

		await expect(directory.publishAgreementKey(other.identity.id, publicKey)).rejects.toThrow(
			/not allowed to write/i
		);
	});

	it('keeps the account entry and the key apart', async () => {
		const orbitdb = await orbitdbInMemory();
		const directory = createAccountDirectory(() => orbitdb);
		const did = orbitdb.identity.id;
		const { publicKey } = await agreementKeyFromPrf(new Uint8Array(32).fill(4));

		await directory.publishAgreementKey(did, publicKey);
		await directory.publish(did, {
			address: '0x000000000000000000000000000000000000dEaD',
			chainId: 11155111
		});

		await expect(directory.lookup(did, { chainId: 11155111, timeoutMs: 0 })).resolves.toMatchObject(
			{
				address: '0x000000000000000000000000000000000000dEaD'
			}
		);
		expect((await directory.lookupAgreementKey(did, { timeoutMs: 0 }))?.publicKey).toEqual(
			publicKey
		);
	});

	it('refuses a key that is not 32 bytes', async () => {
		const orbitdb = await orbitdbInMemory();
		const directory = createAccountDirectory(() => orbitdb);
		await expect(
			directory.publishAgreementKey(orbitdb.identity.id, new Uint8Array(16))
		).rejects.toThrow(TypeError);
	});
});

describe('a published key as read from a peer', () => {
	const valid = {
		publicKey: toBase64(new Uint8Array(32).fill(9)),
		info: LIST_KEY_AGREEMENT_INFO,
		publishedAt: ''
	};

	it('is taken only for this version of the key and at 32 bytes', () => {
		expect(parsePublishedAgreementKey(valid)?.publicKey).toEqual(new Uint8Array(32).fill(9));
		for (const value of [
			null,
			'key',
			{ ...valid, info: 'simple-todo/escrow01/list-key-agreement/v2' },
			{ ...valid, info: undefined },
			{ ...valid, publicKey: toBase64(new Uint8Array(31)) },
			{ ...valid, publicKey: 42 }
		]) {
			expect(parsePublishedAgreementKey(value)).toBeNull();
		}
	});
});
