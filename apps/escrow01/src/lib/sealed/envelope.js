/**
 * The envelope a sealed list writes in place of a todo (#127).
 *
 * A list entry stays `{ op, key, value }`. `op` and `key` stay in the clear;
 * `value` becomes
 *
 *     { sealed: 1, scope: 'list' | 'task', epoch, nonce, ct }
 *
 * with `ct` the AES-GCM ciphertext of the todo as JSON, under the list's key
 * (`scope: 'list'`) or a delegated todo's own key (`scope: 'task'`) of that
 * epoch.
 *
 * Why here and not in OrbitDB's `encryption.data`: in `@orbitdb/core` 4.0.0
 * `Entry.decode` throws on a payload it cannot decrypt, and `log.joinEntry`
 * aborts on that throw with everything behind the entry. A reader without a
 * key for some entries is the normal case in a sealed list — a delegate holds
 * only his task's key — so every such reader would lose the history behind
 * the first entry he cannot open. Sealed in the value instead, OrbitDB moves
 * the entry like any other, and this module, in the app's read path, decides
 * what a reader sees. An envelope without a matching key is hidden; nothing
 * throws.
 *
 * The associated data binds a ciphertext to its scope, epoch and key, so a
 * writer cannot move a sealed todo under another key, and an envelope sealed
 * for one task does not open as another.
 *
 * WebCrypto AES-GCM-256 with a raw key and a fresh 12-byte nonce for every
 * envelope. The keys are random 32 bytes (./key-ring.js), so a password hash
 * like PBKDF2 would add nothing.
 */
import { base64OrNull, fromBase64, toBase64, utf8 } from './bytes.js';

/** Changing this makes every sealed entry unreadable: treat it as breaking. */
const ADDITIONAL_DATA_LABEL = 'simple-todo/escrow01/envelope/v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** @type {readonly EnvelopeScope[]} */
export const ENVELOPE_SCOPES = Object.freeze(['list', 'task']);

/** @typedef {'list' | 'task'} EnvelopeScope */

/**
 * @typedef {object} Envelope
 * @property {1} sealed
 * @property {EnvelopeScope} scope
 * @property {number} epoch
 * @property {string} nonce base64, 12 bytes
 * @property {string} ct base64, ciphertext and tag
 */

/**
 * Which key opens an envelope. `entryKey` is there for the `task` scope, whose
 * key belongs to one todo.
 *
 * @typedef {(slot: { scope: EnvelopeScope, epoch: number, entryKey: string }) =>
 *   CryptoKey | null | undefined | Promise<CryptoKey | null | undefined>} KeyLookup
 */

/**
 * What a reader gets back. Never a throw: an entry from a peer may be anything.
 *
 * - `not-an-envelope` — the value is not sealed at all, or malformed.
 * - `no-key` — sealed under a key this reader does not hold.
 * - `unreadable` — a key was there and did not open it: another key of the
 *   same epoch, a moved or altered ciphertext.
 *
 * @typedef {{ state: 'open', value: any } |
 *   { state: 'sealed', reason: 'not-an-envelope' | 'no-key' | 'unreadable' }} Opened
 */

/**
 * @param {unknown} value
 * @returns {value is Envelope}
 */
export function isEnvelope(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = /** @type {Record<string, unknown>} */ (value);
	return (
		candidate.sealed === 1 &&
		ENVELOPE_SCOPES.includes(/** @type {EnvelopeScope} */ (candidate.scope)) &&
		isEpoch(candidate.epoch) &&
		typeof candidate.nonce === 'string' &&
		typeof candidate.ct === 'string'
	);
}

/**
 * Seal one value.
 *
 * @param {unknown} value anything `JSON.stringify` turns into text
 * @param {{ key: CryptoKey, scope: EnvelopeScope, epoch: number, entryKey: string }} options
 *   `key` is AES-GCM-256 (`./key-ring.js`); `entryKey` is the key the entry is
 *   written under, or for a delegate's field the todo's key
 * @returns {Promise<Envelope>}
 */
export async function sealValue(value, { key, scope, epoch, entryKey }) {
	if (!ENVELOPE_SCOPES.includes(scope)) throw new TypeError(`Unknown envelope scope: ${scope}`);
	if (!isEpoch(epoch)) throw new TypeError('An epoch is a whole number, zero or more.');
	if (typeof entryKey !== 'string' || entryKey.length === 0) {
		throw new TypeError('An envelope needs the key it is written under.');
	}
	const json = JSON.stringify(value);
	if (json === undefined) throw new TypeError('Only JSON values can be sealed.');

	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const ct = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: /** @type {BufferSource} */ (nonce),
			additionalData: /** @type {BufferSource} */ (additionalData(scope, epoch, entryKey))
		},
		key,
		/** @type {BufferSource} */ (utf8(json))
	);
	return { sealed: 1, scope, epoch, nonce: toBase64(nonce), ct: toBase64(new Uint8Array(ct)) };
}

/**
 * Open one envelope, or say why not.
 *
 * @param {unknown} envelope a value as it came out of the list
 * @param {{ keyFor: KeyLookup, entryKey: string }} options
 * @returns {Promise<Opened>}
 */
export async function openValue(envelope, { keyFor, entryKey }) {
	if (!isEnvelope(envelope)) return { state: 'sealed', reason: 'not-an-envelope' };

	const nonce = base64OrNull(envelope.nonce);
	const ct = base64OrNull(envelope.ct);
	if (!nonce || nonce.length !== NONCE_BYTES || !ct || ct.length < TAG_BYTES) {
		return { state: 'sealed', reason: 'unreadable' };
	}

	let key;
	try {
		key = await keyFor({ scope: envelope.scope, epoch: envelope.epoch, entryKey });
	} catch {
		key = null;
	}
	if (!key) return { state: 'sealed', reason: 'no-key' };

	try {
		const plain = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: /** @type {BufferSource} */ (nonce),
				additionalData: /** @type {BufferSource} */ (
					additionalData(envelope.scope, envelope.epoch, entryKey)
				)
			},
			key,
			/** @type {BufferSource} */ (ct)
		);
		return { state: 'open', value: JSON.parse(new TextDecoder().decode(plain)) };
	} catch {
		return { state: 'sealed', reason: 'unreadable' };
	}
}

/**
 * An envelope as one string, for a field that must stay a string: the text a
 * delegate renames a todo to (`patch.text`), which the delegated controller
 * checks is a string and nothing more.
 *
 * @param {string} text
 * @param {{ key: CryptoKey, scope: EnvelopeScope, epoch: number, entryKey: string }} options
 * @returns {Promise<string>} base64 of the envelope's JSON
 */
export async function sealText(text, options) {
	if (typeof text !== 'string') throw new TypeError('sealText seals a string.');
	return toBase64(utf8(JSON.stringify(await sealValue(text, options))));
}

/**
 * The envelope inside a string from `sealText`, or null for any other string.
 *
 * @param {unknown} text
 * @returns {Envelope | null}
 */
export function envelopeFromText(text) {
	if (typeof text !== 'string' || text.length === 0) return null;
	try {
		const parsed = JSON.parse(new TextDecoder().decode(fromBase64(text)));
		return isEnvelope(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Open a string from `sealText`. A string that is no envelope, and an envelope
 * that holds anything but a string, are `not-an-envelope`.
 *
 * @param {unknown} text
 * @param {{ keyFor: KeyLookup, entryKey: string }} options
 * @returns {Promise<Opened>}
 */
export async function openText(text, options) {
	const envelope = envelopeFromText(text);
	if (!envelope) return { state: 'sealed', reason: 'not-an-envelope' };
	const opened = await openValue(envelope, options);
	if (opened.state === 'open' && typeof opened.value !== 'string') {
		return { state: 'sealed', reason: 'not-an-envelope' };
	}
	return opened;
}

/** @param {unknown} value @returns {value is number} */
function isEpoch(value) {
	return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * @param {EnvelopeScope} scope
 * @param {number} epoch
 * @param {string} entryKey
 */
function additionalData(scope, epoch, entryKey) {
	return utf8(`${ADDITIONAL_DATA_LABEL}\n${scope}\n${epoch}\n${entryKey}`);
}
