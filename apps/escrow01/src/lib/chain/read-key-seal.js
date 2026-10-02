/**
 * The read key's seal (escrow01): an AES-GCM key derived from the passkey's
 * PRF output, so the read key is stored encrypted and opens only with the
 * passkey that sealed it.
 *
 * The PRF input is the provider's fixed one for this relying party, so the
 * authenticator gives the answer it also gives for the list's signing key.
 * HKDF's info keeps the two keys apart: a different PRF input would only be a
 * second question, and today it costs its own touch either way, because the
 * provider does not hand its answer out. Fixing the input keeps the door open
 * to one touch for both (docs/passkey-account.md, "The read key").
 *
 * The sealing key is not extractable and lives in memory for one session. The
 * sealed read key itself is the wallet package's `SealedZamaSessionKey`:
 * AES-GCM, a random IV, the address bound as associated data.
 */

import { prfInputForRelyingParty } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { extractPrfSeedFromCredential } from '@le-space/orbitdb-identity-provider-webauthn-did/standalone';

/** Changing this makes every sealed read key unreadable: treat it as breaking. */
export const READ_KEY_SEAL_INFO = 'simple-todo:escrow01:read-key-seal:v1';

/**
 * The sealing key for a PRF seed.
 *
 * @param {Uint8Array} seed the authenticator's PRF output, 32 bytes
 * @returns {Promise<CryptoKey>} AES-GCM-256, encrypt and decrypt, not extractable
 */
export async function deriveSealingKey(seed) {
	if (!(seed instanceof Uint8Array) || seed.length < 32) {
		throw new TypeError('A PRF seed has at least 32 bytes.');
	}
	const material = await crypto.subtle.importKey(
		'raw',
		/** @type {BufferSource} */ (seed),
		'HKDF',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(32),
			info: new TextEncoder().encode(READ_KEY_SEAL_INFO)
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Ask the passkey for its PRF output: one WebAuthn assertion, with user
 * verification.
 *
 * Always with the fixed input. Without one, `extractPrfSeedFromCredential`
 * asks with random bytes, and a key sealed under that answer never opens
 * again.
 *
 * @param {any} credential the session's WebAuthn credential
 * @param {string} rpId the relying party the passkey belongs to
 * @returns {Promise<Uint8Array | null>} null when the authenticator has no PRF
 */
export async function readPrfSeed(credential, rpId) {
	const prfInput = await prfInputForRelyingParty(rpId);
	const { seed } = await extractPrfSeedFromCredential(credential, { rpId, prfInput });
	return seed;
}
