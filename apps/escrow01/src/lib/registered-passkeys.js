/**
 * Which passkeys this page registered (escrow01).
 *
 * Only a passkey registered on this page can be sure to have no budget account
 * anywhere yet, so only for one of those does budget-service-zama.js create an
 * account without asking.
 *
 * Kept by `credentialId`, not by object. Stopping between two passkey prompts
 * (#121) sends the reader on with "existing", and `recoverPasskeyCredential()`
 * then hands back the passkey created a minute ago as a new object: from the
 * stored copy, or rebuilt from the authenticator. All three carry the same id,
 * the base64url of the credential's `rawId`. A set of objects missed that path
 * and asked "search again or create one?" of someone who never had an account.
 *
 * In this module's memory only, so a reload empties it: a passkey from an
 * earlier page is never in it, which is what keeps the question for the case it
 * is for.
 */

/** @type {Set<string>} */
const registeredHere = new Set();

/** @param {any} credential */
function idOf(credential) {
	const id = credential && typeof credential === 'object' ? credential.credentialId : null;
	return typeof id === 'string' && id ? id : null;
}

/**
 * Called with the credential `createCredential()` returned.
 *
 * @param {any} credential
 */
export function markRegisteredHere(credential) {
	const id = idOf(credential);
	if (id) registeredHere.add(id);
}

/**
 * Whether this page registered `credential`, whichever object carries it now.
 *
 * @param {any} credential
 */
export function wasRegisteredHere(credential) {
	const id = idOf(credential);
	return id !== null && registeredHere.has(id);
}
