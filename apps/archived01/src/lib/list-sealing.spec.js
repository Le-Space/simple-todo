import { describe, expect, it } from 'vitest';
import { deriveListEncryption, LIST_KEY_INFO, looksLikeTodo } from './list-sealing.js';
import { deriveSubkey } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { payloadEncryption } from './entry-encryption.js';

const prf = new Uint8Array(32).map((_, i) => i * 7 + 1);
const other = new Uint8Array(32).map((_, i) => i * 11 + 3);

describe('the list key', () => {
	it('comes from the PRF output under its own info string, so the same passkey opens it everywhere', async () => {
		const once = await deriveSubkey(prf, LIST_KEY_INFO, { length: 32 });
		const again = await deriveSubkey(prf, LIST_KEY_INFO, { length: 32 });
		expect(again).toEqual(once);
		expect(once).not.toEqual(
			await deriveSubkey(prf, 'simple-todo/archived01/backup-key/v1', { length: 32 })
		);
	});

	it('seals so that another passkey cannot open it', async () => {
		const mine = await deriveListEncryption(prf);
		const theirs = await deriveListEncryption(other);
		const payload = new TextEncoder().encode('secret');
		const sealed = await /** @type {any} */ (mine.data.encrypt)(payload);
		expect(sealed).not.toEqual(payload);
		expect(await mine.data.decrypt(sealed)).toEqual(payload);
		await expect(theirs.data.decrypt(sealed)).rejects.toThrow();
		expect(mine).toMatchObject({
			data: { encrypt: expect.any(Function), decrypt: expect.any(Function) }
		});
		expect(typeof (await payloadEncryption(new Uint8Array(32))).data.encrypt).toBe('function');
	});

	it('with sealing off it still opens what was sealed, and seals nothing new', async () => {
		const sealing = await deriveListEncryption(prf);
		const reading = await deriveListEncryption(prf, { seal: false });
		expect(reading.data.encrypt).toBeUndefined();
		const payload = new TextEncoder().encode('earlier');
		const sealed = await /** @type {any} */ (sealing.data.encrypt)(payload);
		expect(await reading.data.decrypt(sealed)).toEqual(payload);
	});

	it('refuses anything but a PRF output', async () => {
		await expect(deriveListEncryption(/** @type {any} */ ('nope'))).rejects.toThrow(/PRF/);
		await expect(deriveListEncryption(new Uint8Array(8))).rejects.toThrow(/32 bytes/);
	});
});

describe('looksLikeTodo', () => {
	it('knows a todo from sealed bytes and from strangers', () => {
		expect(looksLikeTodo({ text: 'a', completed: false })).toBe(true);
		expect(looksLikeTodo(new Uint8Array([1, 2, 3]))).toBe(false);
		expect(looksLikeTodo({ text: 'a' })).toBe(false);
		expect(looksLikeTodo(null)).toBe(false);
	});
});
