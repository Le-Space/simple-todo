/**
 * Where this browser remembers small things: the shared list, the identity it
 * uses, the language, a dialog it has already shown.
 *
 * All of that used to go straight into `localStorage`, which made "in memory
 * only" untrue in a way the consent screen did not admit: the todos were gone
 * after a reload, but the mnemonic naming the list, the identity id, and in the
 * escrow chapter a read key in plain text all stayed behind on the device.
 *
 * So every one of those writes comes through here, and here decides:
 *
 * - **Kept in this browser** — `localStorage`, as before.
 * - **In memory only** — a `Map` that dies with the tab. Nothing reaches the
 *   device, and a reload starts over, which is what the label says.
 *
 * The storage choice itself cannot live here (it is what this reads), so it
 * stays in `storage-mode.js` — and it is written *only* when the answer is
 * "keep it": remembering that somebody asked for nothing to be kept would be
 * the one thing kept.
 */
import { getPersistentStorageEnabled } from './storage-mode.js';
import { forgetSession, session } from './session-store.js';

export { forgetSession };

/**
 * Whether this app offers the storage choice at all.
 *
 * A chapter without the choice never sets the flag, so asking
 * `getPersistentStorageEnabled()` there would answer *memory* for a reader who
 * was never asked -- and quietly stop remembering their language, their relay
 * opt-in and their list. So the facade keeps to the device until an app says it
 * honours the choice, which the chapters that render the selector do at start.
 */
let honoursChoice = false;

/** Called once by an app whose consent screen offers the storage choice. */
export function honourStorageChoice() {
	honoursChoice = true;
}

/** True only when a reader was offered the choice and asked to keep nothing. */
function keepsNothing() {
	return honoursChoice && !getPersistentStorageEnabled();
}

/**
 * @param {string} key
 * @param {string} value
 */
export function remember(key, value) {
	if (keepsNothing()) {
		session.set(key, value);
		return;
	}

	try {
		localStorage.setItem(key, value);
	} catch {
		// Private modes throw rather than refuse; the session still holds it.
		session.set(key, value);
	}
}

/**
 * @param {string} key
 * @returns {string | null}
 */
export function recall(key) {
	if (keepsNothing()) {
		return session.has(key) ? /** @type {string} */ (session.get(key)) : null;
	}

	let stored = null;
	try {
		stored = localStorage.getItem(key);
	} catch {
		// Falls through to the session below.
	}

	// The session is also where a value lands when the device refused to take
	// it -- a full quota, a browser that throws on write. Reading past a missing
	// entry keeps that session working instead of losing what it was handed.
	if (stored !== null) return stored;
	return session.has(key) ? /** @type {string} */ (session.get(key)) : null;
}

/** @param {string} key */
export function forget(key) {
	session.delete(key);
	try {
		localStorage.removeItem(key);
	} catch {
		// Nothing to do: it is already unreachable.
	}
}

/**
 * Whether a value written now would still be here after a reload.
 *
 * Two things have to be true: the reader asked for things to be kept, and the
 * device actually takes them. `remember()` answers the second with a fallback
 * -- it puts the value in the session so this page keeps working -- which is
 * right for a setting and wrong for a key that seals entries other peers hold.
 * Whoever needs durability has to ask for it rather than infer it from a write
 * that did not throw.
 *
 * @returns {boolean}
 */
export function canOutlivePage() {
	if (keepsNothing()) return false;

	const probe = 'simpleTodo.durabilityProbe';
	try {
		localStorage.setItem(probe, '1');
		const kept = localStorage.getItem(probe) === '1';
		localStorage.removeItem(probe);
		return kept;
	} catch {
		return false;
	}
}

/**
 * Drop every stored key that starts with `prefix`.
 *
 * For what another package wrote before we could route it. The passkey identity
 * provider keeps its proofs in a Map *and* in `localStorage`
 * (`identity-proof-store.js`), with no way to hand it a different store, so in
 * memory mode the device keeps a proof the reader asked us not to keep. It
 * reads the Map when the device has nothing, so removing the copy costs this
 * session nothing -- only a later visitor finds less.
 *
 * The real fix is a storage the provider accepts; until then this sweeps.
 *
 * @param {string} prefix
 * @returns {number} how many were removed
 */
export function forgetByPrefix(prefix) {
	let removed = 0;
	try {
		for (const key of Object.keys(localStorage)) {
			if (!key.startsWith(prefix)) continue;
			localStorage.removeItem(key);
			removed += 1;
		}
	} catch {
		// Nothing reachable, nothing to remove.
	}
	for (const key of [...session.keys()]) {
		if (key.startsWith(prefix)) session.delete(key);
	}
	return removed;
}
