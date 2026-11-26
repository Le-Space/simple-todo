import { describe, expect, it } from 'vitest';

import { newKey } from './db-encryption.js';
import {
	forgetDeviceKeys,
	importDeviceKey,
	ownDeviceKeys,
	pairFromPrf,
	pairFromSigningKey
} from './device-keys.js';
import { createKeyring, epochKey } from './keyring.js';
import { wrapKey } from './key-wrapping.js';
import { adminsOf, keysForRecipient, rotateKey, shareKeyWith } from './shared-keys.js';

const LIST = '/orbitdb/zdpuSharedKeysSpecList';

/** A reader with a published key, the way the directory would hold it. */
async function reader(/** @type {string} */ did) {
	await forgetDeviceKeys(did);
	const own = await ownDeviceKeys(did);
	return { did, ...own };
}

/**
 * The store, whose log anybody may write to. `writer` is the identity that
 * signed an entry — on a real log OrbitDB verifies it, and it is the one thing
 * a forger cannot choose.
 */
function fakeStore() {
	/** @type {any[]} */
	const log = [];
	return {
		log: { values: async () => log },
		/** Everybody writes through this one, as anybody may. */
		as(/** @type {string} */ writer) {
			return {
				log: { values: async () => log },
				async put(/** @type {string} */ key, /** @type {any} */ value) {
					log.push({ identity: `hash-of-${writer}`, payload: { op: 'PUT', key, value } });
				}
			};
		}
	};
}

/** Resolves an identity hash back to the DID that signed, as OrbitDB does. */
const identities = {
	getIdentity: async (/** @type {string} */ hash) => ({ id: hash.replace('hash-of-', '') })
};

/** An OrbitDB stand-in whose directory knows the readers' published keys. */
function withDirectory(/** @type {{ did: string, publicKey: string }[]} */ readers) {
	const log = readers.map(({ did, publicKey }) => ({
		identity: `hash-of-${did}`,
		payload: { op: 'PUT', key: did, value: publicKey }
	}));
	return { orbitdb: { identities }, directory: { log: { values: async () => log } } };
}

/** @param {{ key: Uint8Array }[]} keys */
const bytesOf = (keys) => keys.map(({ key }) => Array.from(key));

/**
 * Only the keys, for the cases that are not about which pair opened them.
 *
 * @param {any} store
 * @param {Parameters<typeof keysForRecipient>[1]} who
 */
const keysOf = async (store, who) => (await keysForRecipient(store, who)).keys;

/**
 * A reader as one is after the PRF derivation: the current pair from the PRF
 * output, and the pair the signing key gave before, to read old copies with.
 *
 * @param {string} did
 */
async function migratedReader(did) {
	const current = await pairFromPrf(crypto.getRandomValues(new Uint8Array(32)));
	const earlier = await pairFromSigningKey(did, crypto.getRandomValues(new Uint8Array(64)));
	return { did, ...current, earlier };
}

/**
 * A copy of `key`, sealed by `admin` to one public key.
 *
 * @param {ReturnType<typeof fakeStore>} store
 * @param {string} admin
 * @param {string} recipientDid
 * @param {import('./keyring.js').EpochKey} key
 * @param {string} publicKey
 */
async function sealCopy(store, admin, recipientDid, key, publicKey) {
	await store.as(admin).put(`${LIST}|${recipientDid}|${key.epoch}`, {
		epoch: key.epoch,
		keyId: key.keyId,
		...(await wrapKey(key.key, await importDeviceKey(publicKey)))
	});
}

describe('shared-keys', () => {
	it('hands a granted reader the keys an admin sealed for them', async () => {
		const alice = await reader('did:key:alice');
		const bob = await reader('did:key:bob');
		const { orbitdb, directory } = withDirectory([bob]);
		const store = fakeStore();
		const key = await epochKey(newKey(), 0);

		const result = await shareKeyWith(
			orbitdb,
			{ directory, store: store.as(alice.did) },
			{ listAddress: LIST, recipientDid: bob.did, keys: [key] }
		);

		expect(result).toEqual({ shared: true });
		const found = await keysOf(store, {
			listAddress: LIST,
			did: bob.did,
			privateKey: bob.privateKey,
			admins: new Set([alice.did]),
			identities
		});
		expect(bytesOf(found)).toEqual(bytesOf([key]));
		expect(found[0].epoch).toBe(0);
	});

	it('ignores a copy that a third identity planted for Bob', async () => {
		// #120, the first checklist item. Bob's public key is in the directory for
		// anyone to read, so Eve can seal a key of her own choosing to it, file it
		// under Bob's entry for Alice's list, and it opens. Before the fix it was
		// also the newest copy and won: Bob read nothing Alice wrote, and sealed
		// everything he wrote under a key Eve holds.
		const alice = await reader('did:key:alice');
		const bob = await reader('did:key:bob');
		const eve = await reader('did:key:eve');
		const store = fakeStore();
		const alicesKey = newKey();
		const evesKey = newKey();

		const bobsPublicKey = await importDeviceKey(bob.publicKey);
		await store.as(alice.did).put(`${LIST}|${bob.did}|0`, {
			epoch: 0,
			keyId: (await epochKey(alicesKey, 0)).keyId,
			...(await wrapKey(alicesKey, bobsPublicKey))
		});
		// Eve's copy is newer, claims a newer epoch, and opens for Bob.
		await store.as(eve.did).put(`${LIST}|${bob.did}|1`, {
			epoch: 1,
			keyId: (await epochKey(evesKey, 1)).keyId,
			...(await wrapKey(evesKey, bobsPublicKey))
		});

		const found = await keysOf(store, {
			listAddress: LIST,
			did: bob.did,
			privateKey: bob.privateKey,
			admins: new Set([alice.did]),
			identities
		});

		expect(bytesOf(found)).toEqual([Array.from(alicesKey)]);
	});

	it('gives Bob nothing when the only copy is planted', async () => {
		const alice = await reader('did:key:alice');
		const bob = await reader('did:key:bob');
		const eve = await reader('did:key:eve');
		const store = fakeStore();
		const { orbitdb, directory } = withDirectory([bob]);

		await shareKeyWith(
			orbitdb,
			{ directory, store: store.as(eve.did) },
			{ listAddress: LIST, recipientDid: bob.did, keys: [await epochKey(newKey(), 0)] }
		);

		expect(
			await keysOf(store, {
				listAddress: LIST,
				did: bob.did,
				privateKey: bob.privateKey,
				admins: new Set([alice.did]),
				identities
			})
		).toEqual([]);
	});

	it('believes nobody when the list has no admins', async () => {
		// The shared mnemonic list is `write: ['*']`. "Anyone" vouching for a key
		// is exactly the attack, so a list like that has no admins at all.
		expect([...(await adminsOf({ write: ['*'] }))]).toEqual([]);
		expect([
			...(await adminsOf({
				capabilities: async () => ({ admin: new Set(['did:key:alice', '*']), write: new Set() })
			}))
		]).toEqual(['did:key:alice']);
	});

	it('gives nothing to somebody no copy was made for', async () => {
		const alice = await reader('did:key:alice');
		const bob = await reader('did:key:bob');
		const eve = await reader('did:key:eve');
		const { orbitdb, directory } = withDirectory([bob]);
		const store = fakeStore();

		await shareKeyWith(
			orbitdb,
			{ directory, store: store.as(alice.did) },
			{ listAddress: LIST, recipientDid: bob.did, keys: [await epochKey(newKey(), 0)] }
		);

		const admins = new Set([alice.did]);
		// Eve reads Bob's entry key as well as her own; neither opens for her.
		expect(
			await keysOf(store, {
				listAddress: LIST,
				did: bob.did,
				privateKey: eve.privateKey,
				admins,
				identities
			})
		).toEqual([]);
		expect(
			await keysOf(store, {
				listAddress: LIST,
				did: eve.did,
				privateKey: eve.privateKey,
				admins,
				identities
			})
		).toEqual([]);
	});

	it('keeps two lists apart', async () => {
		const alice = await reader('did:key:alice');
		const bob = await reader('did:key:bob');
		const { orbitdb, directory } = withDirectory([bob]);
		const store = fakeStore();

		await shareKeyWith(
			orbitdb,
			{ directory, store: store.as(alice.did) },
			{ listAddress: LIST, recipientDid: bob.did, keys: [await epochKey(newKey(), 0)] }
		);

		expect(
			await keysOf(store, {
				listAddress: '/orbitdb/zdpuAnotherListEntirely',
				did: bob.did,
				privateKey: bob.privateKey,
				admins: new Set([alice.did]),
				identities
			})
		).toEqual([]);
	});

	it('says why nothing was shared when the reader published no key', async () => {
		// Granted write access but never opened the chapter, so there is nothing
		// to seal to. The person granting has to be told in words.
		const store = fakeStore();
		const directory = { log: { values: async () => [] } };

		const result = await shareKeyWith(
			{ identities: { getIdentity: async () => null } },
			{ directory, store: store.as('did:key:alice') },
			{
				listAddress: LIST,
				recipientDid: 'did:key:absent',
				keys: [await epochKey(newKey(), 0)]
			}
		);

		expect(result).toEqual({ shared: false, reason: 'no-published-key' });
	});

	it('starts a new epoch on revoke that the removed reader does not get', async () => {
		// #120, the second item, at the level of the keys: after Carol is removed
		// Bob and the owner hold the new key, Carol holds only the old ones.
		const alice = await reader('did:key:alice');
		const bob = await reader('did:key:bob');
		const carol = await reader('did:key:carol');
		const { orbitdb, directory } = withDirectory([bob, carol]);
		const store = fakeStore();
		const databases = { directory, store: store.as(alice.did) };
		const first = await epochKey(newKey(), 0);
		const keyring = createKeyring([first]);

		for (const member of [bob, carol]) {
			await shareKeyWith(orbitdb, databases, {
				listAddress: LIST,
				recipientDid: member.did,
				keys: keyring.all()
			});
		}

		const { key, results } = await rotateKey(orbitdb, databases, {
			listAddress: LIST,
			keyring,
			recipients: [alice.did, bob.did],
			own: { did: alice.did, publicKey: alice.publicKey }
		});

		expect(key.epoch).toBe(1);
		expect(keyring.current()?.keyId).toBe(key.keyId);
		expect(results).toEqual([{ did: bob.did, shared: true }]);

		const admins = new Set([alice.did]);
		/** @param {{ did: string, privateKey: CryptoKey }} who */
		const epochsOf = async (who) =>
			(
				await keysOf(store, {
					listAddress: LIST,
					did: who.did,
					privateKey: who.privateKey,
					admins,
					identities
				})
			)
				.map((found) => found.epoch)
				.sort();

		expect(await epochsOf(bob)).toEqual([0, 1]);
		expect(await epochsOf(carol)).toEqual([0]);
		// The owner's own copy of the new key, which is what her other devices read.
		expect(await epochsOf(alice)).toEqual([1]);
	});

	describe('after the pair moved to the PRF output', () => {
		it('opens a copy sealed to the earlier pair, and says only that one opened it', async () => {
			// Copies sealed before the change went to the pair derived from the
			// signing key, and the log keeps them. The reader still gets the key —
			// and the owner learns it has no copy for the current pair yet.
			const alice = await reader('did:key:alice');
			const bob = await migratedReader('did:key:bob');
			const store = fakeStore();
			const key = await epochKey(newKey(), 0);
			await sealCopy(store, alice.did, bob.did, key, bob.earlier.publicKey);

			const { keys, onlyUnderEarlier } = await keysForRecipient(store, {
				listAddress: LIST,
				did: bob.did,
				privateKey: bob.privateKey,
				earlierPrivateKeys: [bob.earlier.privateKey],
				admins: new Set([alice.did]),
				identities
			});

			expect(bytesOf(keys)).toEqual(bytesOf([key]));
			expect([...onlyUnderEarlier]).toEqual([key.keyId]);
		});

		it('does not open a copy for the earlier pair without that pair', async () => {
			const alice = await reader('did:key:alice');
			const bob = await migratedReader('did:key:bob');
			const store = fakeStore();
			await sealCopy(store, alice.did, bob.did, await epochKey(newKey(), 0), bob.earlier.publicKey);

			expect(
				await keysForRecipient(store, {
					listAddress: LIST,
					did: bob.did,
					privateKey: bob.privateKey,
					admins: new Set([alice.did]),
					identities
				})
			).toEqual({ keys: [], onlyUnderEarlier: new Set() });
		});

		it('counts a key as moved once a copy for the current pair is there', async () => {
			// The owner re-seals to her current pair when she opens the list; the
			// old copy stays in the log, and must not make the key look unmoved.
			const alice = await migratedReader('did:key:alice');
			const store = fakeStore();
			const key = await epochKey(newKey(), 0);
			await sealCopy(store, alice.did, alice.did, key, alice.earlier.publicKey);
			await sealCopy(store, alice.did, alice.did, key, alice.publicKey);

			const { keys, onlyUnderEarlier } = await keysForRecipient(store, {
				listAddress: LIST,
				did: alice.did,
				privateKey: alice.privateKey,
				earlierPrivateKeys: [alice.earlier.privateKey],
				admins: new Set([alice.did]),
				identities
			});

			expect(bytesOf(keys)).toEqual(bytesOf([key]));
			expect([...onlyUnderEarlier]).toEqual([]);
		});

		it('believes no planted copy for the earlier pair either', async () => {
			// The earlier public key was in the directory too, so Eve can seal to
			// it. The admin check comes before any pair is tried.
			const alice = await reader('did:key:alice');
			const bob = await migratedReader('did:key:bob');
			const eve = await reader('did:key:eve');
			const store = fakeStore();
			await sealCopy(store, eve.did, bob.did, await epochKey(newKey(), 0), bob.earlier.publicKey);

			expect(
				await keysForRecipient(store, {
					listAddress: LIST,
					did: bob.did,
					privateKey: bob.privateKey,
					earlierPrivateKeys: [bob.earlier.privateKey],
					admins: new Set([alice.did]),
					identities
				})
			).toEqual({ keys: [], onlyUnderEarlier: new Set() });
		});
	});
});
