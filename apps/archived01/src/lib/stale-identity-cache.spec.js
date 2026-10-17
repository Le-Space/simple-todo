import { describe, expect, it } from 'vitest';
import { withoutStaleIdentityCache } from '@simple-todo/todo/stale-identity-cache.js';

/** The provider's statics, as the WebAuthn DID provider function carries them; says no to every binding. */
const provider = { type: 'webauthn', verifyIdentity: async () => false };

// Ported with the workaround from Le-Space/belege (session-identities.spec.js).
describe('withoutStaleIdentityCache (orbitdb/orbitdb#1258)', () => {
	/** An identity's shape, made up; its proof proves nothing. */
	const identity = (/** @type {Record<string, any>} */ over = {}) => ({
		id: 'did:key:zDnaeExampleOnlyNotARealKeyAAAAAAAAAAAAAAAAAAAAAAAA',
		hash: 'zdpuExampleIdentityHash',
		bytes: new Uint8Array([1]),
		publicKey: '02' + 'ab'.repeat(32),
		signatures: { id: 'aa'.repeat(70), publicKey: 'not-a-webauthn-proof' },
		type: 'webauthn',
		...over
	});
	/** @param {{ cached: boolean, idSignature: boolean }} answers */
	const fake = ({ cached, idSignature }) => {
		const calls = { verify: 0 };
		/** @type {{ verifyIdentity: (identity: any) => Promise<boolean>, verify: (signature: string, publicKey: string, data: string) => Promise<boolean> }} */
		const identities = {
			verifyIdentity: async () => cached,
			verify: async () => {
				calls.verify++;
				return idSignature;
			}
		};
		return { identities: withoutStaleIdentityCache(identities, provider), calls };
	};

	it('keeps what OrbitDB accepts, without asking again', async () => {
		const { identities, calls } = fake({ cached: true, idSignature: false });
		expect(await identities.verifyIdentity(identity())).toBe(true);
		expect(calls.verify).toBe(0);
	});

	it('asks again only for a webauthn identity, and never takes one OrbitDB would refuse', async () => {
		// Another provider's identity: OrbitDB's no stands.
		expect(
			await fake({ cached: false, idSignature: true }).identities.verifyIdentity(
				identity({ type: 'publickey' })
			)
		).toBe(false);
		// Not an identity at all.
		expect(
			await fake({ cached: false, idSignature: true }).identities.verifyIdentity({
				type: 'webauthn'
			})
		).toBe(false);
		// The id not signed by its key.
		expect(
			await fake({ cached: false, idSignature: false }).identities.verifyIdentity(identity())
		).toBe(false);
		// Signed, but the key not bound to the DID by a passkey proof: the provider says no.
		expect(
			await fake({ cached: false, idSignature: true }).identities.verifyIdentity(identity())
		).toBe(false);
	});
});

describe('withoutStaleIdentityCache needs a provider', () => {
	it('refuses to wrap without one', () => {
		expect(() =>
			withoutStaleIdentityCache(
				{ verifyIdentity: async () => true, verify: async () => true },
				/** @type {any} */ (undefined)
			)
		).toThrow(/provider/);
	});
});
