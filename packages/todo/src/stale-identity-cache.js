// OrbitDB's verified-identity cache keyed by the wrong thing, worked around.
//
// `Identities.verifyIdentity` (@orbitdb/core 4) remembers a verified identity
// under `signatures.id` and, on a hit, answers `isEqual(identity, cached)`.
// With the WebAuthn DID provider the PRF-derived signing key gives the *same*
// `signatures.id` in every session of a passkey, while `signatures.publicKey`
// — the WebAuthn assertion — is new per session. So once one session's
// identity is in the cache, every other session of the same passkey is
// refused: "Key … is not allowed to write to the log".
//
// Seen in archived01 (2026-10-17): a phone restoring the laptop's archive —
// the join verifies the laptop's entries first, the laptop's session goes
// into the cache, and the phone's own identity, same DID, fails the
// comparison on its next write. The other way round it hits sync: entries
// from an earlier session arrive over the relay and are refused.
//
// Ported from Le-Space/belege `session-identities.js` (belege#259, where it
// unblocked the restore); upstream orbitdb/orbitdb#1258. Where OrbitDB says
// no, an identity of the given provider is checked again the way an uncached
// one would be: the shape, the id signature over the public key, and the
// provider's own binding.
//
// Since provider 0.11.0 this lives in the provider itself
// (`withoutStaleIdentityCache`, `createIdentities`; Le-Space/orbitdb-identity-
// provider-webauthn-did#90). archived01 imports it from there; this copy stays
// for the chapters still on an older provider, and goes when they move.

import { isIdentity } from '@orbitdb/core';

/**
 * @template {{ verifyIdentity: (identity: any) => Promise<boolean>, verify: (signature: string, publicKey: string, data: string) => Promise<boolean> }} T
 * @param {T} identities
 * @param {any} providerFunction - the identity provider whose identities may be
 *   re-checked: the WebAuthn DID provider function, which carries `type` and
 *   `verifyIdentity` as statics its bundled types leave out
 * @returns {T}
 */
export function withoutStaleIdentityCache(identities, providerFunction) {
	/** @type {{ type: string, verifyIdentity: (identity: any) => Promise<boolean> }} */
	const provider = providerFunction;
	if (
		!provider ||
		typeof provider.type !== 'string' ||
		typeof provider.verifyIdentity !== 'function'
	) {
		throw new TypeError(
			'withoutStaleIdentityCache needs the identity provider (type, verifyIdentity)'
		);
	}
	const cached = identities.verifyIdentity;
	identities.verifyIdentity = async (identity) => {
		if (await cached(identity)) return true;
		if (!isIdentity(identity) || identity.type !== provider.type) return false;
		const { id, publicKey, signatures } = identity;
		if (!(await identities.verify(signatures.id, publicKey, id))) return false;
		return provider.verifyIdentity(identity);
	};
	return identities;
}
