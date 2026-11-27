import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dagCbor from '@ipld/dag-cbor';
import { createAccountDirectory } from './account-directory.js';

/**
 * What the directory does around OrbitDB, on stand-ins for OrbitDB and
 * gossipsub: the owner's answer to a newcomer, and the reader asking again.
 * That this carries an entry over a circuit is e2e/account-directory.spec.js,
 * in two real browsers.
 */

const BOB = 'did:key:z4oJ8bob';
const CHAIN_ID = 11155111;
const ADDRESS = '0x601A3a3Dca597722DEd8973349AF84a1c727532d';
const DIRECTORY_TOPIC = '/orbitdb/zdpuBobsDirectory';

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

/** Gossipsub as far as the directory uses it, and a log of what it did. */
function fakePubsub(/** @type {string[]} */ log) {
	const target = new EventTarget();
	/** @type {Array<{ topic: string, data: Uint8Array }>} */
	const published = [];
	/** @type {string[]} */
	const subscribers = [];
	return Object.assign(target, {
		published,
		subscribers,
		subscribe: (/** @type {string} */ topic) => void log.push(`subscribe ${topic}`),
		unsubscribe: (/** @type {string} */ topic) => void log.push(`unsubscribe ${topic}`),
		getSubscribers: (/** @type {string} */ topic) => (topic === DIRECTORY_TOPIC ? subscribers : []),
		publish: async (/** @type {string} */ topic, /** @type {Uint8Array} */ data) => {
			published.push({ topic, data });
		},
		/** Another peer subscribes to `topic`. */
		joins: (/** @type {string} */ topic) =>
			target.dispatchEvent(
				new CustomEvent('subscription-change', {
					detail: { peerId: 'alice', subscriptions: [{ topic, subscribe: true }] }
				})
			)
	});
}

/** One browser: an OrbitDB with Bob's directory in it, empty until `put`. */
function browser(/** @type {string} */ ownDid) {
	/** @type {string[]} */
	const log = [];
	const pubsub = fakePubsub(log);
	const entryBytes = dagCbor.encode({ payload: { key: 'account' } });
	/** @type {Map<string, any>} */
	const values = new Map();
	/** @type {Array<{ hash: string }>} */
	let heads = [];
	const database = {
		address: DIRECTORY_TOPIC,
		events: emitter(),
		log: {
			heads: async () => heads,
			// The whole log, which an answer carries when it is small (#127): here
			// the one entry that is also its head.
			values: async () => heads,
			storage: {
				get: async (/** @type {string} */ hash) => (hash === 'entry' ? entryBytes : undefined)
			}
		},
		get: async (/** @type {string} */ key) => values.get(key),
		put: async (/** @type {string} */ key, /** @type {any} */ value) => {
			values.set(key, value);
			heads = [{ hash: 'entry' }];
			database.events.emit('update');
		}
	};
	const orbitdb = {
		identity: { id: ownDid },
		ipfs: { libp2p: { services: { pubsub } } },
		open: async () => {
			log.push('open directory');
			return database;
		}
	};
	return { pubsub, log, database, entryBytes, directory: createAccountDirectory(() => orbitdb) };
}

const ACCOUNT = { address: /** @type {`0x${string}`} */ (ADDRESS), chainId: CHAIN_ID };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the owner's browser", () => {
	it('answers a newcomer with its entry, and again a little later', async () => {
		const bob = browser(BOB);
		await bob.directory.publish(BOB, ACCOUNT);
		// Nobody there yet: nothing to say.
		expect(bob.pubsub.published).toEqual([]);

		bob.pubsub.joins(DIRECTORY_TOPIC);
		await vi.advanceTimersByTimeAsync(0);
		expect(bob.pubsub.published).toEqual([{ topic: DIRECTORY_TOPIC, data: bob.entryBytes }]);

		// Once more, for a newcomer gossipsub had no stream to yet.
		await vi.advanceTimersByTimeAsync(3_000);
		expect(bob.pubsub.published).toHaveLength(2);
	});

	it('answers joins close together once, and a later one again', async () => {
		const bob = browser(BOB);
		await bob.directory.publish(BOB, ACCOUNT);

		bob.pubsub.joins(DIRECTORY_TOPIC);
		bob.pubsub.joins(DIRECTORY_TOPIC);
		await vi.advanceTimersByTimeAsync(0);
		expect(bob.pubsub.published).toHaveLength(1);

		// A reader that asks again a few seconds later gets a new answer.
		await vi.advanceTimersByTimeAsync(4_000);
		const before = bob.pubsub.published.length;
		bob.pubsub.joins(DIRECTORY_TOPIC);
		await vi.advanceTimersByTimeAsync(0);
		expect(bob.pubsub.published.length).toBe(before + 1);
	});

	it('answers a peer that was on the topic before it started, which it never sees join', async () => {
		const bob = browser(BOB);
		bob.pubsub.subscribers.push('alice');
		await bob.directory.publish(BOB, ACCOUNT);
		await vi.advanceTimersByTimeAsync(0);
		expect(bob.pubsub.published).toEqual([{ topic: DIRECTORY_TOPIC, data: bob.entryBytes }]);
	});

	it('is the only one that answers: a reader of the directory sends nothing', async () => {
		const alice = browser('did:key:z4oJ8alice');
		await alice.directory.lookup(BOB, { chainId: CHAIN_ID, timeoutMs: 0 });
		alice.pubsub.joins(DIRECTORY_TOPIC);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(alice.pubsub.published).toEqual([]);
	});
});

describe("the reader's browser", () => {
	it('asks again while it waits, and has the account as soon as the entry arrives', async () => {
		const alice = browser('did:key:z4oJ8alice');
		const pending = alice.directory.lookup(BOB, { chainId: CHAIN_ID, timeoutMs: 20_000 });
		await vi.advanceTimersByTimeAsync(4_000);
		// Gossipsub alone: the subscription is sent anew, OrbitDB's Sync is left alone.
		expect(alice.log).toEqual([
			'open directory',
			`unsubscribe ${DIRECTORY_TOPIC}`,
			`subscribe ${DIRECTORY_TOPIC}`
		]);

		const entry = { ...ACCOUNT, publishedAt: 'now' };
		await alice.database.put('account', entry);
		await expect(pending).resolves.toEqual(entry);

		// Settled: no more asking.
		const asked = alice.log.length;
		await vi.advanceTimersByTimeAsync(20_000);
		expect(alice.log.length).toBe(asked);
	});

	it('gives up after its time, with nothing', async () => {
		const alice = browser('did:key:z4oJ8alice');
		const pending = alice.directory.lookup(BOB, { chainId: CHAIN_ID, timeoutMs: 20_000 });
		await vi.advanceTimersByTimeAsync(20_000);
		await expect(pending).resolves.toBeNull();
		// Asked twice, at 4 and at 10 seconds.
		expect(alice.log.filter((line) => line.startsWith('subscribe'))).toHaveLength(2);
	});
});
