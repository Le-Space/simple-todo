/**
 * Where this session's personal X25519 key comes from, and where it is kept
 * (#127).
 *
 * - **With PRF:** derived from the passkey's PRF output (./key-agreement.js).
 *   On a first start the app reads that output itself and hands the same bytes
 *   to the identity provider (`prfOutput`), so the passkey is asked no more
 *   often than before. After a restore from the authenticator the provider
 *   (0.13.0) does not hand its output out, and the app asks once more.
 * - **Without PRF** — GrapheneOS, Android without Play services, a copied
 *   credential: there is nothing to derive from, so the key is random and this
 *   browser is the only place it exists. The app says so, and recommends a
 *   browser without extensions or a profile of its own (user decision,
 *   25.11.2026).
 *
 * **Kept as a CryptoKey that cannot be exported** (user decision, 26.11.2026).
 * With "Keep in this browser" the private key goes into IndexedDB as it is: a
 * script on the page can use it to open a copy sealed for it, but cannot read
 * its bytes, and nothing sends them anywhere. That is why a return asks the
 * passkey nothing for sealed lists. With "In memory only" nothing is written;
 * the key lives in this module and dies with the tab.
 *
 * The database sits under the prefix `wipePersistentStorage()` owns
 * (`level-js-simple-todo/`), so switching to "nothing on this device" deletes
 * it with the rest.
 */
import { getPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
import { agreementKeyFromPrf } from './key-agreement.js';

/** Under the prefix the storage wipe deletes; see the module comment. */
export const AGREEMENT_KEY_DATABASE = 'level-js-simple-todo/escrow01/agreement-keys';
const STORE = 'keys';

/** The keys of an in-memory session, by DID. @type {Map<string, import('./key-agreement.js').AgreementKey>} */
const session = new Map();

/**
 * This session's key.
 *
 * In this order: a PRF output the caller already holds; a key this browser
 * kept; one `readPrfOutput()` — a passkey prompt, so only ever behind a click —
 * which answers null for an authenticator without PRF, and then a device key
 * is made. With nothing of that at hand the answer is null: making a device key
 * here would quietly replace a passkey's key, and lock its owner out of every
 * copy sealed for it.
 *
 * @param {{
 *   did: string,
 *   prfOutput?: Uint8Array | null,
 *   readPrfOutput?: (() => Promise<Uint8Array | null>) | null
 * }} options
 * @returns {Promise<import('./key-agreement.js').AgreementKey | null>}
 */
export async function ownAgreementKey({ did, prfOutput = null, readPrfOutput = null }) {
	assertDid(did);
	if (prfOutput) return keep(did, await agreementKeyFromPrf(prfOutput));

	const kept = await keptAgreementKey(did);
	if (kept) return kept;
	if (!readPrfOutput) return null;

	const read = await readPrfOutput();
	return keep(did, read ? await agreementKeyFromPrf(read) : await newDeviceAgreementKey());
}

/**
 * The key this browser holds for `did`, without asking anything.
 *
 * @param {string} did
 * @returns {Promise<import('./key-agreement.js').AgreementKey | null>}
 */
export async function keptAgreementKey(did) {
	assertDid(did);
	const inSession = session.get(did);
	if (inSession) return inSession;
	const stored = await withStore('readonly', (store) => store.get(did));
	return isKept(stored) ? stored : null;
}

/**
 * Drop the key for `did`. With a passkey it comes back from the PRF output;
 * a device key does not, and the lists sealed only for it stay closed.
 *
 * @param {string} did
 */
export async function forgetAgreementKey(did) {
	assertDid(did);
	session.delete(did);
	await withStore('readwrite', (store) => store.delete(did));
}

/**
 * A random key for an authenticator without PRF. Generated as a key that
 * cannot be exported; its bytes never exist outside WebCrypto.
 *
 * @returns {Promise<import('./key-agreement.js').AgreementKey>}
 */
async function newDeviceAgreementKey() {
	const pair = /** @type {CryptoKeyPair} */ (
		await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
	);
	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	return { privateKey: pair.privateKey, publicKey, source: 'device' };
}

/**
 * Keep the key where the storage choice says, and hand it back.
 *
 * @param {string} did
 * @param {import('./key-agreement.js').AgreementKey} key
 */
async function keep(did, key) {
	if (!getPersistentStorageEnabled()) {
		session.set(did, key);
		return key;
	}
	session.delete(did);
	const written = await withStore('readwrite', (store) => store.put(key, did));
	// A browser that refuses IndexedDB still gets the key for this visit.
	if (written === undefined) session.set(did, key);
	return key;
}

/** @param {any} value @returns {value is import('./key-agreement.js').AgreementKey} */
function isKept(value) {
	return (
		value?.privateKey instanceof CryptoKey &&
		value.privateKey.algorithm?.name === 'X25519' &&
		value.publicKey instanceof Uint8Array &&
		value.publicKey.length === 32 &&
		(value.source === 'prf' || value.source === 'device')
	);
}

/**
 * One request against the key store. Resolves to the request's result, or to
 * undefined when IndexedDB is missing or refuses (private modes do).
 *
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @returns {Promise<any>}
 */
async function withStore(mode, run) {
	if (typeof indexedDB === 'undefined') return undefined;
	/** @type {IDBDatabase | undefined} */
	let database;
	try {
		database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(AGREEMENT_KEY_DATABASE, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(STORE);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('blocked'));
		});
		const db = /** @type {IDBDatabase} */ (database);
		return await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE, mode);
			const request = run(transaction.objectStore(STORE));
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

/** @param {unknown} did */
function assertDid(did) {
	if (typeof did !== 'string' || did.length === 0) {
		throw new TypeError('A personal key belongs to one identity.');
	}
}
