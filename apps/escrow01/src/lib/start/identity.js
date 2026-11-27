/**
 * escrow01's start, the identity side: who comes back with a passkey, how many
 * prompts a start takes, and whether a passkey without PRF needs a word of
 * warning. Moved out of +page.svelte as they were; `start()` and
 * `beginWith()`, which ask the passkey, stay on the page, inside the click.
 */
import { recall, remember } from '@simple-todo/todo/browser-memory.js';
import { hasStoredPasskeyCredential } from '../passkey-identity.js';

export const IDENTITY_MODE_KEY = 'simpleTodo.identityMode';

/**
 * Whether somebody comes back with a passkey already linked to this device.
 * A passkey is linked only after the consent dialog was accepted, so this is
 * also the one trace of that acceptance that "in memory only" leaves behind.
 * Those people get the short passkey step instead of the dialog.
 */
export function returningWithPasskey() {
	try {
		return recall(IDENTITY_MODE_KEY) === 'passkey' || hasStoredPasskeyCredential();
	} catch {
		return false;
	}
}

/** Whether the last start on this device was deliberately without a passkey. */
export function lastStartWasAnonymous() {
	try {
		return recall(IDENTITY_MODE_KEY) === 'anon';
	} catch {
		return false;
	}
}

/**
 * How many passkey prompts a start takes, counted in
 * e2e/passkey-restore.spec.js. Every start reads the PRF output once, and the
 * signing key and the key for sealed lists come from it; neither is written
 * down (#127, user decision 26.11.2026: a reload asks for a touch).
 *
 * - a new passkey: three -- the passkey, the PRF output, the identity
 *   signature;
 * - one this device keeps: one -- the PRF output. The identity proof is kept,
 *   so the document is not signed again;
 * - one found on the authenticator: four -- two to restore, the PRF output,
 *   the signature. Provider 0.14.0's restore reads the PRF output but does not
 *   hand it out; once it does (orbitdb-identity-provider-webauthn-did#107)
 *   this is three again.
 *
 * A passkey without PRF skips the PRF read and signs a new document instead,
 * so a kept return is one touch there too. Every prompt after the first gets
 * a word on what it is for.
 *
 * @param {'create' | 'existing' | 'anonymous'} mode
 * @returns {number | null} null without a passkey
 */
export function passkeyPromptsFor(mode) {
	if (mode === 'create') return 3;
	if (mode === 'existing') return hasStoredPasskeyCredential() ? 1 : 4;
	return null;
}

/**
 * The passkey binds the identity only as far as the authenticator lets it.
 *
 * `ensureDerivedSigningKey` derives the OrbitDB signing key from the
 * credential's PRF output, which is what makes the same passkey produce the
 * same identity document everywhere. Without PRF it is never fatal: the
 * keystore generates its own key, the DID stays the same, and the public
 * key differs per device. The provider logs one debug line, so nothing
 * reaches the person it affects. This does: it returns the warning to
 * show, once per credential, as a catalogue key and how long to show it.
 *
 * @param {any} credential
 * @returns {{ key: string, duration: number } | null}
 */
export function identityTravelWarning(credential) {
	if (!credential || credential.extensionSupport?.prf !== false) return null;
	const seen = `simpleTodo.prfWarned.${credential.credentialId ?? 'unknown'}`;
	try {
		if (recall(seen) === 'true') return null;
		remember(seen, 'true');
	} catch {
		// No storage: warn every time rather than not at all.
	}
	// A page cannot see GrapheneOS, nor whether Play Services exist. It can
	// see Android, and on Android a passkey without PRF is exactly that case:
	// no CTAP2 over NFC without a credential provider, or a provider
	// (Passchain) that answers no PRF. The hint names the fix;
	// docs/grapheneos.md has the rest.
	if (onAndroid()) {
		return { key: 'consent.prfMissingAndroid', duration: 20_000 };
	}
	return { key: 'consent.prfMissing', duration: 12_000 };
}

/** Android as the browser reports it — Vanadium presents as Chrome on Android. */
function onAndroid() {
	const data = /** @type {any} */ (navigator).userAgentData;
	return data?.platform === 'Android' || /\bAndroid\b/.test(navigator.userAgent);
}
