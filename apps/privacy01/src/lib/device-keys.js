// The key pair that lets somebody else hand this identity a database key.
//
// Ported from Le-Space/yogasuci `src/lib/db/device-keys.js`
// (Le-Space/yogasuci#95), which is where this shipped first, and changed in
// one way that matters (#120).
//
// Separate from the identity key, and that separation is not incidental. The
// identity signs; it has no key agreement. A database key has to *reach* a
// second reader, which needs agreement, so this is a second pair with one job:
// unwrapping what was sealed for it (#277 phase 2).
//
// **Derived, not generated.** The pair used to be random and kept in local
// storage, which made it a property of one browser: the same passkey on a
// second device — or this browser after its storage was cleared — had a
// different pair, could not open a single copy sealed for the old one, and so
// could not read its owner's own lists. Now it comes from the identity's
// signing key, through HKDF with a label of its own. That signing key is what
// the passkey provider derives from the passkey's PRF output, again on every
// device and in every session, so one passkey means one encryption key
// everywhere, and nothing secret has to be written down for it.
//
// X25519 rather than P-256, for exactly that reason: an X25519 private key is
// any 32 bytes, so a derived seed is a key as it stands. WebCrypto has no way to
// turn 32 bytes into a P-256 key without curve arithmetic of our own.
//
// Scoped by identity rather than by browser. Two passkeys in one browser are
// two people as far as this chapter is concerned, and what was sealed for one
// must not open for the other.
//
// Without a signing key to derive from — a test, or an identity whose keystore
// has nothing under its id — a random pair is made and remembered the way it
// used to be. That one is again only as durable as the browser it lives in.

import { forget, recall, remember } from '@simple-todo/todo/browser-memory.js';

const STORAGE_PREFIX = 'privacy01.deviceKey.';
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
 * @typedef {{ getKey: (id: string) => Promise<{ raw?: Uint8Array } | undefined | null> }} SigningKeystore
 */

/** @type {Map<string, Promise<DeviceKeyPair>>} */
const cache = new Map();

/** @param {string} identityId */
const storageKeyFor = (identityId) => `${STORAGE_PREFIX}${identityId}`;

/**
 * This identity's encryption key pair.
 *
 * @param {string} identityId the OrbitDB identity this pair belongs to
 * @param {{ keystore?: SigningKeystore | null }} [from] where the identity's signing key is
 * @returns {Promise<DeviceKeyPair>}
 */
export function ownDeviceKeys(identityId, { keystore } = {}) {
	const cached = cache.get(identityId);
	if (cached) return cached;

	const pair = makePair(identityId, keystore).catch((error) => {
		// Not cached as a failure: the next call may find the keystore ready.
		cache.delete(identityId);
		throw error;
	});
	cache.set(identityId, pair);
	return pair;
}

/**
 * @param {string} identityId
 * @param {SigningKeystore | null | undefined} keystore
 * @returns {Promise<DeviceKeyPair>}
 */
async function makePair(identityId, keystore) {
	const signingKey = await keystore?.getKey?.(identityId);
	if (signingKey?.raw instanceof Uint8Array && signingKey.raw.length >= 32) {
		// A pair from an earlier version of this chapter is no longer needed, and
		// it was a private key in local storage. Gone, now that nothing reads it.
		forgetStored(identityId);
		return derivedPair(identityId, signingKey.raw);
	}

	return storedOrNewPair(identityId);
}

/**
 * The pair that follows from a signing key, and only from it.
 *
 * @param {string} identityId
 * @param {Uint8Array} signingKey the raw private key, as the keystore holds it
 * @returns {Promise<DeviceKeyPair>}
 */
export async function derivedPair(identityId, signingKey) {
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
				// What this secret is for and whose it is. The signing key itself
				// signs entries; a label of its own keeps the two uses apart.
				info: new TextEncoder().encode(`privacy01/encryption-key/1|${identityId}`)
			},
			material,
			256
		)
	);

	const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + seed.length);
	pkcs8.set(PKCS8_PREFIX, 0);
	pkcs8.set(seed, PKCS8_PREFIX.length);

	// Imported twice: once extractable, only to read the public half off it, and
	// once for use, which nothing can export again.
	const readable = await crypto.subtle.importKey('pkcs8', pkcs8, ALGORITHM, true, ['deriveBits']);
	const { kty, crv, x } = await crypto.subtle.exportKey('jwk', readable);
	const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, ALGORITHM, false, [
		'deriveBits'
	]);

	return { privateKey, publicKey: encode({ kty, crv, x }) };
}

/**
 * @param {string} identityId
 * @returns {Promise<DeviceKeyPair>}
 */
async function storedOrNewPair(identityId) {
	const stored = read(identityId);
	if (stored) {
		try {
			return {
				privateKey: await crypto.subtle.importKey('jwk', stored.privateKey, ALGORITHM, false, [
					'deriveBits'
				]),
				publicKey: stored.publicKey
			};
		} catch {
			// A P-256 pair from before #120, or something else wrote here. A new
			// pair replaces it; copies sealed for the old one are lost either way.
		}
	}

	const generated = /** @type {CryptoKeyPair} */ (
		await crypto.subtle.generateKey(ALGORITHM, true, ['deriveBits'])
	);
	const privateKey = await crypto.subtle.exportKey('jwk', generated.privateKey);
	const { kty, crv, x } = await crypto.subtle.exportKey('jwk', generated.publicKey);
	const publicKey = encode({ kty, crv, x });

	write(identityId, { privateKey, publicKey });

	return { privateKey: generated.privateKey, publicKey };
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
 */
export function forgetDeviceKeys(identityId) {
	cache.delete(identityId);
	forgetStored(identityId);
}

/** @param {string} identityId */
function forgetStored(identityId) {
	try {
		forget(storageKeyFor(identityId));
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
 * @param {string} identityId
 * @returns {{ privateKey: any, publicKey: string } | null}
 */
function read(identityId) {
	try {
		const raw = recall(storageKeyFor(identityId));
		return raw ? JSON.parse(raw) : null;
	} catch {
		// Storage denied, or something else wrote here. A new pair is made
		// instead, which costs this identity every key already wrapped for its
		// old one — it has to be granted again. Loud would be worse: there is
		// nothing the reader could do about it here.
		return null;
	}
}

/**
 * @param {string} identityId
 * @param {{ privateKey: any, publicKey: string }} pair
 */
function write(identityId, pair) {
	try {
		remember(storageKeyFor(identityId), JSON.stringify(pair));
	} catch {
		// The pair still works for this page load; the next one makes another.
	}
}
