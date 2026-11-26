import { afterEach, describe, expect, it } from 'vitest';
import {
	deviceAgreementKey,
	forgetDeviceAgreementKey,
	hasDeviceAgreementKey,
	ownAgreementKey
} from './own-agreement-key.js';
import { agreementKeyFromPrf } from './key-agreement.js';

const alice = 'did:key:zDnaeAliceExample';
const bob = 'did:key:zDnaeBobExample';

afterEach(() => {
	forgetDeviceAgreementKey(alice);
	forgetDeviceAgreementKey(bob);
});

describe('the session’s own key', () => {
	it('comes from the PRF output when there is one, and leaves no device key', async () => {
		const own = await ownAgreementKey({ did: alice, prfOutput: new Uint8Array(32).fill(5) });
		const expected = await agreementKeyFromPrf(new Uint8Array(32).fill(5));

		expect(own.source).toBe('prf');
		expect(own.publicKey).toEqual(expected.publicKey);
		expect(hasDeviceAgreementKey(alice)).toBe(false);
	});

	it('without PRF is a device key, the same one on the next call', async () => {
		const first = await ownAgreementKey({ did: alice, prfOutput: null });
		const second = await deviceAgreementKey(alice);

		expect(first.source).toBe('device');
		expect(hasDeviceAgreementKey(alice)).toBe(true);
		expect(second.publicKey).toEqual(first.publicKey);
	});

	it('keeps one device key per identity', async () => {
		const forAlice = await deviceAgreementKey(alice);
		const forBob = await deviceAgreementKey(bob);
		expect(forAlice.publicKey).not.toEqual(forBob.publicKey);
	});

	it('makes a new device key once the old one is forgotten', async () => {
		const before = await deviceAgreementKey(alice);
		forgetDeviceAgreementKey(alice);
		const after = await deviceAgreementKey(alice);
		expect(after.publicKey).not.toEqual(before.publicKey);
	});

	it('replaces a stored value that is no key', async () => {
		localStorage.setItem('simpleTodo.escrow01.deviceAgreementKey.' + alice, 'garbage');
		const own = await deviceAgreementKey(alice);
		expect(own.publicKey).toHaveLength(32);
		expect(hasDeviceAgreementKey(alice)).toBe(true);
	});

	it('needs an identity to belong to', async () => {
		await expect(deviceAgreementKey('')).rejects.toThrow(TypeError);
	});
});
