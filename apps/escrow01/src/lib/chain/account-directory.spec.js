import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dagCbor from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { createAccountDirectory, identityTopicOf } from './account-directory.js';

/**
 * What the directory does around OrbitDB, on stand-ins for OrbitDB and
 * gossipsub: the owner's answer to a newcomer and the reader's intake of the
 * owner's identity document. That the two together carry an entry over a
 * circuit is account-directory.spec.js in e2e/, in two real browsers.
 */

const BOB = 'did:key:z4oJ8bob';
const MALLORY = 'did:key:z4oJ8mallory';
const CHAIN_ID = 11155111;
const ADDRESS = '0x601A3a3Dca597722DEd8973349AF84a1c727532d';
const DIRECTORY_TOPIC = '/orbitdb/zdpuBobsDirectory';
const IDENTITY_HASH = 'zdpuBobsIdentity';

const identityBytes = (/** @type {string} */ id) =>
	dagCbor.encode({
		id,
		publicKey: '04ab',
		signatures: { id: 'a', publicKey: 'b' },
		type: 'webauthn'
	});

/** @param {Uint8Array} bytes */
const cidOf = async (bytes) => CID.create(1, dagCbor.code, await sha256.digest(bytes));

function emitter() {
	/** @type {Map<string, Set<Function>>} */
	const listeners = new Map();
	const of = (/** @type {string} */ name) => {
		if (!listeners.has(name)) listeners.set(name, new Set());
		return /** @type {Set<Function>} */ (listeners.get(name));
	};
	return {
		on: (/** @type {string} */ name, /** @type {Function} */ fn) => void of(name).add(fn),
		off: (/** @type {string} */ name, /** @type {Function} */ fn) => void of(name).delete(fn),
		once(/** @type {string} */ name, /** @type {Function} */ fn) {
			const wrapped = (/** @type {any[]} */ ...args) => {
				of(name).delete(wrapped);
				fn(...args);
			};
			of(name).add(wrapped);
		},
		emit: (/** @type {string} */ name, /** @type {any[]} */ ...args) => {
			for (const fn of [...of(name)]) fn(...args);
		}
	};
}

/** Gossipsub as far as the directory uses it, and a log of what it did, in order. */
function fakePubsub(/** @type {string[]} */ log) {
	const target = new EventTarget();
	/** @type {Array<{ topic: string, data: Uint8Array }>} */
	const published = [];
	return Object.assign(target, {
		published,
		subscribe: (/** @type {string} */ topic) => void log.push(`subscribe ${topic}`),
		unsubscribe: (/** @type {string} */ topic) => void log.push(`unsubscribe ${topic}`),
		publish: async (/** @type {string} */ topic, /** @type {Uint8Array} */ data) => {
			published.push({ topic, data });
		},
		/** Another peer subscribes to `topic`. */
		joins: (/** @type {string} */ topic) =>
			target.dispatchEvent(
				new CustomEvent('subscription-change', {
					detail: { peerId: 'alice', subscriptions: [{ topic, subscribe: true }] }
				})
			),
		/** A message arrives on `topic`. */
		deliver: (/** @type {string} */ topic, /** @type {Uint8Array} */ data) =>
			target.dispatchEvent(new CustomEvent('message', { detail: { topic, data } }))
	});
}

/** One browser: an OrbitDB with Bob's directory in it, empty until `put`. */
function browser(/** @type {string} */ ownDid) {
	/** @type {string[]} */
	const log = [];
	const pubsub = fakePubsub(log);
	/** @type {Map<string, Uint8Array>} */
	const blocks = new Map();
	const entryBytes = dagCbor.encode({ payload: { key: 'account' } });
	/** @type {Map<string, any>} */
	const values = new Map();
	/** @type {Array<{ hash: string, identity: string }>} */
	let heads = [];
	const database = {
		address: DIRECTORY_TOPIC,
		events: emitter(),
		log: {
			heads: async () => heads,
			storage: {
				get: async (/** @type {string} */ hash) => (hash === 'entry' ? entryBytes : undefined)
			}
		},
		get: async (/** @type {string} */ key) => values.get(key),
		put: async (/** @type {string} */ key, /** @type {any} */ value) => {
			values.set(key, value);
			heads = [{ hash: 'entry', identity: IDENTITY_HASH }];
			database.events.emit('update');
		}
	};
	const orbitdb = {
		identity: { id: ownDid },
		identities: {
			getIdentity: async (/** @type {string} */ hash) =>
				hash === IDENTITY_HASH ? { bytes: identityBytes(BOB) } : undefined
		},
		ipfs: {
			libp2p: { services: { pubsub } },
			blockstore: {
				has: async (/** @type {CID} */ cid) => blocks.has(cid.toString()),
				put: async (/** @type {CID} */ cid, /** @type {Uint8Array} */ bytes) =>
					void blocks.set(cid.toString(), bytes)
			}
		},
		open: async () => {
			log.push('open directory');
			return database;
		}
	};
	return {
		pubsub,
		log,
		blocks,
		database,
		entryBytes,
		directory: createAccountDirectory(() => orbitdb)
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the owner's browser", () => {
	it('answers a newcomer with its identity document, then its entry, and again a little later', async () => {
		const bob = browser(BOB);
		await bob.directory.publish(BOB, { address: ADDRESS, chainId: CHAIN_ID });
		expect(bob.pubsub.published).toEqual([]);

		bob.pubsub.joins(DIRECTORY_TOPIC);
		await vi.advanceTimersByTimeAsync(0);
		// The identity first: OrbitDB checks the entry against it on arrival.
		expect(bob.pubsub.published.map((m) => m.topic)).toEqual([identityTopicOf(BOB)]);
		expect(bob.pubsub.published[0].data).toEqual(identityBytes(BOB));

		await vi.advanceTimersByTimeAsync(300);
		expect(bob.pubsub.published.map((m) => m.topic)).toEqual([
			identityTopicOf(BOB),
			DIRECTORY_TOPIC
		]);
		expect(bob.pubsub.published[1].data).toEqual(bob.entryBytes);

		// Once more, for a newcomer gossipsub had no stream to yet.
		await vi.advanceTimersByTimeAsync(3_300);
		expect(bob.pubsub.published).toHaveLength(4);
	});

	it('answers a join of the identity topic too, and joins close together once', async () => {
		const bob = browser(BOB);
		await bob.directory.publish(BOB, { address: ADDRESS, chainId: CHAIN_ID });

		bob.pubsub.joins(identityTopicOf(BOB));
		bob.pubsub.joins(DIRECTORY_TOPIC);
		await vi.advanceTimersByTimeAsync(300);
		expect(bob.pubsub.published).toHaveLength(2);

		// A reader that asks again a few seconds later gets a new answer.
		await vi.advanceTimersByTimeAsync(4_000);
		const before = bob.pubsub.published.length;
		bob.pubsub.joins(identityTopicOf(BOB));
		await vi.advanceTimersByTimeAsync(300);
		expect(bob.pubsub.published.length).toBe(before + 2);
	});

	it('is the only one that answers: a reader of the directory sends nothing', async () => {
		const alice = browser('did:key:z4oJ8alice');
		await alice.directory.lookup(BOB, { chainId: CHAIN_ID, timeoutMs: 0 });
		alice.pubsub.joins(DIRECTORY_TOPIC);
		alice.pubsub.joins(identityTopicOf(BOB));
		await vi.advanceTimersByTimeAsync(5_000);
		expect(alice.pubsub.published).toEqual([]);
	});
});

describe("the reader's browser", () => {
	it('joins the identity topic before it opens the directory', async () => {
		const alice = browser('did:key:z4oJ8alice');
		await alice.directory.lookup(BOB, { chainId: CHAIN_ID, timeoutMs: 0 });
		expect(alice.log).toEqual([`subscribe ${identityTopicOf(BOB)}`, 'open directory']);
	});

	it("keeps the owner's identity document under the hash of its bytes, and nothing else", async () => {
		const alice = browser('did:key:z4oJ8alice');
		await alice.directory.lookup(BOB, { chainId: CHAIN_ID, timeoutMs: 0 });
		const topic = identityTopicOf(BOB);

		alice.pubsub.deliver(topic, identityBytes(MALLORY));
		alice.pubsub.deliver(identityTopicOf(MALLORY), identityBytes(BOB));
		alice.pubsub.deliver(topic, new Uint8Array(9 * 1024));
		alice.pubsub.deliver(topic, new Uint8Array([1, 2, 3]));
		await vi.advanceTimersByTimeAsync(0);
		expect(alice.blocks.size).toBe(0);

		alice.pubsub.deliver(topic, identityBytes(BOB));
		await vi.advanceTimersByTimeAsync(0);
		expect([...alice.blocks.keys()]).toEqual([(await cidOf(identityBytes(BOB))).toString()]);
	});

	it('asks again while it waits, and has the account as soon as the entry arrives', async () => {
		const alice = browser('did:key:z4oJ8alice');
		const pending = alice.directory.lookup(BOB, { chainId: CHAIN_ID, timeoutMs: 20_000 });
		await vi.advanceTimersByTimeAsync(4_000);
		expect(alice.log.slice(-2)).toEqual([
			`unsubscribe ${identityTopicOf(BOB)}`,
			`subscribe ${identityTopicOf(BOB)}`
		]);

		await alice.database.put('account', {
			address: ADDRESS,
			chainId: CHAIN_ID,
			publishedAt: 'now'
		});
		await expect(pending).resolves.toEqual({
			address: ADDRESS,
			chainId: CHAIN_ID,
			publishedAt: 'now'
		});

		// Settled: no more asking.
		const asked = alice.log.length;
		await vi.advanceTimersByTimeAsync(20_000);
		expect(alice.log.length).toBe(asked);
	});
});
