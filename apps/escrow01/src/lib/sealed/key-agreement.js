/**
 * The personal X25519 key, and handing a list key to one reader (#127).
 *
 * A list key (`K_L`) or task key (`K_T`) is one secret for everyone who may
 * read. Getting it to them is what this does: each copy is sealed to one
 * reader's public X25519 key, published in the account directory under the
 * reader's DID (chain/account-directory.js). The owner can do that for a
 * reader who is offline; the reader needs nothing but his own private key.
 *
 * **The personal key comes from the passkey.** Its 32 bytes are
 * `deriveSubkey(prf, 'simple-todo/escrow01/list-key-agreement/v1')` (provider
 * 0.13.0, `./vault`): HKDF over the passkey's PRF output, under an info string
 * of its own, so it is independent of the OrbitDB signing key and of the read
 * key's seal, which come from the same output under other infos. The same
 * passkey yields the same key on every device, and nothing secret has to be
 * stored for it. Without PRF there is no such output; then the 32 bytes are
 * random and kept in the browser (./own-agreement-key.js).
 *
 * X25519 because any 32 bytes are a private key: a derived seed is imported as
 * it stands. WebCrypto cannot make a P-256 key out of 32 bytes.
 *
 * **Wrapping:** an ephemeral X25519 pair on the sending side, ECDH with the
 * reader's public key, HKDF-SHA-256 over the shared secret, AES-GCM over the
 * key. A fresh sender pair per copy keeps every copy independent; with a
 * static one, the same two people would share one secret for every wrap. The
 * HKDF info names both public keys, and the copy's slot in the key store is
 * the associated data, so a copy moved to another slot or another reader does
 * not open.
 *
 * A handed-over key stays handed over. Removing a reader therefore means a new
 * epoch (./key-ring.js), wrapped again for everyone who stays.
 */
import { deriveSubkey } from '@le-space/orbitdb-identity-provider-webauthn-did/vault';
import { base64OrNull, fromBase64, toBase64, utf8 } from './bytes.js';

/** Changing this changes everyone's key: every copy sealed for the old one is lost. */
export const LIST_KEY_AGREEMENT_INFO = 'simple-todo/escrow01/list-key-agreement/v1';

/** Changing this makes every wrapped copy unreadable: treat it as breaking. */
const WRAP_INFO = 'simple-todo/escrow01/key-wrap/v1';

const X25519 = { name: 'X25519' };
const PUBLIC_KEY_BYTES = 32;
const SEED_BYTES = 32;
const NONCE_BYTES = 12;
const WRAPPED_KEY_BYTES = 32;
const TAG_BYTES = 16;

/**
 * An X25519 private key in PKCS#8 (RFC 8410) is this fixed prefix and the 32
 * key bytes, so a seed imports without any curve arithmetic of our own.
 */
const PKCS8_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20
]);

/**
 * Where the private half came from: the passkey's PRF output, or random bytes
 * kept in this browser.
 *
 * @typedef {'prf' | 'device'} AgreementKeySource
 */

/**
 * @typedef {object} AgreementKey
 * @property {CryptoKey} privateKey X25519, not extractable
 * @property {Uint8Array} publicKey 32 bytes, what the directory publishes
 * @property {AgreementKeySource} source
 */

/**
 * One copy of a key, sealed for one reader.
 *
 * @typedef {object} WrappedKey
 * @property {1} v
 * @property {string} epk base64, the sender's one-off public key
 * @property {string} nonce base64, 12 bytes
 * @property {string} ct base64, the key and the tag
 */

/**
 * The personal key for a PRF output. No passkey prompt: the caller hands in an
 * output it already read.
 *
 * @param {Uint8Array} prfOutput at least 32 bytes
 * @returns {Promise<AgreementKey>}
 */
export async function agreementKeyFromPrf(prfOutput) {
	const seed = await deriveSubkey(prfOutput, LIST_KEY_AGREEMENT_INFO);
	try {
		return await agreementKeyFromSeed(seed, 'prf');
	} finally {
		seed.fill(0);
	}
}

/**
 * The key pair for 32 seed bytes.
 *
 * @param {Uint8Array} seed
 * @param {AgreementKeySource} source
 * @returns {Promise<AgreementKey>}
 */
export async function agreementKeyFromSeed(seed, source) {
	if (!(seed instanceof Uint8Array) || seed.length !== SEED_BYTES) {
		throw new TypeError(`An X25519 seed is ${SEED_BYTES} bytes.`);
	}
	const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + SEED_BYTES);
	pkcs8.set(PKCS8_PREFIX, 0);
	pkcs8.set(seed, PKCS8_PREFIX.length);
	try {
		// Once extractable, only to read the public half out of the JWK; the key
		// this returns is a second import that cannot be exported.
		const readable = await crypto.subtle.importKey(
			'pkcs8',
			/** @type {BufferSource} */ (pkcs8),
			X25519,
			true,
			['deriveBits']
		);
		const { x } = await crypto.subtle.exportKey('jwk', readable);
		const publicKey = fromBase64Url(/** @type {string} */ (x));
		const privateKey = await crypto.subtle.importKey(
			'pkcs8',
			/** @type {BufferSource} */ (pkcs8),
			X25519,
			false,
			['deriveBits']
		);
		return { privateKey, publicKey, source };
	} finally {
		pkcs8.fill(0);
	}
}

/**
 * Seal a key for one reader.
 *
 * @param {Uint8Array} key the 32 key bytes (`K_L` or `K_T`)
 * @param {Uint8Array} recipientPublicKey 32 bytes, from the reader's directory entry
 * @param {{ slot: string }} where the slot the copy is stored under (./key-store.js)
 * @returns {Promise<WrappedKey>}
 */
export async function wrapKey(key, recipientPublicKey, { slot }) {
	if (!(key instanceof Uint8Array) || key.length !== WRAPPED_KEY_BYTES) {
		throw new TypeError(`Only a ${WRAPPED_KEY_BYTES}-byte key is wrapped.`);
	}
	assertSlot(slot);
	const recipient = await importPublicKey(recipientPublicKey);
	const sender = /** @type {CryptoKeyPair} */ (
		await crypto.subtle.generateKey(X25519, true, ['deriveBits'])
	);
	const epk = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
	const kek = await wrappingKey(sender.privateKey, recipient, epk, recipientPublicKey, ['encrypt']);

	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const ct = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: /** @type {BufferSource} */ (nonce),
			additionalData: /** @type {BufferSource} */ (utf8(`${WRAP_INFO}\n${slot}`))
		},
		kek,
		/** @type {BufferSource} */ (key)
	);
	return { v: 1, epk: toBase64(epk), nonce: toBase64(nonce), ct: toBase64(new Uint8Array(ct)) };
}

/**
 * Open a copy sealed for this reader.
 *
 * Throws when it was sealed for somebody else, for another slot, or altered:
 * AES-GCM gives the same answer to all three, and all three must stay a throw.
 * A caller handed back nothing instead might seal with a key of its own making,
 * and write entries nobody else can read.
 *
 * @param {unknown} copy a value read from the key store
 * @param {AgreementKey} own
 * @param {{ slot: string }} where
 * @returns {Promise<Uint8Array>} the 32 key bytes
 */
export async function unwrapKey(copy, own, { slot }) {
	if (!isWrappedKey(copy)) throw new TypeError('Not a wrapped key.');
	assertSlot(slot);
	const epk = /** @type {Uint8Array} */ (base64OrNull(copy.epk));
	const nonce = /** @type {Uint8Array} */ (base64OrNull(copy.nonce));
	const ct = /** @type {Uint8Array} */ (base64OrNull(copy.ct));

	const sender = await importPublicKey(epk);
	const kek = await wrappingKey(own.privateKey, sender, epk, own.publicKey, ['decrypt']);
	const key = new Uint8Array(
		await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: /** @type {BufferSource} */ (nonce),
				additionalData: /** @type {BufferSource} */ (utf8(`${WRAP_INFO}\n${slot}`))
			},
			kek,
			/** @type {BufferSource} */ (ct)
		)
	);
	if (key.length !== WRAPPED_KEY_BYTES) throw new TypeError('A wrapped key opened to the wrong size.');
	return key;
}

/**
 * @param {unknown} value
 * @returns {value is WrappedKey}
 */
export function isWrappedKey(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = /** @type {Record<string, unknown>} */ (value);
	if (candidate.v !== 1) return false;
	const epk = base64OrNull(candidate.epk);
	const nonce = base64OrNull(candidate.nonce);
	const ct = base64OrNull(candidate.ct);
	return (
		epk?.length === PUBLIC_KEY_BYTES &&
		nonce?.length === NONCE_BYTES &&
		ct?.length === WRAPPED_KEY_BYTES + TAG_BYTES
	);
}

/**
 * A public key as the directory publishes it, or null.
 *
 * @param {unknown} value base64 of 32 bytes
 * @returns {Uint8Array | null}
 */
export function publicKeyFromText(value) {
	const bytes = base64OrNull(value);
	return bytes?.length === PUBLIC_KEY_BYTES ? bytes : null;
}

/** @param {Uint8Array} publicKey */
export const publicKeyToText = (publicKey) => toBase64(publicKey);

/**
 * The AES key both sides reach from one agreement. Through HKDF: an agreement
 * result is not uniformly random, whatever its length.
 *
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} publicKey
 * @param {Uint8Array} epk the sender's public key
 * @param {Uint8Array} rpk the recipient's public key
 * @param {KeyUsage[]} usages
 */
async function wrappingKey(privateKey, publicKey, epk, rpk, usages) {
	// Throws for a low-order public key, whose agreement is all zeros.
	const secret = await crypto.subtle.deriveBits(
		{ name: 'X25519', public: publicKey },
		privateKey,
		256
	);
	const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
	const label = utf8(WRAP_INFO);
	const info = new Uint8Array(label.length + epk.length + rpk.length);
	info.set(label, 0);
	info.set(epk, label.length);
	info.set(rpk, label.length + epk.length);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		usages
	);
}

/** @param {Uint8Array} bytes */
async function importPublicKey(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length !== PUBLIC_KEY_BYTES) {
		throw new TypeError(`An X25519 public key is ${PUBLIC_KEY_BYTES} bytes.`);
	}
	return crypto.subtle.importKey('raw', /** @type {BufferSource} */ (bytes), X25519, true, []);
}

/** @param {unknown} slot */
function assertSlot(slot) {
	if (typeof slot !== 'string' || slot.length === 0) {
		throw new TypeError('A wrapped key needs the slot it is stored under.');
	}
}

/** @param {string} text */
function fromBase64Url(text) {
	const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
	return fromBase64(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
}
