// Create-or-recover flow for the WebAuthn passkey identity.
//
// TODO(upstream): this flow only exists as demo code in
// @le-space/orbitdb-identity-provider-webauthn-did (examples/). Once it is
// exported there as an official helper, replace this module with that import.
//
// Recovery order:
//   1. largeBlob — identity metadata stored inside the passkey itself,
//      readable through a discoverable WebAuthn assertion.
//   2. localStorage — the serialized credential stored at registration time.
//   3. the authenticator alone — two touches, nothing stored anywhere.
//      Provider 0.6.0 derives the DID from two signatures (an assertion does
//      not carry the public key) and the signing key from the PRF output, so a
//      device that has never seen this passkey can still be it. That is what
//      makes the storage choice honest: in memory mode nothing has to be kept
//      for the identity to come back (#9).
//
// The passkey is bound to the page origin (rpId). A credential created on
// localhost cannot be used on simple-todo.le-space.de or an IPFS gateway —
// see the chapter README.
import { getPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
import {
	WebAuthnDIDProvider,
	createDidLargeBlobPayload,
	parseDidLargeBlobPayload,
	writeLargeBlobMetadata,
	readLargeBlobMetadata,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential,
	restoreIdentityFromAuthenticator
} from '@le-space/orbitdb-identity-provider-webauthn-did';

const CREDENTIAL_STORAGE_KEY = 'simpleTodo.webauthnCredential';

/**
 * The credential, written down so a later visit finds the same identity --
 * and only when the reader asked for things to be kept.
 *
 * In memory mode nothing is written, and nothing needs to be: the third
 * recovery layer asks the authenticator itself. The cost is two touches
 * instead of none, and that the dialog can no longer know a passkey exists
 * before the reader says so (#9).
 *
 * @param {any} credential
 */
function rememberCredential(credential) {
	if (!getPersistentStorageEnabled()) return;
	storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);
}

/**
 * Register a brand-new passkey and persist its identity metadata for later
 * recovery (largeBlob first, localStorage always).
 *
 * @param {{ userId: string, displayName: string }} options
 * @returns {Promise<any>} the WebAuthn credential for the identity provider
 */
export async function createPasskeyCredential({ userId, displayName }) {
	const credential = await WebAuthnDIDProvider.createCredential({
		userId,
		displayName
	});

	// localStorage fallback first — it never fails for platform reasons.
	rememberCredential(credential);

	// Best effort: put the metadata into the authenticator's largeBlob so the
	// identity survives a cleared browser profile. Costs one extra WebAuthn
	// prompt right after registration; not every authenticator supports it.
	try {
		const payload = createDidLargeBlobPayload(credential, credential.did);
		await writeLargeBlobMetadata({
			credentialId: credential.rawCredentialId,
			payload
		});
	} catch (error) {
		console.warn('largeBlob write skipped (falling back to localStorage only):', error);
	}

	return credential;
}

/**
 * Recover a previously registered passkey identity.
 *
 * @returns {Promise<any | null>} the credential, or null when nothing found
 */
/**
 * What the provider needs, rebuilt from what the authenticator gave back.
 *
 * It reads three things off a credential — `credentialId`, `rawCredentialId`
 * and `publicKey` — and `prfInput` when it derives the signing key. The
 * constants are the ones `createCredential()` writes for a P-256 passkey
 * (ES256, EC2, P-256), and the rest of a registered credential (the
 * attestation object, the user handle, the display name) has no reader past
 * registration.
 *
 * @param {{ did: string, publicKey: { x: Uint8Array, y: Uint8Array },
 *   credentialId: Uint8Array, prfInput: Uint8Array }} restored
 */
function credentialFromRestored(restored) {
	const bytes = new Uint8Array(restored.credentialId);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const credentialId = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

	return {
		did: restored.did,
		credentialId,
		rawCredentialId: bytes,
		publicKey: {
			algorithm: -7,
			keyType: 2,
			curve: 1,
			x: restored.publicKey.x,
			y: restored.publicKey.y
		},
		prfInput: restored.prfInput
	};
}

/**
 * @param {{ onTouch?: (step: { touch: number, of: number }) => void }} [options]
 */
export async function recoverPasskeyCredential({ onTouch } = {}) {
	try {
		const { blob } = await readLargeBlobMetadata({ discoverableCredentials: true });
		if (blob?.length) {
			const payload = parseDidLargeBlobPayload(blob);
			const credential = payload?.credential ?? payload;
			if (credential?.did) {
				// Refresh the local fallback so the next recovery works offline of largeBlob.
				rememberCredential(credential);
				return credential;
			}
		}
	} catch (error) {
		console.warn('largeBlob recovery unavailable, trying localStorage:', error);
	}

	const stored = loadWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
	if (stored) return stored;

	// Nothing here and nothing in the passkey: ask the authenticator itself.
	// Two touches, and no fallback if it cannot evaluate PRF -- an identity
	// derived from something else would be a different one wearing this name.
	// A device with no passkey for this origin answers with a WebAuthn error --
	// "Resident credentials or empty 'allowCredentials' lists are not supported"
	// and its kin -- which says nothing to a reader. Treated as "nothing found",
	// so the caller keeps its own readable message about there being no passkey
	// here.
	let restored;
	try {
		restored = await restoreIdentityFromAuthenticator({ onTouch });
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
