import { describe, expect, it } from 'vitest';
import { IDENTITY_BLOCKS_TOPIC } from './identity-blocks.js';
import { answerFor, createNewcomerAnswers, MAX_ENTRIES_CARRIED } from './newcomers.js';

const ADDRESS = '/orbitdb/zdpuAnswerExample';

/**
 * A database whose log holds `count` entries, oldest first, signed by the
 * identities in `signers` in turn.
 *
 * @param {number} count
 * @param {string[]} signers
 */
function databaseWith(count, signers = ['identity-a']) {
	const entries = Array.from({ length: count }, (_, i) => ({
		hash: `entry-${i}`,
		identity: signers[i % signers.length]
	}));
	return {
		address: ADDRESS,
		events: { once: () => {} },
		log: {
			values: async () => entries,
			heads: async () => entries.slice(-1),
			storage: { get: async (/** @type {string} */ hash) => new TextEncoder().encode(hash) }
		}
	};
}

const identities = {
	getIdentity: async (/** @type {string} */ hash) => ({
		bytes: new TextEncoder().encode(`document-of-${hash}`)
	})
};

const text = (/** @type {Uint8Array} */ bytes) => new TextDecoder().decode(bytes);

describe('an answer to a newcomer', () => {
	it('carries its writers’ identity documents and, for a small log, every entry oldest first', async () => {
		const answer = await answerFor(databaseWith(3, ['identity-a', 'identity-b']), identities);

		expect(answer.documents.map(text)).toEqual([
			'document-of-identity-a',
			'document-of-identity-b'
		]);
		expect(answer.entries.map(text)).toEqual(['entry-0', 'entry-1', 'entry-2']);
	});

	it('carries only the heads of a long log', async () => {
		const answer = await answerFor(databaseWith(MAX_ENTRIES_CARRIED + 1), identities);

		expect(answer.entries.map(text)).toEqual([`entry-${MAX_ENTRIES_CARRIED}`]);
		expect(answer.documents.map(text)).toEqual(['document-of-identity-a']);
	});

	it('still carries the entries when a document cannot be had', async () => {
		const answer = await answerFor(databaseWith(2), {
			getIdentity: async () => {
				throw new Error('not here');
			}
		});

		expect(answer.documents).toEqual([]);
		expect(answer.entries.map(text)).toEqual(['entry-0', 'entry-1']);
	});

	it('publishes the documents before the entries, which the newcomer checks against them', async () => {
		/** @type {Array<[string, string]>} */
		const published = [];
		const pubsub = {
			addEventListener: () => {},
			removeEventListener: () => {},
			getSubscribers: () => ['a-newcomer'],
			publish: async (/** @type {string} */ topic, /** @type {Uint8Array} */ bytes) => {
				published.push([topic, text(bytes)]);
			}
		};
		const database = databaseWith(2);
		const newcomers = createNewcomerAnswers(
			() => pubsub,
			() => identities
		);

		newcomers.answerThoseThere(database, newcomers.serve(database));

		await expect.poll(() => published.length).toBe(3);
		expect(published).toEqual([
			[IDENTITY_BLOCKS_TOPIC, 'document-of-identity-a'],
			[ADDRESS, 'entry-0'],
			[ADDRESS, 'entry-1']
		]);
	});
});
