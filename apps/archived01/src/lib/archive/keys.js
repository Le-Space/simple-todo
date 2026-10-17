// The archive's keys, both from the passkey (archived01).
//
// One PRF output, read once per session with the passkey, gives two things
// through HKDF under two different info strings:
//
//   - the **archive account**: a secp256k1 key whose address is an ordinary
//     Ethereum account. Aleph accepts STORE messages signed by it
//     (`personal_sign`, EIP-191) and books their cost to it, so credits on
//     that address are what keeps the increments — no wallet extension, no
//     MetaMask, nothing to install. The key is never stored: it is derived
//     again on every unlock and lives in memory until the tab closes.
//   - the **backup key**: AES-GCM, non-extractable, sealing every increment
//     before it leaves the browser. The service holds ciphertext.
//
// The derivations are the provider's own (`deriveSubkey`, `deriveAesKey`, the
// HKDF that belege, invoice and the provider's signing key run on), so the
// same passkey gives the same address and the same key on every device — and
// a second device finds the archive with nothing but the passkey.
//
// A smart-account passkey wallet (escrow01's `@le-space/passkey-wallet`, a
// Calibur account) is not usable here: Aleph recovers the signer with
// `ecrecover`, so only a secp256k1 key of its own will do.

import { deriveSubkey, deriveAesKey } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { privateKeyToAccount } from 'viem/accounts';

/** Bumping either rotates every key and address, so treat it as a breaking change. */
export const ALEPH_ACCOUNT_INFO = 'simple-todo/archived01/aleph-account/v1';
export const BACKUP_KEY_INFO = 'simple-todo/archived01/backup-key/v1';
/** The key behind {@link listRefFor}: bumping renames every list's chain at the store. */
export const LIST_REF_KEY_INFO = 'simple-todo/archived01/list-ref-key/v1';

/** @param {Uint8Array} bytes */
const hex = (bytes) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;

/**
 * @typedef {object} ArchiveKeys
 * @property {string} address - the archive account, EIP-55 checksummed (Aleph keys accounts by it)
 * @property {(message: string) => Promise<string>} sign - `personal_sign` of a text, 0x-hex
 * @property {CryptoKey} aesKey - the backup key, AES-GCM, non-extractable
 * @property {CryptoKey} refKey - HMAC-SHA-256, non-extractable: names a list's chain at the store ({@link listRefFor})
 */

/**
 * Both keys from one PRF output.
 *
 * A 32-byte HKDF output is a valid secp256k1 scalar unless it is zero or at
 * least the curve order, which happens about once in 2^128 draws; the counter
 * in the info string keeps the derivation total rather than probabilistic,
 * the way the provider derives its signing key.
 *
 * @param {Uint8Array} prfOutput - from `readPrfOutput`
 * @returns {Promise<ArchiveKeys>}
 */
export async function deriveArchiveKeys(prfOutput) {
	if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 32) {
		throw new TypeError('deriveArchiveKeys needs the PRF output: at least 32 bytes');
	}
	let account = null;
	for (let counter = 0; counter < 256 && !account; counter++) {
		const scalar = await deriveSubkey(prfOutput, `${ALEPH_ACCOUNT_INFO}:${counter}`, {
			length: 32
		});
		try {
			account = privateKeyToAccount(/** @type {`0x${string}`} */ (hex(scalar)));
		} catch {
			// Not a scalar of the curve; the next counter is.
		}
	}
	if (!account) throw new Error('could not derive an archive account from the PRF output');
	const aesKey = await deriveAesKey(prfOutput, BACKUP_KEY_INFO);
	const refKey = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (await deriveSubkey(prfOutput, LIST_REF_KEY_INFO, { length: 32 })),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return {
		address: account.address,
		sign: (message) => account.signMessage({ message }),
		aesKey,
		refKey
	};
}

/**
 * The name one list's chain goes under at the store: Aleph's `ref` on every
 * STORE, the first segment of every blob name elsewhere.
 *
 * An account archives several lists (the words name a list per DID, and the
 * address changed once already), and each chain numbers from 1, so a listing
 * of the whole account mixes them. The store needs a label that tells chains
 * apart and nothing more: an HMAC of the address under a key from the
 * passkey, so the same passkey finds the same chain on every device while the
 * store learns neither the address nor whether two accounts share a list.
 *
 * @param {CryptoKey} refKey
 * @param {string} address - the OrbitDB address
 * @returns {Promise<string>} 32 hex characters
 */
export async function listRefFor(refKey, address) {
	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', refKey, new TextEncoder().encode(String(address)))
	);
	return Array.from(mac.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The sealing the storage bridge's `withEncryption` takes: AES-GCM with a
 * fresh 96-bit nonce per blob.
 *
 * @param {CryptoKey} aesKey
 */
export function sealer(aesKey) {
	return {
		/** @param {Uint8Array} plaintext */
		encrypt: async (plaintext) => {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const ciphertext = new Uint8Array(
				await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv },
					aesKey,
					/** @type {BufferSource} */ (plaintext)
				)
			);
			return { ciphertext, iv };
		},
		/**
		 * @param {Uint8Array} ciphertext
		 * @param {Uint8Array} iv
		 */
		decrypt: async (ciphertext, iv) =>
			new Uint8Array(
				await crypto.subtle.decrypt(
					{ name: 'AES-GCM', iv: /** @type {BufferSource} */ (iv) },
					aesKey,
					/** @type {BufferSource} */ (ciphertext)
				)
			)
	};
}

/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
/** @param {string} text */
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * A short text sealed for storage — a service's API key kept in
 * localStorage, readable only with the passkey.
 *
 * @param {CryptoKey} aesKey
 * @param {string} text
 * @returns {Promise<string>} base64 of nonce ‖ ciphertext
 */
export async function sealText(aesKey, text) {
	const { ciphertext, iv } = await sealer(aesKey).encrypt(
		/** @type {Uint8Array} */ (new TextEncoder().encode(text))
	);
	const out = new Uint8Array(iv.length + ciphertext.length);
	out.set(iv, 0);
	out.set(ciphertext, iv.length);
	return toBase64(out);
}

/**
 * @param {CryptoKey} aesKey
 * @param {string} sealed - from {@link sealText}
 * @returns {Promise<string>}
 */
export async function openText(aesKey, sealed) {
	const bytes = fromBase64(sealed);
	const plaintext = await sealer(aesKey).decrypt(
		/** @type {Uint8Array} */ (bytes.subarray(12)),
		/** @type {Uint8Array} */ (bytes.subarray(0, 12))
	);
	return new TextDecoder().decode(plaintext);
}
