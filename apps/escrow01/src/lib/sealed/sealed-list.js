/**
 * Writing to a sealed list and reading it back (#127).
 *
 * The write side seals a todo under the list key of the current epoch. The
 * read side is where decryption happens: in the app, between the records
 * OrbitDB hands over and the todos on screen. OrbitDB itself never sees a key
 * and never fails on an entry it cannot open (./envelope.js says why).
 *
 * What a record turns into:
 *
 * - an envelope this session can open — the record with its value opened;
 * - an envelope it cannot — **hidden**, counted, never thrown;
 * - a value that is no envelope — passed on as it is. A delegate's actions
 *   stay in the clear by design, because the delegated controller reads them
 *   (`delegation.js`), and the caller already handles those.
 * - `meta/…` — the list's own entries, not todos. `meta/name` holds the
 *   list's readable name, sealed like a todo, because a sealed list's database
 *   name is random.
 */
import { isEnvelope, openValue, sealValue } from './envelope.js';
import { LIST_SCOPE } from './key-ring.js';

/** The sealed entry that holds a sealed list's readable name. */
export const META_NAME_KEY = 'meta/name';

/** @param {unknown} key */
export const isMetaKey = (key) => typeof key === 'string' && key.startsWith('meta/');

/** The ring holds no list key yet: nothing can be sealed. */
export class NoListKeyError extends Error {
	constructor() {
		super('This list is sealed, and this session holds no key for it yet.');
		this.name = 'NoListKeyError';
	}
}

/**
 * Seal a value for the list, under the highest epoch the ring holds.
 *
 * @param {import('./key-ring.js').KeyRing} ring
 * @param {string} entryKey the key it is written under (a todo's key, `meta/name`)
 * @param {unknown} value
 * @returns {Promise<import('./envelope.js').Envelope>}
 */
export async function sealForList(ring, entryKey, value) {
	const current = ring.current(LIST_SCOPE);
	if (!current) throw new NoListKeyError();
	return sealValue(value, { key: await current.key, scope: 'list', epoch: current.epoch, entryKey });
}

/**
 * @template {{ key: string, value: any }} R
 * @typedef {{ state: 'open', record: R } |
 *   { state: 'plain', record: R } |
 *   { state: 'hidden', key: string, reason: 'no-key' | 'unreadable' }} ReadRecord
 */

/**
 * One record as this session may see it.
 *
 * @template {{ key: string, value: any }} R
 * @param {R} record
 * @param {import('./key-ring.js').KeyRing} ring
 * @returns {Promise<ReadRecord<R>>}
 */
export async function openRecord(record, ring) {
	if (!isEnvelope(record?.value)) return { state: 'plain', record };
	const opened = await openValue(record.value, { keyFor: ring.keyFor, entryKey: record.key });
	if (opened.state === 'open') return { state: 'open', record: { ...record, value: opened.value } };
	return {
		state: 'hidden',
		key: record.key,
		reason: opened.reason === 'no-key' ? 'no-key' : 'unreadable'
	};
}

/**
 * Every record of a list as this session may see it.
 *
 * @template {{ key: string, value: any }} R
 * @param {R[]} records as `db.all()` or the iterator returns them
 * @param {import('./key-ring.js').KeyRing} ring
 * @returns {Promise<{ records: R[], hidden: number, name: string | null }>}
 *   `records` without the `meta/…` ones; `name` from `meta/name` when it opened
 */
export async function openRecords(records, ring) {
	/** @type {R[]} */
	const visible = [];
	let hidden = 0;
	/** @type {string | null} */
	let name = null;

	for (const record of records) {
		const read = await openRecord(record, ring);
		if (read.state === 'hidden') {
			if (!isMetaKey(record.key)) hidden += 1;
			continue;
		}
		if (isMetaKey(record.key)) {
			if (record.key === META_NAME_KEY && read.state === 'open' && typeof read.record.value === 'string') {
				name = read.record.value;
			}
			continue;
		}
		visible.push(read.record);
	}
	return { records: visible, hidden, name };
}
