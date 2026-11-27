import { describe, expect, it } from 'vitest';
import {
	createKeyRing,
	importEpochKey,
	KEY_BYTES,
	KeyRingConflictError,
	LIST_SCOPE,
	newEpochKey,
	taskScope
} from './key-ring.js';

describe('the key ring', () => {
	it('makes keys of 32 random bytes', () => {
		const a = newEpochKey();
		const b = newEpochKey();
		expect(a).toHaveLength(KEY_BYTES);
		expect(a).not.toEqual(b);
	});

	it('imports a key for AES-GCM that cannot be exported', async () => {
		const key = await importEpochKey(newEpochKey());
		expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
		expect(key.extractable).toBe(false);
		await expect(importEpochKey(new Uint8Array(16))).rejects.toThrow(TypeError);
	});

	it('keeps every epoch and seals new entries under the highest', async () => {
		const ring = createKeyRing();
		const keys = [newEpochKey(), newEpochKey(), newEpochKey()];
		ring.add(LIST_SCOPE, 2, keys[2]);
		ring.add(LIST_SCOPE, 0, keys[0]);
		ring.add(LIST_SCOPE, 1, keys[1]);

		expect(ring.epochs(LIST_SCOPE)).toEqual([0, 1, 2]);
		expect(ring.current(LIST_SCOPE)?.epoch).toBe(2);
		expect(ring.raw(LIST_SCOPE, 1)).toEqual(keys[1]);
		expect(await ring.cryptoKey(LIST_SCOPE, 0)).toBeInstanceOf(CryptoKey);
	});

	it('keeps the list and each task apart', async () => {
		const ring = createKeyRing();
		ring.add(taskScope('todo-1'), 0, newEpochKey());

		expect(ring.current(LIST_SCOPE)).toBeNull();
		expect(ring.has(taskScope('todo-1'), 0)).toBe(true);
		expect(ring.has(taskScope('todo-2'), 0)).toBe(false);
		await expect(ring.keyFor({ scope: 'list', epoch: 0, entryKey: 'todo-1' })).resolves.toBeNull();
		await expect(
			ring.keyFor({ scope: 'task', epoch: 0, entryKey: 'todo-1' })
		).resolves.toBeInstanceOf(CryptoKey);
	});

	it('takes the same key twice, and refuses a second one for the same epoch', () => {
		const ring = createKeyRing();
		const key = newEpochKey();

		expect(ring.add(LIST_SCOPE, 0, key)).toBe(true);
		expect(ring.add(LIST_SCOPE, 0, Uint8Array.from(key))).toBe(false);
		expect(() => ring.add(LIST_SCOPE, 0, newEpochKey())).toThrow(KeyRingConflictError);
		expect(ring.raw(LIST_SCOPE, 0)).toEqual(key);
	});

	it('hands out copies, so nobody can change a key it holds', () => {
		const ring = createKeyRing();
		const key = newEpochKey();
		const expected = Uint8Array.from(key);
		ring.add(LIST_SCOPE, 0, key);
		key.fill(0);
		/** @type {Uint8Array} */ (ring.raw(LIST_SCOPE, 0)).fill(0);

		expect(ring.raw(LIST_SCOPE, 0)).toEqual(expected);
	});

	it('refuses what is not a scope, an epoch or a key', () => {
		const ring = createKeyRing();
		expect(() => ring.add('everything', 0, newEpochKey())).toThrow(TypeError);
		expect(() => ring.add('task/', 0, newEpochKey())).toThrow(TypeError);
		expect(() => ring.add(LIST_SCOPE, -1, newEpochKey())).toThrow(TypeError);
		expect(() => ring.add(LIST_SCOPE, 0, new Uint8Array(31))).toThrow(TypeError);
	});

	it('forgets everything on clear', async () => {
		const ring = createKeyRing();
		ring.add(LIST_SCOPE, 0, newEpochKey());
		ring.clear();

		expect(ring.epochs(LIST_SCOPE)).toEqual([]);
		await expect(ring.cryptoKey(LIST_SCOPE, 0)).resolves.toBeNull();
	});
});
