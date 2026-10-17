// Sealing the list itself (archived01): a choice on the consent screen, a key
// from the passkey.
//
// OrbitDB has no read permission: whoever holds an address and reaches a peer
// that has it reads everything in it, the relay that keeps it included. The
// privacy01 chapter seals a list's entries so that holding the address buys
// replication and nothing else, and hands the key around in envelopes. This
// chapter needs none of the envelopes: with a passkey the list is the
// passkey's, so the key can come from the passkey too — the same PRF output
// that already yields the archive account and the backup key, through HKDF
// under a third info string. Every device with the passkey derives the same
// key; nobody else has it; the relay stores sealed entries.
//
// A choice, not a default: the earlier chapters' lists are open on purpose,
// and a reader comparing them should see what the one checkbox changes. The
// consent statement rewrites its sentence with it. Sealing is not part of the
// address (entry-encryption.js says why), so an existing list keeps the
// entries it already had in the clear and seals the ones that follow.

import { writable } from 'svelte/store';
import { deriveSubkey } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { recall, remember } from '@simple-todo/todo/browser-memory.js';
import { payloadEncryption } from './entry-encryption.js';

/** Bumping rotates the list key: entries sealed before become unreadable. */
export const LIST_KEY_INFO = 'simple-todo/archived01/list-key/v1';
export const SEAL_LIST_STORAGE_KEY = 'simpleTodo.sealList';

/** @returns {boolean} the remembered choice; on, when nobody chose yet */
export function getSealListEnabled() {
	try {
		const stored = recall(SEAL_LIST_STORAGE_KEY);
		if (stored === 'true') return true;
		if (stored === 'false') return false;
	} catch {
		// No storage: the default.
	}
	return true;
}

export const sealListStore = writable(getSealListEnabled());

/** @param {boolean} enabled */
export function setSealListEnabled(enabled) {
	sealListStore.set(enabled);
	try {
		remember(SEAL_LIST_STORAGE_KEY, String(enabled));
	} catch {
		// The choice holds for this session and no longer.
	}
}

/** @type {Awaited<ReturnType<typeof deriveListEncryption>> | null} */
let active = null;

/**
 * The open list's encryption, set by the start (p2p.js) and read by whoever
 * opens another copy of a sealed list — the archive's restore. Kept here
 * rather than in p2p.js so that the archive module, which the page loads
 * before consent, does not pull libp2p in with it.
 */
export function getActiveListEncryption() {
	return active;
}

/** @param {Awaited<ReturnType<typeof deriveListEncryption>> | null} encryption */
export function setActiveListEncryption(encryption) {
	active = encryption;
}

/**
 * OrbitDB's `encryption` option for the passkey's list.
 *
 * The key opens whatever this passkey sealed before, whether or not sealing
 * is on now: OrbitDB takes `encrypt` and `decrypt` separately, so with the
 * box unticked only `decrypt` is handed over — new entries go out in the
 * clear, the sealed ones stay readable. Without the decryptor OrbitDB keeps a
 * sealed entry but finds no operation in it, and the todo is gone from view
 * (db-actions.js counts those).
 *
 * @param {Uint8Array} prfOutput - from `readPrfOutput`, the same one the archive uses
 * @param {{ seal?: boolean }} [options] - seal new entries; on by default
 * @returns {Promise<{ data: { encrypt?: (bytes: Uint8Array) => Promise<Uint8Array>, decrypt: (value: any) => Promise<Uint8Array> } }>}
 */
export async function deriveListEncryption(prfOutput, { seal = true } = {}) {
	if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 32) {
		throw new TypeError('deriveListEncryption needs the PRF output: at least 32 bytes');
	}
	const rawKey = await deriveSubkey(prfOutput, LIST_KEY_INFO, { length: 32 });
	const { data } = await payloadEncryption(rawKey);
	return seal ? { data } : { data: { decrypt: data.decrypt } };
}

/**
 * How many entries of a log are sealed bytes this side cannot open — todos
 * that exist and do not show. Zero whenever the decryptor is in place.
 * @param {{ log: { values: () => Promise<any[]> } }} db
 */
export async function countSealedHidden(db) {
	const entries = await db.log.values();
	return entries.filter((e) => e?.payload instanceof Uint8Array).length;
}

/**
 * A value as this app writes it; a sealed entry read without the key is bytes,
 * and an entry from another app is whatever it is.
 * @param {unknown} value
 */
export function looksLikeTodo(value) {
	if (!value || typeof value !== 'object' || value instanceof Uint8Array) return false;
	const v = /** @type {Record<string, unknown>} */ (value);
	return typeof v.text === 'string' && typeof v.completed === 'boolean';
}
