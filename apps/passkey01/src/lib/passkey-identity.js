// Create-or-recover flow for the WebAuthn passkey identity.
//
// TODO(upstream): this flow only exists as demo code in
// @le-space/orbitdb-identity-provider-webauthn-did (examples/). Once it is
// exported there as an official helper, replace this module with that import.
//
// Recovery order (mirrors the provider's documented layers):
//   1. largeBlob — identity metadata stored inside the passkey itself,
//      readable through a discoverable WebAuthn assertion.
//   2. localStorage — the serialized credential stored at registration time.
//
// The passkey is bound to the page origin (rpId). A credential created on
// localhost cannot be used on simple-todo.le-space.de or an IPFS gateway —
// see the chapter README.
import {
	WebAuthnDIDProvider,
	createDidLargeBlobPayload,
	parseDidLargeBlobPayload,
	writeLargeBlobMetadata,
	readLargeBlobMetadata,
	storeWebAuthnCredential,
	loadWebAuthnCredential,
	clearWebAuthnCredential
} from '@le-space/orbitdb-identity-provider-webauthn-did';

const CREDENTIAL_STORAGE_KEY = 'simpleTodo.webauthnCredential';

/**
 * The credential, written down so a later visit finds the same identity.
 *
 * This is the one thing memory mode still leaves on the device, and it is
 * deliberate for now: with provider 0.5.4 an assertion proves possession but
 * does not carry the public key back, so without this (or a largeBlob the
 * authenticator may not have) the identity cannot return -- a reader would
 * come back to a new DID and no access to their own private list.
 *
 * Provider 0.6.0 removes the reason: `restoreIdentityFromAuthenticator()`
 * touches the same passkey twice and derives the DID and the signing key from
 * the two signatures, with nothing stored. Once the chapters are on it, this
 * write goes away in memory mode (#9).
 *
 * @param {any} credential
 */
function rememberCredential(credential) {
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
export async function recoverPasskeyCredential() {
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

	return loadWebAuthnCredential(CREDENTIAL_STORAGE_KEY);
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
