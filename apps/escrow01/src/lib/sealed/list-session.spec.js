import { describe, expect, it } from 'vitest';
import { keysToWrite } from './list-session.js';

const OWNER = 'did:key:zDnaeOwnerExample';
const WRITER = 'did:key:zDnaeWriterExample';
const STRANGER = 'did:key:zDnaeStrangerExample';

/** A list whose controller names an owner and one writer. */
const list = {
	access: { capabilities: async () => ({ admin: [OWNER], write: [OWNER, WRITER] }) }
};

/**
 * Keys that hold no list key until `arrive()`.
 */
function keysWithoutKeyYet() {
	let sealable = false;
	/** @type {Array<(value: boolean) => void>} */
	const waiting = [];
	/** @type {number[]} */
	const waited = [];
	return {
		waited,
		arrive() {
			sealable = true;
			for (const resolve of waiting.splice(0)) resolve(true);
		},
		keys: /** @type {any} */ ({
			canSeal: () => sealable,
			/** @param {number} timeoutMs */
			whenSealable(timeoutMs) {
				waited.push(timeoutMs);
				if (sealable) return Promise.resolve(true);
				return new Promise((resolve) => {
					waiting.push(resolve);
					setTimeout(() => resolve(false), timeoutMs);
				});
			}
		})
	};
}

describe('a write to a sealed list whose key has not arrived yet', () => {
	it('waits for the key when the list lets this session write', async () => {
		for (const did of [OWNER, WRITER]) {
			const pending = keysWithoutKeyYet();
			const writing = keysToWrite(pending.keys, list, did, { timeoutMs: 10_000 });
			await Promise.resolve();
			await Promise.resolve();
			pending.arrive();
			await expect(writing).resolves.toBe(pending.keys);
			expect(pending.waited).toEqual([10_000]);
			expect(pending.keys.canSeal()).toBe(true);
		}
	});

	it('does not wait for anyone else, who is refused at once as before', async () => {
		const pending = keysWithoutKeyYet();
		await expect(keysToWrite(pending.keys, list, STRANGER)).resolves.toBe(pending.keys);
		await expect(keysToWrite(pending.keys, list, undefined)).resolves.toBe(pending.keys);
		expect(pending.waited).toEqual([]);
	});

	it('does not wait when the key is there, or when the list is not sealed', async () => {
		const pending = keysWithoutKeyYet();
		pending.arrive();
		await expect(keysToWrite(pending.keys, list, OWNER)).resolves.toBe(pending.keys);
		expect(pending.waited).toEqual([]);
		await expect(keysToWrite(null, list, OWNER)).resolves.toBe(null);
	});

	it('gives up after its time, and leaves the refusal to the write', async () => {
		const pending = keysWithoutKeyYet();
		await expect(keysToWrite(pending.keys, list, OWNER, { timeoutMs: 20 })).resolves.toBe(
			pending.keys
		);
		expect(pending.keys.canSeal()).toBe(false);
	});
});
