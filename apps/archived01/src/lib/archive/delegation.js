// Who pays for the archive on Aleph: the archive key itself, or an owner
// account that never enters the browser (archived01).
//
// The archive key is derived from the passkey and lives in this tab. When it
// is also the account holding the credits, whoever gets hold of it — a bad
// dependency, a script injected into the page — can spend the credits, forget
// the archive and probably move what is left. Aleph offers the split: an
// account's `security` aggregate names other keys that may send messages on
// its behalf, each limited to message types and channels. The owner grants
// the archive key `STORE` on this chapter's channel, once, from outside the
// browser; the key then signs, and the owner is checked and billed. A leaked
// key can add storage on one channel, and nothing else.
//
// The grant is an AGGREGATE the owner signs. This module never signs: it
// builds the entry, merges it into the owner's current list (an aggregate key
// is replaced as a whole) and prints the `aleph` CLI command the owner runs
// where the owner's key lives. The owner's list is public, so the page can
// read it, show the whole list before anything is signed, and say whether the
// grant is in place.

import { getAddress, isAddress } from 'viem';

/** Aleph keeps permissions under this aggregate key, on a channel of the same name. */
export const SECURITY = 'security';

/**
 * One entry of an owner's `security.authorizations`.
 * @typedef {object} Authorization
 * @property {string} address - the delegate
 * @property {string} [chain]
 * @property {string[]} [types] - message types; every type when absent
 * @property {string[]} [channels] - every channel when absent
 * @property {string[]} [post_types]
 * @property {string[]} [aggregate_keys]
 */

/**
 * An owner address as Aleph keys it: EIP-55 checksummed. Throws on anything
 * that is not an Ethereum address.
 * @param {string} text
 */
export function normalizeOwner(text) {
	const trimmed = String(text ?? '').trim();
	if (!isAddress(trimmed, { strict: false })) {
		throw new Error('not an Ethereum address (0x and 40 hex characters)');
	}
	return getAddress(trimmed);
}

/**
 * The grant this chapter asks for: STORE on its channel, and FORGET only when
 * the owner wants deleting from the browser too.
 *
 * @param {{ delegate: string, channel: string, forget?: boolean }} args
 * @returns {Authorization}
 */
export function authorizationEntry({ delegate, channel, forget = false }) {
	return {
		address: delegate,
		chain: 'ETH',
		types: forget ? ['STORE', 'FORGET'] : ['STORE'],
		channels: [channel]
	};
}

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
	String(a).toLowerCase() === String(b).toLowerCase();

/**
 * What the owner's list grants the delegate on this channel.
 *
 * @param {Authorization[]} list
 * @param {string} delegate
 * @param {string} channel
 * @returns {{ entry: Authorization | null, store: boolean, forget: boolean }}
 */
export function findAuthorization(list, delegate, channel) {
	const entry =
		(Array.isArray(list) ? list : []).find(
			(a) =>
				a &&
				same(a.address, delegate) &&
				(!Array.isArray(a.channels) || a.channels.includes(channel))
		) ?? null;
	if (!entry) return { entry: null, store: false, forget: false };
	const types = Array.isArray(entry.types) ? entry.types : null;
	return {
		entry,
		store: types === null || types.includes('STORE'),
		forget: types === null || types.includes('FORGET')
	};
}

/**
 * The complete list after the grant: every other delegate as it was, this
 * one replaced.
 * @param {Authorization[]} list
 * @param {Authorization} entry
 */
export function mergeAuthorizations(list, entry) {
	return [
		...(Array.isArray(list) ? list : []).filter((a) => a && !same(a.address, entry.address)),
		entry
	];
}

/**
 * The complete list after the revocation.
 * @param {Authorization[]} list
 * @param {string} delegate
 */
export function withoutAuthorization(list, delegate) {
	return (Array.isArray(list) ? list : []).filter((a) => a && !same(a.address, delegate));
}

/**
 * The `aleph` CLI (0.20.0) command that writes the list, run with the owner
 * as the active account (`aleph account use <name>`). A first grant creates
 * the aggregate; a later one edits the `authorizations` subkey, which is
 * replaced as a whole — hence the complete list.
 *
 * @param {{ exists: boolean, authorizations: Authorization[] }} args
 */
export function writeAuthorizationsCommand({ exists, authorizations }) {
	const list = JSON.stringify(authorizations);
	return exists
		? `aleph aggregate edit --key ${SECURITY} --channel ${SECURITY} --subkey authorizations --content '${list}' -y`
		: `aleph aggregate create --key ${SECURITY} --channel ${SECURITY} --content '${JSON.stringify({ authorizations })}'`;
}

/** Reads the owner's permissions back, from any machine. @param {string} owner */
export function verifyCommand(owner) {
	return `aleph aggregate get ${SECURITY} --address ${owner}`;
}

/**
 * Deleting without a FORGET grant: the owner forgets the STOREs by the file
 * hashes, from where the owner's key lives.
 *
 * @param {{ cids: string[], channel: string }} args
 */
export function deleteCommand({ cids, channel }) {
	return `aleph file delete ${cids.join(' ')} --channel ${channel} --reason "archive deleted by its owner (simple-todo archived01)"`;
}

/**
 * The owner's current list, read from Aleph's public API. `exists` says
 * whether the aggregate is there at all (a first grant creates it).
 *
 * @param {string} owner
 * @param {{ apiHost?: string, fetch?: typeof fetch }} [options]
 * @returns {Promise<{ exists: boolean, authorizations: Authorization[] }>}
 */
export async function readAuthorizations(owner, options = {}) {
	const apiHost = options.apiHost ?? 'https://api2.aleph.im';
	const doFetch = options.fetch ?? globalThis.fetch;
	const response = await doFetch(
		`${apiHost}/api/v0/aggregates/${encodeURIComponent(owner)}.json?keys=${SECURITY}`
	);
	if (response.status === 404) return { exists: false, authorizations: [] };
	if (!response.ok)
		throw new Error(`Aleph did not answer the owner's permissions: ${response.status}`);
	const body = await response.json().catch(() => ({}));
	const security = body?.data?.[SECURITY];
	const list = security?.authorizations;
	return {
		exists: security != null && typeof security === 'object',
		authorizations: Array.isArray(list) ? list : []
	};
}
