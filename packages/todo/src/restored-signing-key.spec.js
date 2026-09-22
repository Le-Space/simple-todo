import { describe, expect, it } from 'vitest';
import { seedRestoredSigningKey, withRestoredSigningKey } from './restored-signing-key.js';

const DID = 'did:key:zDnaeRestored';

function fakeKeystore(existing = {}) {
	const keys = new Map(Object.entries(existing));
	return {
		keys,
		getKey: async (/** @type {string} */ id) => keys.get(id) ?? null,
		addKey: async (/** @type {string} */ id, /** @type {any} */ key) => void keys.set(id, key)
	};
}

describe('a restored signing key', () => {
	it('goes into the keystore under the DID, before the provider asks for it', async () => {
		const keystore = fakeKeystore();
		const key = new Uint8Array(32).fill(7);
		const credential = withRestoredSigningKey({ did: DID }, key);
		expect(await seedRestoredSigningKey(keystore, credential)).toBe(true);
		expect(keystore.keys.get(DID)).toEqual({ privateKey: key });
	});

	it('leaves a key that is already there alone', async () => {
		const earlier = { privateKey: new Uint8Array(32).fill(1) };
		const keystore = fakeKeystore({ [DID]: earlier });
		const credential = withRestoredSigningKey({ did: DID }, new Uint8Array(32).fill(7));
		expect(await seedRestoredSigningKey(keystore, credential)).toBe(false);
		expect(keystore.keys.get(DID)).toBe(earlier);
	});

	it('does nothing for a credential that was not restored', async () => {
		const keystore = fakeKeystore();
		expect(await seedRestoredSigningKey(keystore, { did: DID })).toBe(false);
		expect(keystore.keys.size).toBe(0);
	});

	it('is never written down with the credential', () => {
		const credential = withRestoredSigningKey({ did: DID, credentialId: 'abc' }, new Uint8Array(32).fill(7));
		expect(credential.signingKey).toBeInstanceOf(Uint8Array);
		// What storeWebAuthnCredential does to a credential before JSON.stringify.
		expect(JSON.stringify({ ...credential })).not.toContain('signingKey');
		expect(Object.keys(credential)).toEqual(['did', 'credentialId']);
	});
});
