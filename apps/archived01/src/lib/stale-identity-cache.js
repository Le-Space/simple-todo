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
// Here that is the Fold restoring the laptop's archive (2026-10-17): the join
// verifies the laptop's entries first, the laptop's session goes into the
// cache, and the Fold's own identity — same DID — fails the comparison on its
// next write. The other way round it hits sync: entries from an earlier
// session arrive and are refused.
//
// Ported from Le-Space/belege `session-identities.js` (belege#259, where it
// unblocked the restore); upstream orbitdb/orbitdb#1258. Where OrbitDB says
// no, a webauthn identity is checked again the way an uncached one would be:
// the shape, the id signature over the public key, and the provider's own
// binding. Remove once OrbitDB keys its cache by identity hash.

import { isIdentity } from '@orbitdb/core';
import { OrbitDBWebAuthnIdentityProviderFunction } from '@le-space/orbitdb-identity-provider-webauthn-did';

/**
 * @template {{ verifyIdentity: (identity: any) => Promise<boolean>, verify: (signature: string, publicKey: string, data: string) => Promise<boolean> }} T
 * @param {T} identities
 * @returns {T}
 */
export function withoutStaleIdentityCache(identities) {
	// The provider's static `type` and `verifyIdentity`, which its bundled types leave out.
	const provider = /** @type {any} */ (OrbitDBWebAuthnIdentityProviderFunction);
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
