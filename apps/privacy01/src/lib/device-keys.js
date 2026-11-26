// The key pair that lets somebody else hand this identity a database key.
//
// Ported from Le-Space/yogasuci `src/lib/db/device-keys.js`
// (Le-Space/yogasuci#95), which is where this shipped first, and changed twice
// since in ways that matter.
//
// Separate from the identity key, and that separation is the point. The
// identity signs; it has no key agreement. A database key has to *reach* a
// second reader, which needs agreement, so this is a second pair with one job:
// unwrapping what was sealed for it (#277 phase 2).
//
// **From the passkey's PRF output, under a label of its own.** HKDF-SHA256 over
// the PRF output with the info `simple-todo/privacy01/list-key-agreement/v1`
// gives 32 bytes, and an X25519 private key is any 32 bytes. The same passkey
// answers the same PRF input with the same bytes on every device, so one
// passkey means one pair everywhere, and nothing secret has to be written down
// for it. escrow01 does the same under a label of its own; the label is what
// keeps a copy sealed in one chapter from opening in the other.
//
// It used to come from the OrbitDB signing key (#120), which is itself derived
// from the PRF output and so travelled just as well. But it tied together two
// keys with different jobs: whoever held the signing key could open every copy
// sealed for this identity. Now both are derived from the PRF output under
// labels of their own, and neither reveals the other. p2p.js reads the PRF
// output once and hands it to both, so this costs no extra touch.
//
// **The pair that came from the signing key is still computed — to read with,
// never to seal to.** Copies sealed before the change went to it, and an
// append-only log keeps them. It is not published, and nothing new is sealed to
// it; `earlier` carries it so a reader can try it after the current pair, and an
// owner seals her own keys to the current pair again when she opens the list
// (`copyMissingKeysToSelf` in ./db-actions.js). Whoever holds the signing key
// can therefore still open those old copies, and only those.
//
// **Without PRF** — an authenticator that has none, or the identity without a
// passkey — there is nothing to derive from. The pair is then random, and this
// browser is the only place it exists. It is made as a key that cannot be
// exported and kept as it is: in IndexedDB when the reader chose to keep things
// (under the prefix `wipePersistentStorage()` deletes), for this tab only
// otherwise. No script can read its bytes, but any script on this origin can
// *use* it to open a copy sealed for it, a browser extension included — which
// the no-PRF toast says in words. escrow01 keeps its device key the same way.
//
// X25519 rather than P-256: an X25519 private key is any 32 bytes, so a derived
// seed is a key as it stands. WebCrypto has no way to turn 32 bytes into a P-256
// key without curve arithmetic of our own.
//
// Scoped by identity. Two passkeys in one browser are two people as far as this
// chapter is concerned, and what was sealed for one must not open for the other.

import { deriveSubkey } from '@le-space/orbitdb-identity-provider-webauthn-did/vault';
import { forget } from '@simple-todo/todo/browser-memory.js';
import { getPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';

/**
 * What the PRF output is for, here. Part of the data format: changing it
 * changes every pair, and every copy sealed to the old ones stops opening.
 */
export const KEY_AGREEMENT_INFO = 'simple-todo/privacy01/list-key-agreement/v1';

/**
 * Where a pair without PRF is kept, when things are kept: under the prefix the
 * storage wipe owns (`level-js-simple-todo/`), so choosing "nothing on this
 * device" deletes it with the rest.
 */
export const DEVICE_KEY_DATABASE = 'level-js-simple-todo/privacy01/agreement-keys';
const STORE = 'keys';

/**
 * Where a pair used to be kept, as JWK text in local storage. Read by nothing
 * now; whatever is left there is a private key in the clear, and is deleted.
 */
const LEGACY_STORAGE_PREFIX = 'privacy01.deviceKey.';
const ALGORITHM = { name: 'X25519' };

/**
 * An X25519 private key in PKCS#8 (RFC 8410) is this fixed prefix followed by
 * the 32 key bytes. The public half is not part of it, which is what lets a
 * derived seed be imported without computing anything first.
 */
const PKCS8_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20
]);

/**
 * @typedef {object} DeviceKeyPair
 * @property {CryptoKey} privateKey for unwrapping keys addressed to this identity
 * @property {string} publicKey base64 JWK, the half that goes into the directory
 */

/**
 * @typedef {DeviceKeyPair & {
 *   source: 'prf' | 'browser',
 *   earlier: DeviceKeyPair[]
 * }} DeviceKeys
 * The current pair at the top — what is published and what copies are sealed
 * to — and where it came from. `earlier` holds pairs only to read with.
 */

/**
 * @typedef {{ getKey: (id: string) => Promise<{ raw?: Uint8Array } | undefined | null> }} SigningKeystore
 */

/** @type {Map<string, Promise<DeviceKeys>>} */
const cache = new Map();

/**
 * Pairs without PRF in memory mode, by identity: kept for the tab and nowhere
 * else. Apart from `cache`, which every setup replaces, so that a restart of
 * the node in the same tab (a second consent) finds the same pair.
 *
 * @type {Map<string, DeviceKeyPair>}
 */
const tabPairs = new Map();

/**
 * Settle this identity's pair for the session.
 *
 * Called once the identity exists and before anything asks for its pair
 * (p2p.js), with the PRF output when the passkey gave one. Without one the pair
 * is the one kept in this browser.
 *
 * @param {string} identityId the OrbitDB identity this pair belongs to
 * @param {{ prfOutput?: Uint8Array | null, keystore?: SigningKeystore | null }} [from]
 * @returns {Promise<DeviceKeys>}
 */
export function setUpDeviceKeys(identityId, { prfOutput = null, keystore = null } = {}) {
	const keys = makeKeys(identityId, prfOutput, keystore);
	cache.set(identityId, keys);
	keys.catch(() => {
		// Not cached as a failure: the next call may succeed.
		if (cache.get(identityId) === keys) cache.delete(identityId);
	});
	return keys;
}

/**
 * This identity's pair: the one `setUpDeviceKeys` settled, or — for an identity
 * nobody set up, the one without a passkey — the pair kept in this browser.
 *
 * @param {string} identityId
 * @param {{ keystore?: SigningKeystore | null }} [from] where the identity's signing key is
 * @returns {Promise<DeviceKeys>}
 */
export function ownDeviceKeys(identityId, { keystore = null } = {}) {
	return cache.get(identityId) ?? setUpDeviceKeys(identityId, { keystore });
}

/**
 * @param {string} identityId
 * @param {Uint8Array | null} prfOutput
 * @param {SigningKeystore | null} keystore
 * @returns {Promise<DeviceKeys>}
 */
async function makeKeys(identityId, prfOutput, keystore) {
	forgetLegacy(identityId);
	if (prfOutput) {
		const current = await pairFromPrf(prfOutput);
		// With the passkey's PRF there is no reason left to keep a pair here.
		tabPairs.delete(identityId);
		await withStore('readwrite', (store) => store.delete(identityId));
		return { ...current, source: 'prf', earlier: await pairsFromSigningKey(identityId, keystore) };
	}

	const current = await keptOrNewPair(identityId);
	return {
		...current,
		source: 'browser',
		earlier: await pairsFromSigningKey(identityId, keystore)
	};
}

/**
 * The pair that follows from a passkey's PRF output, and only from it.
 *
 * @param {Uint8Array} prfOutput from `readPrfOutput`, at least 32 bytes
 * @returns {Promise<DeviceKeyPair>}
 */
export async function pairFromPrf(prfOutput) {
	return pairFromSeed(await deriveSubkey(prfOutput, KEY_AGREEMENT_INFO));
}

/**
 * The pair this chapter derived from the signing key between #120 and the PRF
 * derivation above. Kept bit for bit, because copies sealed to it are still in
 * the store; only read with, never published.
 *
 * @param {string} identityId
 * @param {Uint8Array} signingKey the raw private key, as the keystore holds it
 * @returns {Promise<DeviceKeyPair>}
 */
export async function pairFromSigningKey(identityId, signingKey) {
	const material = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (signingKey),
		'HKDF',
		false,
		['deriveBits']
	);
	const seed = new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: new Uint8Array(0),
				info: new TextEncoder().encode(`privacy01/encryption-key/1|${identityId}`)
			},
			material,
			256
		)
	);
	return pairFromSeed(seed);
}

/**
 * @param {string} identityId
 * @param {SigningKeystore | null} keystore
 * @returns {Promise<DeviceKeyPair[]>}
 */
async function pairsFromSigningKey(identityId, keystore) {
	try {
		const signingKey = await keystore?.getKey?.(identityId);
		if (signingKey?.raw instanceof Uint8Array && signingKey.raw.length >= 32) {
			return [await pairFromSigningKey(identityId, signingKey.raw)];
		}
	} catch {
		// No keystore to ask, or nothing under this id: nothing earlier to read with.
	}
	return [];
}

/**
 * @param {Uint8Array} seed 32 bytes
 * @returns {Promise<DeviceKeyPair>}
 */
async function pairFromSeed(seed) {
	const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + seed.length);
	pkcs8.set(PKCS8_PREFIX, 0);
	pkcs8.set(seed, PKCS8_PREFIX.length);

	try {
		// Imported twice: once extractable, only to read the public half off it,
		// and once for use, which nothing can export again.
		const readable = await crypto.subtle.importKey('pkcs8', pkcs8, ALGORITHM, true, ['deriveBits']);
		const { kty, crv, x } = await crypto.subtle.exportKey('jwk', readable);
		const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, ALGORITHM, false, [
			'deriveBits'
		]);

		return { privateKey, publicKey: encode({ kty, crv, x }) };
	} finally {
		pkcs8.fill(0);
		seed.fill(0);
	}
}

/**
 * The pair this browser keeps for an identity without PRF, or a new one.
 *
 * Generated as a key that cannot be exported: its bytes never exist outside
 * WebCrypto. Kept where the storage choice says — IndexedDB when things are
 * kept, this tab otherwise. A reader who switches to keeping things takes the
 * tab's pair along, so copies already sealed to it still open.
 *
 * @param {string} identityId
 * @returns {Promise<DeviceKeyPair>}
 */
async function keptOrNewPair(identityId) {
	const persistent = getPersistentStorageEnabled();
	if (persistent) {
		const kept = await withStore('readonly', (store) => store.get(identityId));
		if (isKept(kept)) return { privateKey: kept.privateKey, publicKey: kept.publicKey };
	}

	const pair = tabPairs.get(identityId) ?? (await newPair());
	if (!persistent) {
		tabPairs.set(identityId, pair);
		return pair;
	}

	tabPairs.delete(identityId);
	const written = await withStore('readwrite', (store) => store.put(pair, identityId), {
		create: true
	});
	// A browser that refuses IndexedDB still has the pair for this tab; the next
	// visit makes another, and copies sealed to this one are lost then.
	if (written === undefined) tabPairs.set(identityId, pair);
	return pair;
}

/** @returns {Promise<DeviceKeyPair>} */
async function newPair() {
	const generated = /** @type {CryptoKeyPair} */ (
		await crypto.subtle.generateKey(ALGORITHM, false, ['deriveBits'])
	);
	const { kty, crv, x } = await crypto.subtle.exportKey('jwk', generated.publicKey);
	return { privateKey: generated.privateKey, publicKey: encode({ kty, crv, x }) };
}

/** @param {any} value @returns {value is DeviceKeyPair} */
function isKept(value) {
	return (
		value?.privateKey instanceof CryptoKey &&
		value.privateKey.algorithm?.name === ALGORITHM.name &&
		value.privateKey.type === 'private' &&
		typeof value.publicKey === 'string' &&
		value.publicKey.length > 0
	);
}

/**
 * Read somebody else's published key.
 *
 * @param {string} value the string a directory entry carried
 * @returns {Promise<CryptoKey>}
 */
export async function importDeviceKey(value) {
	return crypto.subtle.importKey('jwk', decode(value), ALGORITHM, true, []);
}

/**
 * For tests, and for a sign-out that must not leave the next identity this key.
 *
 * @param {string} identityId
 * @returns {Promise<void>}
 */
export async function forgetDeviceKeys(identityId) {
	cache.delete(identityId);
	tabPairs.delete(identityId);
	forgetLegacy(identityId);
	await withStore('readwrite', (store) => store.delete(identityId));
}

/** @param {string} identityId */
function forgetLegacy(identityId) {
	try {
		forget(`${LEGACY_STORAGE_PREFIX}${identityId}`);
	} catch {
		// Nothing to clean up without storage.
	}
}

/** @param {any} jwk */
function encode(jwk) {
	return btoa(JSON.stringify(jwk));
}

/** @param {string} value */
function decode(value) {
	return JSON.parse(atob(value));
}

/**
 * One request against the store of kept pairs. Resolves to the request's
 * result, or to undefined when IndexedDB is missing or refuses — private modes
 * do, and a refusal must not stop the start.
 *
 * Only a write may create the database. Opening one creates it, so a read or a
 * delete first asks whether it is there: otherwise every session with PRF, and
 * every session in memory mode, would leave an empty database behind on a
 * device that was promised nothing.
 *
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @param {{ create?: boolean }} [options]
 * @returns {Promise<any>}
 */
async function withStore(mode, run, { create = false } = {}) {
	if (typeof indexedDB === 'undefined') return undefined;
	/** @type {IDBDatabase | undefined} */
	let database;
	try {
		if (!create && !(await databaseExists())) return undefined;
		database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(DEVICE_KEY_DATABASE, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(STORE);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('blocked'));
		});
		const db = /** @type {IDBDatabase} */ (database);
		return await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE, mode);
			const request = run(transaction.objectStore(STORE));
			/** @type {any} */
			let result;
			request.onsuccess = () => (result = request.result ?? null);
			transaction.oncomplete = () => resolve(result);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} catch {
		return undefined;
	} finally {
		database?.close();
	}
}

/**
 * Whether the store of kept pairs exists, without creating it. A browser that
 * cannot list its databases is taken to have it — the open then creates an
 * empty one, which is the lesser harm than leaving a kept key undeleted.
 */
async function databaseExists() {
	if (typeof indexedDB.databases !== 'function') return true;
	try {
		return (await indexedDB.databases()).some(({ name }) => name === DEVICE_KEY_DATABASE);
	} catch {
		return true;
	}
}
