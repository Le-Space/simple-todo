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
	restoreIdentityFromAuthenticator,
	PasskeyStepCancelled
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import {
	readPrfOutput,
	PrfUnavailableError
} from '@le-space/orbitdb-identity-provider-webauthn-did/vault';

const CREDENTIAL_STORAGE_KEY = 'simpleTodo.webauthnCredential';

/**
 * The type of key OrbitDB signs with, derived from the passkey's PRF output.
 *
 * One constant for both places that derive it — `p2p.js` when the identity is
 * built, and the restore below — because they used to disagree. The identity
 * was built with Ed25519 while the restore asked for the provider's default,
 * secp256k1, so a restored device signed under a different key than the
 * device the passkey was made on: the same DID and a different identity
 * document. (Between #120 and the PRF derivation in ./device-keys.js it was a
 * different encryption pair too, which is why that older pair is still derived
 * from this key to read old copies with.)
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
 * then — when OrbitDB builds the identity — one for the PRF output (both the
 * signing key and the encryption pair come from it, see
 * `readSessionPrfOutput`) and one to sign the identity.
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
 * nothing — the PRF output and the identity signature when OrbitDB starts are
 * the two touches left. Without one, the authenticator is asked: two touches,
 * and no fallback if it cannot evaluate PRF -- an identity derived from
 * something else would be a different one wearing this name. Then the same two
 * as above, four in all: the restore reads the PRF output in its first touch
 * but hands back only the signing key derived from it, and the encryption pair
 * needs the output itself (counted in e2e/passkey-restore.spec.js).
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

/**
 * Thrown when the passkey was asked for its PRF output and did not answer:
 * the prompt was refused or timed out, or another passkey answered. The start
 * stops rather than go on with keys the passkey did not give — a signing key
 * for this session only, and an encryption pair that lives in this browser, for
 * a passkey that could have done better.
 */
export class PrfReadRefusedError extends Error {
	/** @param {unknown} cause */
	constructor(cause) {
		super('The passkey did not give its PRF output.', { cause });
		this.name = 'PrfReadRefusedError';
	}
}

/**
 * The passkey's PRF output for this session — one touch — or null when this
 * passkey has none.
 *
 * Read here rather than by the provider, because two keys come from it: the
 * provider derives the signing key from what this returns (its `prfOutput`
 * option), and ./device-keys.js the encryption pair, under a label of its own.
 * One answer, one touch, and neither key derived from the other.
 *
 * Only an answer without PRF counts as "none". A refused or timed-out prompt is
 * a {@link PrfReadRefusedError}; the provider's own read used to treat it as no
 * PRF and carry on with a random signing key.
 *
 * @param {any} credential with `rawCredentialId` (and `prfInput`, when it was registered with one)
 * @returns {Promise<Uint8Array | null>}
 */
export async function readSessionPrfOutput(credential) {
	try {
		return await readPrfOutput(credential);
	} catch (error) {
		if (error instanceof PrfUnavailableError) return null;
		// Stopped between two prompts by the application's own step dialog:
		// nothing was asked, and the caller knows that error already.
		if (error instanceof PasskeyStepCancelled) throw error;
		throw new PrfReadRefusedError(error);
	}
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
