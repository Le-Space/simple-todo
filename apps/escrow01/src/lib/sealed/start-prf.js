/**
 * The one PRF read of a passkey start (#127).
 *
 * User decision, 26.11.2026: as much as possible sealed, and a reload asks for
 * a touch. So nothing the passkey can derive again is written down: not the
 * OrbitDB signing key, not the X25519 key for sealed lists. Every start reads
 * the passkey's PRF output once, behind the click that starts, and both keys
 * come from that one answer (p2p.js hands it to the identity provider as
 * `prfOutput`; ./own-agreement-key.js derives the list key from it).
 *
 * The output is held for the tab, by credential. A restart — another shared
 * list, the WebRTC switch — builds a new OrbitDB with a new keystore, and must
 * not ask again for an answer this tab already has. Nothing is written.
 *
 * It asks the same PRF input the provider asks for the signing key (the
 * credential's own, or the one derived from the relying party), so the signing
 * key, and with it the identity document, stay what they were.
 */
import {
	PrfUnavailableError,
	readPrfOutput as readFromPasskey
} from '@le-space/orbitdb-identity-provider-webauthn-did/vault';

/** By credential id: the output, or null for a passkey without PRF. @type {Map<string, Uint8Array | null>} */
const held = new Map();

/**
 * Whether the credential says its authenticator cannot evaluate PRF. Only a
 * plain `false` counts: a credential that says nothing is asked.
 *
 * @param {any} credential
 */
export function lacksPrf(credential) {
	return credential?.extensionSupport?.prf === false;
}

/**
 * This start's PRF output: a copy of the one this tab holds, or one read now,
 * or null when the passkey has none.
 *
 * A refused or cancelled prompt is not "no PRF": it is thrown, and the start
 * stops. Treating it as no PRF would make this browser a device key, and the
 * lists sealed for the passkey's own key would stay closed to it.
 *
 * @param {any} credential the WebAuthn credential of the start
 * @param {{ read?: (credential: any) => Promise<Uint8Array> }} [options]
 *   `read` for tests; the provider's `readPrfOutput` by default
 * @returns {Promise<Uint8Array | null>}
 */
export async function prfForStart(credential, { read = readFromPasskey } = {}) {
	const id = credentialId(credential);
	if (held.has(id)) {
		const known = held.get(id);
		return known ? Uint8Array.from(known) : null;
	}
	if (lacksPrf(credential)) {
		held.set(id, null);
		return null;
	}

	let output;
	try {
		output = await read(credential);
	} catch (error) {
		if (!(error instanceof PrfUnavailableError)) throw error;
		held.set(id, null);
		return null;
	}
	if (!(output instanceof Uint8Array) || output.length < 32) {
		throw new TypeError('The passkey answered with no usable PRF output.');
	}
	held.set(id, Uint8Array.from(output));
	return Uint8Array.from(output);
}

/**
 * Hold an output this tab got some other way: a restore from the
 * authenticator that hands it out (provider #107), so the start that follows
 * does not ask again.
 *
 * @param {any} credential
 * @param {Uint8Array} output
 */
export function holdPrfOutput(credential, output) {
	if (!(output instanceof Uint8Array) || output.length < 32) return;
	held.set(credentialId(credential), Uint8Array.from(output));
}

/** Drop every output this tab holds, zeroed. */
export function forgetPrfOutputs() {
	for (const output of held.values()) output?.fill(0);
	held.clear();
}

/** @param {any} credential */
function credentialId(credential) {
	const id = credential?.credentialId;
	if (typeof id !== 'string' || id.length === 0) {
		throw new TypeError('A PRF output belongs to one credential.');
	}
	return id;
}
