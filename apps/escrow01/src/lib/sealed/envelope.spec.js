import { describe, expect, it } from 'vitest';
import {
	envelopeFromText,
	isEnvelope,
	openText,
	openValue,
	sealText,
	sealValue
} from './envelope.js';
import { createKeyRing, LIST_SCOPE, newEpochKey, taskScope } from './key-ring.js';
import { fromBase64, toBase64 } from './bytes.js';

const todo = { text: 'Buy oat milk', completed: false, createdAt: '2026-11-26T09:00:00.000Z' };

async function ringWith(/** @type {[string, number][]} */ ...slots) {
	const ring = createKeyRing();
	for (const [scopeId, epoch] of slots) ring.add(scopeId, epoch, newEpochKey());
	return ring;
}

async function listKey(/** @type {ReturnType<typeof createKeyRing>} */ ring, epoch = 0) {
	return /** @type {CryptoKey} */ (await ring.cryptoKey(LIST_SCOPE, epoch));
}

describe('a sealed envelope', () => {
	it('keeps scope and epoch in the clear and nothing of the todo', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const envelope = await sealValue(todo, {
			key: await listKey(ring),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-1'
		});

		expect(isEnvelope(envelope)).toBe(true);
		expect(Object.keys(envelope).sort()).toEqual(['ct', 'epoch', 'nonce', 'scope', 'sealed']);
		expect(envelope).toMatchObject({ sealed: 1, scope: 'list', epoch: 0 });
		expect(JSON.stringify(envelope)).not.toContain('oat');
		expect(fromBase64(envelope.nonce)).toHaveLength(12);
	});

	it('opens with the key of its epoch', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const envelope = await sealValue(todo, {
			key: await listKey(ring),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-1'
		});

		await expect(openValue(envelope, { keyFor: ring.keyFor, entryKey: 'todo-1' })).resolves.toEqual(
			{ state: 'open', value: todo }
		);
	});

	it('takes a fresh nonce every time', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const options = {
			key: await listKey(ring),
			scope: /** @type {const} */ ('list'),
			epoch: 0,
			entryKey: 'todo-1'
		};
		const nonces = new Set();
		for (let i = 0; i < 20; i += 1) nonces.add((await sealValue(todo, options)).nonce);
		expect(nonces.size).toBe(20);
	});

	it('stays sealed under a wrong key, and says so instead of throwing', async () => {
		const sealedUnder = await ringWith([LIST_SCOPE, 0]);
		const other = await ringWith([LIST_SCOPE, 0]);
		const envelope = await sealValue(todo, {
			key: await listKey(sealedUnder),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-1'
		});

		await expect(
			openValue(envelope, { keyFor: other.keyFor, entryKey: 'todo-1' })
		).resolves.toEqual({ state: 'sealed', reason: 'unreadable' });
	});

	it('stays sealed for a reader without the epoch, as after a revocation', async () => {
		const ring = await ringWith([LIST_SCOPE, 0], [LIST_SCOPE, 1]);
		const envelope = await sealValue(todo, {
			key: await listKey(ring, 1),
			scope: 'list',
			epoch: 1,
			entryKey: 'todo-1'
		});
		const removed = createKeyRing();
		removed.add(LIST_SCOPE, 0, /** @type {Uint8Array} */ (ring.raw(LIST_SCOPE, 0)));

		await expect(
			openValue(envelope, { keyFor: removed.keyFor, entryKey: 'todo-1' })
		).resolves.toEqual({ state: 'sealed', reason: 'no-key' });
		// An old epoch still opens for him: what he had, he keeps.
		const old = await sealValue(todo, {
			key: await listKey(ring, 0),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-0'
		});
		await expect(openValue(old, { keyFor: removed.keyFor, entryKey: 'todo-0' })).resolves.toEqual({
			state: 'open',
			value: todo
		});
	});

	it('does not open under another entry key: a sealed todo cannot be moved', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const envelope = await sealValue(todo, {
			key: await listKey(ring),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-1'
		});

		await expect(openValue(envelope, { keyFor: ring.keyFor, entryKey: 'todo-2' })).resolves.toEqual(
			{ state: 'sealed', reason: 'unreadable' }
		);
	});

	it('does not open once its epoch or scope is rewritten', async () => {
		const ring = await ringWith([LIST_SCOPE, 0], [LIST_SCOPE, 1]);
		const envelope = await sealValue(todo, {
			key: await listKey(ring, 0),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-1'
		});

		// Relabelled epoch: the ring hands out epoch 1's key, which is the wrong one.
		await expect(
			openValue({ ...envelope, epoch: 1 }, { keyFor: ring.keyFor, entryKey: 'todo-1' })
		).resolves.toEqual({ state: 'sealed', reason: 'unreadable' });
		// Relabelled scope, with the very key that sealed it: the associated data refuses it.
		await expect(
			openValue(
				{ ...envelope, scope: 'task' },
				{ keyFor: () => listKey(ring, 0), entryKey: 'todo-1' }
			)
		).resolves.toEqual({ state: 'sealed', reason: 'unreadable' });
	});

	it('does not open when one byte of the ciphertext changed', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const envelope = await sealValue(todo, {
			key: await listKey(ring),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-1'
		});
		const ct = fromBase64(envelope.ct);
		ct[0] ^= 1;

		await expect(
			openValue({ ...envelope, ct: toBase64(ct) }, { keyFor: ring.keyFor, entryKey: 'todo-1' })
		).resolves.toEqual({ state: 'sealed', reason: 'unreadable' });
	});

	it('opens a task envelope only with that task’s key', async () => {
		const ring = await ringWith([taskScope('todo-1'), 0], [taskScope('todo-2'), 0]);
		const envelope = await sealValue(todo, {
			key: /** @type {CryptoKey} */ (await ring.cryptoKey(taskScope('todo-1'), 0)),
			scope: 'task',
			epoch: 0,
			entryKey: 'todo-1'
		});

		await expect(openValue(envelope, { keyFor: ring.keyFor, entryKey: 'todo-1' })).resolves.toEqual(
			{ state: 'open', value: todo }
		);
		await expect(openValue(envelope, { keyFor: ring.keyFor, entryKey: 'todo-2' })).resolves.toEqual(
			{ state: 'sealed', reason: 'unreadable' }
		);
	});

	it('answers anything that is not an envelope without throwing', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const open = (/** @type {unknown} */ value) =>
			openValue(value, { keyFor: ring.keyFor, entryKey: 'todo-1' });

		for (const value of [null, undefined, 'text', 42, [], todo, { sealed: true }]) {
			await expect(open(value)).resolves.toEqual({ state: 'sealed', reason: 'not-an-envelope' });
		}
		const malformed = { sealed: 1, scope: 'list', epoch: 0, nonce: '%%%', ct: 'AAAA' };
		await expect(open(malformed)).resolves.toEqual({ state: 'sealed', reason: 'unreadable' });
		await expect(open({ ...malformed, epoch: -1 })).resolves.toEqual({
			state: 'sealed',
			reason: 'not-an-envelope'
		});
	});

	it('treats a key lookup that throws as no key', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const envelope = await sealValue(todo, {
			key: await listKey(ring),
			scope: 'list',
			epoch: 0,
			entryKey: 'todo-1'
		});
		const keyFor = () => {
			throw new Error('key store not open');
		};

		await expect(openValue(envelope, { keyFor, entryKey: 'todo-1' })).resolves.toEqual({
			state: 'sealed',
			reason: 'no-key'
		});
	});

	it('refuses to seal what it could not open again', async () => {
		const ring = await ringWith([LIST_SCOPE, 0]);
		const key = await listKey(ring);
		await expect(
			sealValue(undefined, { key, scope: 'list', epoch: 0, entryKey: 'k' })
		).rejects.toThrow(TypeError);
		await expect(
			sealValue(todo, { key, scope: /** @type {any} */ ('all'), epoch: 0, entryKey: 'k' })
		).rejects.toThrow(TypeError);
		await expect(
			sealValue(todo, { key, scope: 'list', epoch: 1.5, entryKey: 'k' })
		).rejects.toThrow(TypeError);
		await expect(sealValue(todo, { key, scope: 'list', epoch: 0, entryKey: '' })).rejects.toThrow(
			TypeError
		);
	});
});

describe('a sealed text', () => {
	it('is one string that opens to the text', async () => {
		const ring = await ringWith([taskScope('todo-1'), 0]);
		const options = {
			key: /** @type {CryptoKey} */ (await ring.cryptoKey(taskScope('todo-1'), 0)),
			scope: /** @type {const} */ ('task'),
			epoch: 0,
			entryKey: 'todo-1'
		};
		const text = await sealText('Call the plumber', options);

		expect(typeof text).toBe('string');
		expect(text).not.toContain('plumber');
		expect(envelopeFromText(text)).toMatchObject({ sealed: 1, scope: 'task', epoch: 0 });
		await expect(openText(text, { keyFor: ring.keyFor, entryKey: 'todo-1' })).resolves.toEqual({
			state: 'open',
			value: 'Call the plumber'
		});
	});

	it('tells a plain text from a sealed one', async () => {
		const ring = await ringWith([taskScope('todo-1'), 0]);
		for (const plain of ['Call the plumber', '', 'aGVsbG8=', btoa('{"sealed":1}')]) {
			expect(envelopeFromText(plain)).toBeNull();
			await expect(openText(plain, { keyFor: ring.keyFor, entryKey: 'todo-1' })).resolves.toEqual({
				state: 'sealed',
				reason: 'not-an-envelope'
			});
		}
	});
});
