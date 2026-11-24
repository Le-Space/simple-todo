// Handing a database key to somebody without ever putting it in the open.
//
// Ported from Le-Space/yogasuci `src/lib/db/wrapping.js`
// (Le-Space/yogasuci#95), including the reasoning below, which is the part
// that is easy to get wrong quietly.
//
// A database key is one symmetric secret shared by everyone who may read
// (./db-encryption.js). Getting it to them is what needs care: it cannot
// travel in the clear, and it has to be possible to address a reader who is
// not here — an owner grants a DID, and the device behind it may be offline
// for a week.
//
// So each copy is sealed to one recipient's published key (./device-keys.js).
// X25519 key agreement with an ephemeral pair on the sending side, HKDF over
// the shared secret, AES-GCM over the database key. The ephemeral public half
// travels with the ciphertext; the recipient needs nothing but its own private
// key. (ECDH P-256 until #120, which derives the recipient's pair from the
// passkey — see ./device-keys.js for why that wants X25519.)
//
// Ephemeral rather than a long-term pair on both sides, and that is the reason
// for the extra key: with a static sender the same two devices would derive
// the same secret for every wrap, and one nonce mistake would then repeat
// across all of them. A fresh sender key per wrap keeps each independent.
//
// What this cannot do is take a key back. A key handed over stays handed over —
// removing a reader therefore means a new database key, wrapped again for the
// rest (`rotateKey` in ./shared-keys.js, on every revoke, #120), and everything
// written under the old one stays readable to whoever kept it. That is what a
// shared secret is, and the chapter text has to say so rather than a button
// implying otherwise.

const NONCE_BYTES = 12;
const ALGORITHM = { name: 'X25519' };

/**
 * @typedef {object} WrappedKey
 * @property {string} wrapped base64: nonce ‖ ciphertext
 * @property {string} ephemeral base64 JWK of the one-off public key it was sealed with
 */

/**
 * Seal a database key for one recipient.
 *
 * @param {Uint8Array} databaseKey
 * @param {CryptoKey} recipientPublicKey as published by ./device-keys.js
 * @returns {Promise<WrappedKey>}
 */
export async function wrapKey(databaseKey, recipientPublicKey) {
	const sender = /** @type {CryptoKeyPair} */ (
		await crypto.subtle.generateKey(ALGORITHM, true, ['deriveBits'])
	);
	const key = await sharedKey(sender.privateKey, recipientPublicKey, ['encrypt']);

	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: /** @type {BufferSource} */ (nonce) },
			key,
			/** @type {BufferSource} */ (databaseKey)
		)
	);

	const out = new Uint8Array(nonce.length + sealed.length);
	out.set(nonce, 0);
	out.set(sealed, nonce.length);

	const { kty, crv, x } = await crypto.subtle.exportKey('jwk', sender.publicKey);
	return { wrapped: toBase64(out), ephemeral: toBase64Json({ kty, crv, x }) };
}

/**
 * Open a key that was sealed for this identity.
 *
 * Throws when it was sealed for somebody else or altered on the way — both are
 * the same answer from AES-GCM, and both must stay a throw. A caller handed
 * nothing back instead would open a database with a key of its own making and
 * write entries nobody else can read.
 *
 * @param {WrappedKey} copy
 * @param {CryptoKey} ownPrivateKey
 * @returns {Promise<Uint8Array>}
 */
export async function unwrapKey({ wrapped, ephemeral }, ownPrivateKey) {
	const sender = await crypto.subtle.importKey(
		'jwk',
		fromBase64Json(ephemeral),
		ALGORITHM,
		true,
		[]
	);
	const key = await sharedKey(ownPrivateKey, sender, ['decrypt']);
	const bytes = fromBase64(wrapped);

	if (bytes.length <= NONCE_BYTES) throw new Error('Not a wrapped key.');

	return new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: /** @type {BufferSource} */ (bytes.subarray(0, NONCE_BYTES)) },
			key,
			/** @type {BufferSource} */ (bytes.subarray(NONCE_BYTES))
		)
	);
}

/**
 * The AES key both sides reach from one X25519 agreement.
 *
 * Through HKDF rather than using the shared secret directly: an agreement result
 * is not uniformly distributed and is not a key, whatever its length suggests.
 *
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} publicKey
 * @param {KeyUsage[]} usages
 */
async function sharedKey(privateKey, publicKey, usages) {
	const secret = await crypto.subtle.deriveBits(
		{ name: 'X25519', public: publicKey },
		privateKey,
		256
	);
	const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);

	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			// Names what this key is for, so a secret derived here can never be
			// mistaken for one derived for another purpose later. Chapter-specific
			// on purpose: a wrap from yogasuci must not open here and vice versa.
			// Version 2 since the curve changed (#120); a version-1 copy cannot
			// open under it, and should not.
			info: new TextEncoder().encode('privacy01/database-key-wrap/2')
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		usages
	);
}

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

/** @param {string} value */
function fromBase64(value) {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** @param {any} value */
function toBase64Json(value) {
	return btoa(JSON.stringify(value));
}

/** @param {string} value */
function fromBase64Json(value) {
	return JSON.parse(atob(value));
}
