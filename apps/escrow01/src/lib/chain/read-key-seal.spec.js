import { afterEach, describe, expect, it, vi } from 'vitest';
import { prfInputForRelyingParty } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { createZamaSessionKey, openZamaSessionKey } from '@le-space/passkey-wallet';
import { deriveSealingKey, readPrfSeed } from './read-key-seal.js';

const seed = (/** @type {number} */ fill) => new Uint8Array(32).fill(fill);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the read key seal', () => {
	it('derives an AES-GCM key that cannot be exported', async () => {
		const key = await deriveSealingKey(seed(7));
		expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
		expect(key.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
	});

	it('opens a sealed read key with the same seed, and with no other', async () => {
		const readKey = createZamaSessionKey();
		const sealed = await readKey.seal(await deriveSealingKey(seed(7)));

		const opened = await openZamaSessionKey(sealed, await deriveSealingKey(seed(7)));
		expect(opened.address).toBe(readKey.address);
		await expect(openZamaSessionKey(sealed, await deriveSealingKey(seed(8)))).rejects.toThrow();
	});

	it('refuses a seed too short to be a PRF output', async () => {
		await expect(deriveSealingKey(new Uint8Array(16))).rejects.toThrow(TypeError);
	});

	it('asks the passkey with the fixed input for its relying party, never a random one', async () => {
		/** @type {any[]} */
		const asked = [];
		vi.spyOn(navigator.credentials, 'get').mockImplementation(async (options) => {
			asked.push(options);
			return /** @type {any} */ ({
				getClientExtensionResults: () => ({ prf: { results: { first: seed(9).buffer } } })
			});
		});
		const credential = { rawCredentialId: new Uint8Array([1, 2, 3]) };

		const first = await readPrfSeed(credential, 'escrow01.example');
		const second = await readPrfSeed(credential, 'escrow01.example');

		expect(first).toEqual(seed(9));
		expect(second).toEqual(seed(9));
		const fixed = await prfInputForRelyingParty('escrow01.example');
		for (const options of asked) {
			expect(new Uint8Array(options.publicKey.extensions.prf.eval.first)).toEqual(fixed);
			expect(options.publicKey.rpId).toBe('escrow01.example');
			expect(options.publicKey.userVerification).toBe('required');
		}
	});

	it('reports a passkey without PRF as no seed', async () => {
		vi.spyOn(navigator.credentials, 'get').mockResolvedValue(
			/** @type {any} */ ({ getClientExtensionResults: () => ({}) })
		);
		expect(await readPrfSeed({ rawCredentialId: new Uint8Array([1]) }, 'escrow01.example')).toBe(
			null
		);
	});
});
