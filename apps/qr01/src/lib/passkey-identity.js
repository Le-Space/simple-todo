// Create-or-recover flow for the WebAuthn passkey identity.
//
// TODO(upstream): this flow only exists as demo code in
// @le-space/orbitdb-identity-provider-webauthn-did (examples/). Once it is
// exported there as an official helper, replace this module with that import.
//
// Recovery order:
//   1. this browser's stored credential — only when the reader chose to keep
//      things, and no WebAuthn call at all.
//   2. the authenticator alone — two touches, nothing stored anywhere (#9).
//
// No largeBlob layer: the credential is never registered with that extension
// (Le-Space/orbitdb-identity-provider-webauthn-did#48) — see
// createPasskeyCredential below for what that measurement showed.
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
 * Register a brand-new passkey and, when the reader keeps things, remember it.
 *
 * @param {{ userId: string, displayName: string }} options
 * @returns {Promise<any>} the WebAuthn credential for the identity provider
 */
export async function createPasskeyCredential({ userId, displayName }) {
	const credential = await WebAuthnDIDProvider.createCredential({
		userId,
		displayName
	});

	// Written down only when the reader asked for things to be kept. In memory
	// mode nothing is, and nothing needs to be: the third recovery layer below
	// asks the authenticator itself (#9).
	if (getPersistentStorageEnabled()) {
		storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);
	}

	// The largeBlob write used to sit here, and it cost a WebAuthn prompt to do
	// nothing at all.
	//
	// Measured by wrapping `navigator.credentials`: the write assertion returns
	// `largeBlob: { written: false }`, every time. `WebAuthnDIDProvider.
	// createCredential` never requests the extension at registration — PRF and
	// hmac-secret get theirs, largeBlob is left with a comment saying the write
	// happens later — and the WebAuthn spec only permits writing a blob to a
	// credential registered with `largeBlob: { support: ... }`. So there was
	// nothing to write to.
	//
	// It also *looked* like it worked, because the return value was discarded:
	// `writeLargeBlobMetadata` reports the outcome in `extensionResults`, and
	// only an exception would have been noticed. Nothing threw.
	//
	// So this is removed rather than moved behind a button. A button offering to
	// back the passkey up would fail in exactly the same way, and an action that
	// asks for a fingerprint and silently achieves nothing is worse than no
	// action. Registering with the extension is an upstream change; when it
	// lands, the explicit backup step is worth adding.
	//
	// Creating a passkey now costs three WebAuthn prompts instead of four:
	// `create` (prf), `get` (prf, keystore), `get` (signIdentity).

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
 * @param {{ onTouch?: (step: { touch: number, of: number }) => void }} [options]
 */
/**
 * Recover a previously registered passkey identity.
 *
 * Reads the credential this browser stored at registration. There is no
 * WebAuthn call, so signing in asks for nothing.
 *
 * That is a deliberate trade and worth stating plainly, because the code no
 * longer shows it: **"use my passkey" performs no user verification.** Anyone
 * holding the unlocked phone can adopt the identity with one tap.
 *
 * What it replaces was not protection either, only the appearance of it. The
 * flow used to try `readLargeBlobMetadata` first, which cost a prompt with
 * `userVerification: 'required'` and — measured — returned `largeBlob: {}` with
 * no blob, every time. The credential is never registered with the largeBlob
 * extension (Le-Space/orbitdb-identity-provider-webauthn-did#48), so that read
 * can find nothing, and the identity always came from the localStorage line
 * below. The prompt guarded the session by accident, and would have been
 * removed by the first person to notice the read was dead.
 *
 * If verification is wanted back, it should be added on purpose — a plain
 * assertion whose reason is written down — rather than restored as a side
 * effect of a lookup that does not work.
 *
 * @returns {Promise<any | null>} the credential, or null when nothing found
 * @param {{ onTouch?: (step: { touch: number, of: number }) => void }} [options]
 */
export async function recoverPasskeyCredential({ onTouch } = {}) {
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
	// Written down only when the reader asked for things to be kept -- this
	// chapter has no `rememberCredential` helper, it stores inline.
	if (getPersistentStorageEnabled()) {
		storeWebAuthnCredential(credential, CREDENTIAL_STORAGE_KEY);
	}
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
