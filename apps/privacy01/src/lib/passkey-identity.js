// Create-or-recover flow for the WebAuthn passkey identity.
//
// TODO(upstream): this flow only exists as demo code in
// @le-space/orbitdb-identity-provider-webauthn-did (examples/). Once it is
// exported there as an official helper, replace this module with that import.
//
// Recovery order:
//   1. this browser's stored credential — only when the reader chose to keep
//      things, and no WebAuthn call at all.
//   2. the authenticator alone — two touches, nothing stored anywhere. The
//      provider derives the DID from two signatures (an assertion does not
//      carry the public key) and the signing key from the PRF output, so a
//      device that has never seen this passkey can still be it (#9).
//
// There is no largeBlob layer any more. qr01 measured it on provider 0.5.4 —
// which does request the extension at registration, so the older note here
// that it never did was wrong: the write assertion returns
// `largeBlob: { written: false }` every time all the same, and the read before
// recovery finds nothing. Two prompts that achieve nothing, and a third touch
// on every restore. The provider's hardware test adds the other half: Android
// Chrome writes the blob and does not return it on read
// (Le-Space/orbitdb-identity-provider-webauthn-did#48).
//
// The passkey is bound to the page origin (rpId). A credential created on
// localhost cannot be used on simple-todo.le-space.de or an IPFS gateway —
// see the chapter README.
import { getPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
import { withRestoredSigningKey } from '@simple-todo/todo/restored-signing-key.js';
import {
	WebAuthnDIDProvider,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential,
	restoreIdentityFromAuthenticator
} from '@le-space/orbitdb-identity-provider-webauthn-did';

const CREDENTIAL_STORAGE_KEY = 'simpleTodo.webauthnCredential';

/**
 * The type of key OrbitDB signs with, derived from the passkey's PRF output.
 *
 * One constant for both places that derive it — `p2p.js` when the identity is
 * built, and the restore below — because they used to disagree. The identity
 * was built with Ed25519 while the restore asked for the provider's default,
 * secp256k1, so a restored device signed under a different key than the
 * device the passkey was made on: the same DID, a different identity document,
 * and — since #120 derives the encryption key pair from the signing key — a
 * different pair, which cannot open the owner's own key copies.
 */
export const SIGNING_KEY_TYPE = 'Ed25519';

/**
 * The credential, written down so a later visit finds the same identity --
 * and only when the reader asked for things to be kept.
 *
 * In memory mode nothing is written, and nothing needs to be: recovery asks
 * the authenticator itself. The cost is two touches instead of none (#9).
 *
 * @param {any} credential
 */
function rememberCredential(credential) {
	if (!getPersistentStorageEnabled()) return;
	storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);
}

/**
 * Register a brand-new passkey.
 *
 * Three prompts in all, counted in e2e/passkey-restore.spec.js: this `create`,
 * then — when OrbitDB builds the identity — one for the PRF output the signing
 * key is derived from and one to sign the identity.
 *
 * @param {{ userId: string, displayName: string }} options
 * @returns {Promise<any>} the WebAuthn credential for the identity provider
 */
export async function createPasskeyCredential({ userId, displayName }) {
	const credential = await WebAuthnDIDProvider.createCredential({
		userId,
		displayName
	});
	rememberCredential(credential);
	return credential;
}

/**
 * What the provider needs, rebuilt from what the authenticator gave back.
 *
 * It reads `credentialId` (text), `rawCredentialId` (bytes) and `publicKey`
 * off a credential, and `prfInput` when it derives the signing key; since
 * provider 0.7.0 the restore returns both forms of the id under those names.
 * The constants are the ones `createCredential()` writes for a P-256 passkey
 * (ES256, EC2, P-256). `attestationObject` is empty, because
 * `storeWebAuthnCredential` serialises it and a restored passkey has none —
 * without it, keeping a restored credential threw.
 *
 * The signing key the restore derived rides along, out of reach of any
 * serialiser; p2p.js hands it to the keystore, which spares the passkey a
 * touch (see @simple-todo/todo/restored-signing-key.js).
 *
 * @param {{ did: string, publicKey: { x: Uint8Array, y: Uint8Array },
 *   credentialId: string, rawCredentialId: Uint8Array, prfInput: Uint8Array,
 *   signingKey: Uint8Array }} restored
 */
function credentialFromRestored(restored) {
	return withRestoredSigningKey(
		{
			did: restored.did,
			credentialId: restored.credentialId,
			rawCredentialId: restored.rawCredentialId,
			attestationObject: new Uint8Array(0),
			publicKey: {
				algorithm: -7,
				keyType: 2,
				curve: 1,
				x: restored.publicKey.x,
				y: restored.publicKey.y
			},
			prfInput: restored.prfInput
		},
		restored.signingKey
	);
}

/**
 * Recover a previously registered passkey identity.
 *
 * A stored credential is used as it is: no WebAuthn call, so this step asks for
 * nothing — the identity signature when OrbitDB starts is the one touch left.
 * Without one, the authenticator is asked: two touches, and no fallback if it
 * cannot evaluate PRF -- an identity derived from something else would be a
 * different one wearing this name.
 *
 * @param {{ onTouch?: (step: { touch: number, of: number }) => void }} [options]
 * @returns {Promise<any | null>} the credential, or null when nothing found
 */
export async function recoverPasskeyCredential({ onTouch } = {}) {
	const stored = loadWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
	if (stored) return stored;

	// A device with no passkey for this origin answers with a WebAuthn error --
	// "Resident credentials or empty 'allowCredentials' lists are not supported"
	// and its kin -- which says nothing to a reader. Treated as "nothing found",
	// so the caller keeps its own readable message about there being no passkey
	// here.
	let restored;
	try {
		restored = await restoreIdentityFromAuthenticator({
			onTouch,
			signingKeyType: SIGNING_KEY_TYPE
		});
	} catch (error) {
		console.warn('the authenticator could not answer for an identity:', error);
		return null;
	}

	const credential = credentialFromRestored(restored);
	rememberCredential(credential);
	return credential;
}

/** True when a serialized credential exists in this browser profile. */
export function hasStoredPasskeyCredential() {
	try {
		return Boolean(loadWebAuthnCredential(CREDENTIAL_STORAGE_KEY));
	} catch {
		return false;
	}
}

/** Remove the locally stored credential (the passkey itself stays on the authenticator). */
export function forgetStoredPasskeyCredential() {
	clearWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
}
