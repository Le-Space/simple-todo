import { describe, expect, it } from 'vitest';
import { agreementKeyFromPrf, openTextSealedFor, unwrapKey, wrapKey } from './key-agreement.js';
import { openRegistryName, sealRegistryName, withOpenedNames } from './registry-names.js';
import { newEpochKey } from './key-ring.js';

const LIST_A = '/orbitdb/zdpuAuK3BHpS7NvMBivynypqciYCuy2UW77XYBPUYRnLjnw13';
const LIST_B = '/orbitdb/zdpuB2xpmNrmpgVQvhEXrQZbDeVwKWbX3b2dD3vkxtBuh8k6z';
const keyFor = (/** @type {number} */ fill) => agreementKeyFromPrf(new Uint8Array(32).fill(fill));

describe('a list name in one’s own registry', () => {
	it('is sealed to one’s own key and opens on any device of the same passkey', async () => {
		const here = await keyFor(1);
		const sealedName = await sealRegistryName('Tax return 2026', {
			address: LIST_A,
			publicKey: here.publicKey
		});
		const entry = { address: LIST_A, name: '', sealedName };

		expect(JSON.stringify(entry)).not.toContain('Tax');
		await expect(openRegistryName(entry, await keyFor(1))).resolves.toBe('Tax return 2026');
	});

	it('stays sealed for anyone else, and under another list’s address', async () => {
		const own = await keyFor(1);
		const sealedName = await sealRegistryName('Tax return 2026', {
			address: LIST_A,
			publicKey: own.publicKey
		});

		await expect(
			openRegistryName({ address: LIST_A, sealedName }, await keyFor(2))
		).resolves.toBeNull();
		await expect(openRegistryName({ address: LIST_B, sealedName }, own)).resolves.toBeNull();
		await expect(openRegistryName({ address: LIST_A, sealedName }, null)).resolves.toBeNull();
		await expect(
			openRegistryName({ address: LIST_A, sealedName: { v: 1, epk: 'x' } }, own)
		).resolves.toBeNull();
	});

	it('of an open list is read as it stands', async () => {
		await expect(
			openRegistryName({ address: LIST_A, name: 'Shared groceries' }, null)
		).resolves.toBe('Shared groceries');
	});

	it('is filled in for the switcher, and marked where it stays sealed', async () => {
		const own = await keyFor(1);
		const entries = [
			{
				address: LIST_A,
				name: '',
				sealedName: await sealRegistryName('Tax', { address: LIST_A, publicKey: own.publicKey })
			},
			{ address: LIST_B, name: 'Shared groceries' }
		];

		await expect(withOpenedNames(entries, own)).resolves.toEqual([
			{ ...entries[0], name: 'Tax', nameSealed: false },
			{ ...entries[1], nameSealed: false }
		]);
		await expect(withOpenedNames(entries, await keyFor(2))).resolves.toEqual([
			{ ...entries[0], name: '', nameSealed: true },
			{ ...entries[1], nameSealed: false }
		]);
	});

	it('never opens as a key, nor a key as a name', async () => {
		const own = await keyFor(1);
		const sealedName = await sealRegistryName('x'.repeat(32), {
			address: LIST_A,
			publicKey: own.publicKey
		});
		const wrapped = await wrapKey(newEpochKey(), own.publicKey, {
			slot: `registry-name/${LIST_A}`
		});

		await expect(unwrapKey(sealedName, own, { slot: `registry-name/${LIST_A}` })).rejects.toThrow();
		await expect(
			openTextSealedFor(wrapped, own, { slot: `registry-name/${LIST_A}` })
		).rejects.toThrow();
	});
});
