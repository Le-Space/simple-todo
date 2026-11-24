import { describe, expect, it } from 'vitest';
import { markRegisteredHere, wasRegisteredHere } from './registered-passkeys.js';

describe('the passkeys this page registered', () => {
	it('knows a passkey again by its id, whichever object carries it', () => {
		const created = { credentialId: 'created-here', rawCredentialId: new Uint8Array([1]) };
		markRegisteredHere(created);
		expect(wasRegisteredHere(created)).toBe(true);
		// A step cancelled after `create` (#121): the next start recovers the same
		// passkey as a new object, from the stored copy or the authenticator.
		const recovered = { credentialId: 'created-here', attestationObject: new Uint8Array(0) };
		expect(wasRegisteredHere(recovered)).toBe(true);
	});

	it('does not know a passkey from an earlier page, or no passkey at all', () => {
		expect(wasRegisteredHere({ credentialId: 'from-before' })).toBe(false);
		expect(wasRegisteredHere(null)).toBe(false);
		expect(wasRegisteredHere({})).toBe(false);
		markRegisteredHere({ credentialId: '' });
		expect(wasRegisteredHere({ credentialId: '' })).toBe(false);
	});
});
