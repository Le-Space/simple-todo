import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { createAccountDirectory } from './chain/account-directory.js';
import { wrapInstance } from './instance-wrappers.js';

/**
 * The account directory in memory mode, on an OrbitDB built the way the
 * passkey branch of `createOrbitDBInstance` builds it: identities of its own
 * and no `directory`. In a real browser, because the claim is about IndexedDB.
 */

/** @type {any[]} */
let running = [];

async function passkeyShapedOrbitDB() {
	const libp2p = await createLibp2p({
		services: {
			identify: identify(),
			pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
		}
	});
	const ipfs = await withLibp2p(
		createHeliaLight({ codecs: [dagCbor, dagJson, json], hashers: [sha512] }),
		libp2p
	).start();
	// `identities` is a documented option the bundled declaration omits -- see
	// the same call in p2p.js.
	// @ts-expect-error incomplete upstream types, not a wrong call
	const orbitdb = await createOrbitDB({ ipfs, identities: await createMemoryIdentities(ipfs) });
	running.push(orbitdb, ipfs);
	return orbitdb;
}

async function databaseNames() {
	return (await indexedDB.databases()).map((d) => d.name ?? '').filter(Boolean);
}

async function deleteAllDatabases() {
	for (const name of await databaseNames()) {
		await new Promise((resolve) => {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = request.onerror = request.onblocked = resolve;
		});
	}
}

describe('an OrbitDB instance in memory mode with a passkey', () => {
	beforeEach(async () => {
		setPersistentStorageEnabled(false);
		await deleteAllDatabases();
	});

	afterEach(async () => {
		for (const node of running.splice(0)) await node.stop?.();
		await deleteAllDatabases();
	});

	it('is needed: unwrapped, the account directory writes its log to IndexedDB', async () => {
		const orbitdb = await passkeyShapedOrbitDB();
		const directory = createAccountDirectory(() => orbitdb);

		await directory.publish(orbitdb.identity.id, {
			address: '0x000000000000000000000000000000000000dEaD',
			chainId: 11155111
		});

		expect(await databaseNames()).toEqual(
			expect.arrayContaining([expect.stringMatching(/orbitdb\/.+\/log\/_(heads|index)/)])
		);
	});

	it('wrapped, the account directory leaves nothing on the device', async () => {
		const orbitdb = wrapInstance(await passkeyShapedOrbitDB());
		const directory = createAccountDirectory(() => orbitdb);

		await directory.publish(orbitdb.identity.id, {
			address: '0x000000000000000000000000000000000000dEaD',
			chainId: 11155111
		});

		expect(await databaseNames()).toEqual([]);
	});
});
