import { describe, expect, it } from 'vitest';
import { deriveSubkey } from '@le-space/orbitdb-identity-provider-webauthn-did/vault';
import {
	agreementKeyFromPrf,
	agreementKeyFromSeed,
	isWrappedKey,
	LIST_KEY_AGREEMENT_INFO,
	publicKeyFromText,
	publicKeyToText,
	unwrapKey,
	wrapKey
} from './key-agreement.js';
import { newEpochKey } from './key-ring.js';
import { fromBase64, toBase64 } from './bytes.js';
import { READ_KEY_SEAL_INFO } from '../chain/read-key-seal.js';

const prf = (/** @type {number} */ fill) => new Uint8Array(32).fill(fill);
const hex = (/** @type {string} */ text) =>
	Uint8Array.from(/** @type {RegExpMatchArray} */ (text.match(/../g)), (byte) =>
		parseInt(byte, 16)
	);

// RFC 7748, section 6.1.
const RFC_ALICE_PRIVATE = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
const RFC_ALICE_PUBLIC = hex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
const RFC_BOB_PRIVATE = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
const RFC_BOB_PUBLIC = hex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
const RFC_SHARED = hex('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');

const slot = 'list/0/did:key:zDnaeAlice';

describe('the personal X25519 key', () => {
	it('imports a seed as RFC 7748 defines the key', async () => {
		const alice = await agreementKeyFromSeed(RFC_ALICE_PRIVATE, 'device');
		const bob = await agreementKeyFromSeed(RFC_BOB_PRIVATE, 'device');
		expect(alice.publicKey).toEqual(RFC_ALICE_PUBLIC);
		expect(bob.publicKey).toEqual(RFC_BOB_PUBLIC);

		const bobPublic = await crypto.subtle.importKey(
			'raw',
			RFC_BOB_PUBLIC,
			{ name: 'X25519' },
			true,
			[]
		);
		const shared = await crypto.subtle.deriveBits(
			{ name: 'X25519', public: bobPublic },
			alice.privateKey,
			256
		);
		expect(new Uint8Array(shared)).toEqual(RFC_SHARED);
	});

	it('comes from the PRF output under its own info, the same every time', async () => {
		const once = await agreementKeyFromPrf(prf(7));
		const again = await agreementKeyFromPrf(prf(7));
		const expected = await agreementKeyFromSeed(
			await deriveSubkey(prf(7), 'simple-todo/escrow01/list-key-agreement/v1'),
			'prf'
		);

		expect(LIST_KEY_AGREEMENT_INFO).toBe('simple-todo/escrow01/list-key-agreement/v1');
		expect(once.source).toBe('prf');
		expect(once.publicKey).toEqual(again.publicKey);
		expect(once.publicKey).toEqual(expected.publicKey);
	});

	it('is another passkey’s for another PRF output, and unrelated to the read key’s seal', async () => {
		const mine = await agreementKeyFromPrf(prf(7));
		const theirs = await agreementKeyFromPrf(prf(8));
		const fromSealInfo = await agreementKeyFromSeed(
			await deriveSubkey(prf(7), READ_KEY_SEAL_INFO),
			'prf'
		);

		expect(mine.publicKey).not.toEqual(theirs.publicKey);
		expect(mine.publicKey).not.toEqual(fromSealInfo.publicKey);
	});

	it('keeps its private half out of reach of scripts', async () => {
		const own = await agreementKeyFromPrf(prf(7));
		expect(own.privateKey.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('pkcs8', own.privateKey)).rejects.toThrow();
		await expect(crypto.subtle.exportKey('jwk', own.privateKey)).rejects.toThrow();
	});

	it('refuses what is not a PRF output or a seed', async () => {
		await expect(agreementKeyFromPrf(new Uint8Array(16))).rejects.toThrow(TypeError);
		await expect(agreementKeyFromSeed(new Uint8Array(31), 'device')).rejects.toThrow(TypeError);
	});

	it('travels as base64 and comes back only at 32 bytes', async () => {
		const own = await agreementKeyFromPrf(prf(7));
		expect(publicKeyFromText(publicKeyToText(own.publicKey))).toEqual(own.publicKey);
		expect(publicKeyFromText(toBase64(new Uint8Array(33)))).toBeNull();
		expect(publicKeyFromText('not base64!')).toBeNull();
		expect(publicKeyFromText(undefined)).toBeNull();
	});
});

describe('a wrapped key', () => {
	it('opens for the reader it was sealed for', async () => {
		const bob = await agreementKeyFromPrf(prf(2));
		const key = newEpochKey();
		const copy = await wrapKey(key, bob.publicKey, { slot });

		expect(isWrappedKey(copy)).toBe(true);
		expect(JSON.stringify(copy)).not.toContain(toBase64(key));
		await expect(unwrapKey(copy, bob, { slot })).resolves.toEqual(key);
	});

	it('does not open for anybody else', async () => {
		const bob = await agreementKeyFromPrf(prf(2));
		const mallory = await agreementKeyFromPrf(prf(3));
		const copy = await wrapKey(newEpochKey(), bob.publicKey, { slot });

		await expect(unwrapKey(copy, mallory, { slot })).rejects.toThrow();
	});

	it('does not open when moved to another slot', async () => {
		const bob = await agreementKeyFromPrf(prf(2));
		const copy = await wrapKey(newEpochKey(), bob.publicKey, { slot });

		await expect(unwrapKey(copy, bob, { slot: 'list/1/did:key:zDnaeAlice' })).rejects.toThrow();
	});

	it('does not open once altered', async () => {
		const bob = await agreementKeyFromPrf(prf(2));
		const copy = await wrapKey(newEpochKey(), bob.publicKey, { slot });
		const ct = fromBase64(copy.ct);
		ct[3] ^= 1;
		const otherSender = await agreementKeyFromPrf(prf(9));

		await expect(unwrapKey({ ...copy, ct: toBase64(ct) }, bob, { slot })).rejects.toThrow();
		await expect(
			unwrapKey({ ...copy, epk: toBase64(otherSender.publicKey) }, bob, { slot })
		).rejects.toThrow();
	});

	it('is a different copy every time, from a fresh sender key', async () => {
		const bob = await agreementKeyFromPrf(prf(2));
		const key = newEpochKey();
		const first = await wrapKey(key, bob.publicKey, { slot });
		const second = await wrapKey(key, bob.publicKey, { slot });

		expect(first.epk).not.toBe(second.epk);
		expect(first.ct).not.toBe(second.ct);
		await expect(unwrapKey(second, bob, { slot })).resolves.toEqual(key);
	});

	it('is not sealed for a public key of low order', async () => {
		await expect(wrapKey(newEpochKey(), new Uint8Array(32), { slot })).rejects.toThrow();
	});

	it('refuses what it cannot be', async () => {
		const bob = await agreementKeyFromPrf(prf(2));
		await expect(wrapKey(new Uint8Array(16), bob.publicKey, { slot })).rejects.toThrow(TypeError);
		await expect(wrapKey(newEpochKey(), new Uint8Array(31), { slot })).rejects.toThrow(TypeError);
		await expect(wrapKey(newEpochKey(), bob.publicKey, { slot: '' })).rejects.toThrow(TypeError);

		const copy = await wrapKey(newEpochKey(), bob.publicKey, { slot });
		for (const broken of [
			null,
			'copy',
			{ ...copy, v: 2 },
			{ ...copy, nonce: 'AAAA' },
			{ ...copy, ct: '' }
		]) {
			expect(isWrappedKey(broken)).toBe(false);
			await expect(unwrapKey(broken, bob, { slot })).rejects.toThrow(TypeError);
		}
	});
});
