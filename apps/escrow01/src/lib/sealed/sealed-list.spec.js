import { describe, expect, it } from 'vitest';
import { createKeyRing, LIST_SCOPE, newEpochKey } from './key-ring.js';
import {
	isMetaKey,
	META_NAME_KEY,
	NoListKeyError,
	openRecord,
	openRecords,
	sealForList
} from './sealed-list.js';

const todo = (/** @type {string} */ text) => ({
	text,
	completed: false,
	createdAt: '2026-11-26T09:00:00.000Z'
});

function ringAt(/** @type {number[]} */ ...epochs) {
	const ring = createKeyRing();
	for (const epoch of epochs) ring.add(LIST_SCOPE, epoch, newEpochKey());
	return ring;
}

describe('writing to a sealed list', () => {
	it('seals under the highest epoch the ring holds', async () => {
		const ring = ringAt(0, 1);
		const envelope = await sealForList(ring, 'todo-1', todo('Water the plants'));
		expect(envelope).toMatchObject({ sealed: 1, scope: 'list', epoch: 1 });
	});

	it('refuses to write without a list key, rather than write in the clear', async () => {
		await expect(sealForList(createKeyRing(), 'todo-1', todo('x'))).rejects.toThrow(NoListKeyError);
	});
});

describe('reading a sealed list', () => {
	it('opens what it holds the keys for, hides the rest, and does not throw', async () => {
		const owner = ringAt(0, 1);
		const removedAfterEpoch0 = createKeyRing();
		removedAfterEpoch0.add(LIST_SCOPE, 0, /** @type {Uint8Array} */ (owner.raw(LIST_SCOPE, 0)));
		const writeAt = async (
			/** @type {number} */ epoch,
			/** @type {string} */ key,
			/** @type {any} */ value
		) => {
			const ring = createKeyRing();
			ring.add(LIST_SCOPE, epoch, /** @type {Uint8Array} */ (owner.raw(LIST_SCOPE, epoch)));
			return { key, hash: `hash-${key}`, value: await sealForList(ring, key, value) };
		};

		const records = [
			await writeAt(0, META_NAME_KEY, 'Groceries'),
			await writeAt(0, 'todo-old', todo('Old one')),
			await writeAt(1, 'todo-new', todo('New one')),
			{
				key: 'delegation-action/1',
				hash: 'hash-action',
				value: { action: 'set-completed', setCompleted: true }
			},
			{
				key: 'todo-broken',
				hash: 'hash-broken',
				value: { sealed: 1, scope: 'list', epoch: 0, nonce: 'AAAA', ct: 'AAAA' }
			}
		];

		const forOwner = await openRecords(records, owner);
		expect(forOwner.name).toBe('Groceries');
		expect(forOwner.hidden).toBe(1);
		expect(forOwner.records.map((record) => record.key)).toEqual([
			'todo-old',
			'todo-new',
			'delegation-action/1'
		]);
		expect(forOwner.records[1]).toEqual({
			key: 'todo-new',
			hash: 'hash-todo-new',
			value: todo('New one')
		});

		const forRemoved = await openRecords(records, removedAfterEpoch0);
		expect(forRemoved.name).toBe('Groceries');
		expect(forRemoved.records.map((record) => record.key)).toEqual([
			'todo-old',
			'delegation-action/1'
		]);
		expect(forRemoved.hidden).toBe(2);

		const forStranger = await openRecords(records, createKeyRing());
		expect(forStranger.name).toBeNull();
		expect(forStranger.records.map((record) => record.key)).toEqual(['delegation-action/1']);
		expect(forStranger.hidden).toBe(3);
	});

	it('says why one record stays hidden', async () => {
		const ring = ringAt(0);
		const record = { key: 'todo-1', value: await sealForList(ring, 'todo-1', todo('x')) };

		await expect(openRecord(record, createKeyRing())).resolves.toEqual({
			state: 'hidden',
			key: 'todo-1',
			reason: 'no-key'
		});
		await expect(openRecord({ ...record, key: 'todo-2' }, ring)).resolves.toEqual({
			state: 'hidden',
			key: 'todo-2',
			reason: 'unreadable'
		});
		await expect(openRecord({ key: 'todo-3', value: todo('plain') }, ring)).resolves.toEqual({
			state: 'plain',
			record: { key: 'todo-3', value: todo('plain') }
		});
	});

	it('takes the name only from a sealed string', async () => {
		const ring = ringAt(0);
		const asObject = {
			key: META_NAME_KEY,
			value: await sealForList(ring, META_NAME_KEY, { name: 'x' })
		};
		const inClear = { key: META_NAME_KEY, value: 'Planted name' };

		await expect(openRecords([asObject], ring)).resolves.toMatchObject({ name: null, records: [] });
		await expect(openRecords([inClear], ring)).resolves.toMatchObject({ name: null, records: [] });
		expect(isMetaKey('meta/anything')).toBe(true);
		expect(isMetaKey('todo-1')).toBe(false);
	});
});
