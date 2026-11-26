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
 *
 * Which key a todo is sealed under follows its delegation: a todo handed to
 * someone is sealed under its own task key, which the delegate holds; every
 * other todo under the list key, which he does not. A delegate's rename
 * (`patch.text` of his action) is sealed under the same task key.
 */
import { isEnvelope, openText, openValue, sealText, sealValue } from './envelope.js';
import { LIST_SCOPE, taskScope } from './key-ring.js';

/**
 * A sealed list's database name: this prefix and random characters. The
 * prefix is how every peer tells a sealed list from one made before #127,
 * before it has read a single entry — a writer must never write a todo in the
 * clear into a list that is sealed, just because its key has not arrived yet.
 */
export const SEALED_LIST_NAME_PREFIX = 'sealed-v1-';

/** A fresh database name for a sealed list. */
export function sealedListName() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return (
		SEALED_LIST_NAME_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
	);
}

/** @param {unknown} name a database's name */
export const isSealedListName = (name) =>
	typeof name === 'string' && name.startsWith(SEALED_LIST_NAME_PREFIX);

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
	return sealValue(value, {
		key: await current.key,
		scope: 'list',
		epoch: current.epoch,
		entryKey
	});
}

/**
 * Seal a todo under the key its delegation calls for: its task key while it
 * is handed to someone and not taken back, the list key otherwise.
 *
 * @param {import('./key-ring.js').KeyRing} ring
 * @param {string} todoKey
 * @param {HandedOver} todo
 * @returns {Promise<import('./envelope.js').Envelope>}
 */
export async function sealTodo(ring, todoKey, todo) {
	if (!isHandedOver(todo)) return sealForList(ring, todoKey, todo);
	const current = ring.current(taskScope(todoKey));
	if (!current) throw new NoTaskKeyError(todoKey);
	return sealValue(todo, {
		key: await current.key,
		scope: 'task',
		epoch: current.epoch,
		entryKey: todoKey
	});
}

/**
 * A delegate's new text for his todo, sealed under its task key, as the string
 * the delegated controller expects in `patch.text`.
 *
 * @param {import('./key-ring.js').KeyRing} ring
 * @param {string} todoKey the todo's key, not the action's
 * @param {string} text
 */
export async function sealActionText(ring, todoKey, text) {
	const current = ring.current(taskScope(todoKey));
	if (!current) throw new NoTaskKeyError(todoKey);
	return sealText(text, {
		key: await current.key,
		scope: 'task',
		epoch: current.epoch,
		entryKey: todoKey
	});
}

/**
 * A delegate's action as this session may apply it: its `patch.text` opened,
 * or dropped when it does not open. An action whose text was never sealed (a
 * list from before #127) is returned as it is.
 *
 * @template {{ taskKey?: string, patch?: { text?: unknown } }} A
 * @param {A} action
 * @param {import('./key-ring.js').KeyRing} ring
 * @returns {Promise<A>}
 */
export async function openActionText(action, ring) {
	const text = action?.patch?.text;
	if (typeof text !== 'string' || typeof action.taskKey !== 'string') return action;
	const opened = await openText(text, { keyFor: ring.keyFor, entryKey: action.taskKey });
	if (opened.state === 'open') return { ...action, patch: { ...action.patch, text: opened.value } };
	if (opened.state === 'sealed' && opened.reason === 'not-an-envelope') return action;
	const patch = { ...action.patch };
	delete patch.text;
	return { ...action, patch };
}

/**
 * A todo as far as its seal depends on it.
 *
 * @typedef {Record<string, unknown> & {
 *   delegation?: { delegateDid?: string | null, revokedAt?: string | null } | null
 * }} HandedOver
 */

/** @param {HandedOver} todo */
function isHandedOver(todo) {
	const delegation = todo?.delegation;
	return Boolean(delegation?.delegateDid) && !delegation?.revokedAt;
}

/** The ring holds no key for a todo that is handed to someone. */
export class NoTaskKeyError extends Error {
	/** @param {string} todoKey */
	constructor(todoKey) {
		super(`This todo is handed to someone, and this session holds no key for it: ${todoKey}`);
		this.name = 'NoTaskKeyError';
		this.todoKey = todoKey;
	}
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
			if (
				record.key === META_NAME_KEY &&
				read.state === 'open' &&
				typeof read.record.value === 'string'
			) {
				name = read.record.value;
			}
			continue;
		}
		visible.push(read.record);
	}
	return { records: visible, hidden, name };
}
