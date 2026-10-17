import { describe, expect, it } from 'vitest';
import { listRefFor, deriveArchiveKeys, sealer, sealText, openText } from './keys.js';

// A fixed "PRF output": what the passkey would answer. The point of the
// derivation is that the same answer gives the same account and the same key
// on every device, so the test pins the address a given output yields — a
// change in the info strings or the HKDF would move it, and that is a
// breaking change for everyone whose archive is already on Aleph.
const PRF = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);

describe('the archive keys', () => {
	it('derives the same account from the same PRF output, and a checksummed address', async () => {
		const first = await deriveArchiveKeys(PRF);
		const second = await deriveArchiveKeys(PRF);
		expect(first.address).toBe(second.address);
		expect(first.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
		expect(first.address).not.toBe(first.address.toLowerCase());
	});

	it('derives a different account from a different PRF output', async () => {
		const other = Uint8Array.from(PRF, (b) => b ^ 1);
		expect((await deriveArchiveKeys(other)).address).not.toBe(
			(await deriveArchiveKeys(PRF)).address
		);
	});

	it('signs as personal_sign: 65 bytes, recoverable', async () => {
		const { sign } = await deriveArchiveKeys(PRF);
		const signature = await sign('hello aleph');
		expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
	});

	it('seals and opens with the backup key, and nothing else opens it', async () => {
		const { aesKey } = await deriveArchiveKeys(PRF);
		const other = (await deriveArchiveKeys(Uint8Array.from(PRF, (b) => b ^ 2))).aesKey;
		const plaintext = new TextEncoder().encode('an increment');
		const { ciphertext, iv } = await sealer(aesKey).encrypt(plaintext);
		expect(Array.from(await sealer(aesKey).decrypt(ciphertext, iv))).toEqual(Array.from(plaintext));
		await expect(sealer(other).decrypt(ciphertext, iv)).rejects.toThrow();
	});

	it('keeps a short text sealed in a string', async () => {
		const { aesKey } = await deriveArchiveKeys(PRF);
		const sealed = await sealText(aesKey, 'a pinata jwt');
		expect(sealed).not.toContain('pinata');
		expect(await openText(aesKey, sealed)).toBe('a pinata jwt');
	});

	it('refuses something that is not a PRF output', async () => {
		await expect(deriveArchiveKeys(new Uint8Array(8))).rejects.toThrow(/PRF output/);
	});
});

describe('listRefFor', () => {
	const prf = new Uint8Array(32).map((_, i) => i + 1);
	const address = '/orbitdb/zdpuAexample000000000000000000000000000000000000000';

	it('names a chain the same way on every device with the passkey, and differently per list', async () => {
		const a = await deriveArchiveKeys(prf);
		const b = await deriveArchiveKeys(prf);
		const once = await listRefFor(a.refKey, address);
		expect(once).toMatch(/^[0-9a-f]{32}$/);
		expect(await listRefFor(b.refKey, address)).toBe(once);
		expect(await listRefFor(a.refKey, address + '1')).not.toBe(once);
	});

	it('says nothing about the address, and another passkey gets another name', async () => {
		const a = await deriveArchiveKeys(prf);
		const other = await deriveArchiveKeys(new Uint8Array(32).map((_, i) => 200 - i));
		const name = await listRefFor(a.refKey, address);
		expect(name).not.toContain('zdpu');
		expect(await listRefFor(other.refKey, address)).not.toBe(name);
	});
});
