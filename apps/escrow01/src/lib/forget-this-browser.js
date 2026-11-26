/**
 * "Forget me on this browser" (escrow01): the way out of "Keep in this browser".
 *
 * With that box ticked, this browser keeps what a return needs: the passkey's
 * credential, the provider's identity proof, the lists' logs and blocks, the
 * list registry, the record of the account on Sepolia, and whatever keys the
 * chapter keeps on the device at the time. Which keys that is changes (#127
 * moves the signing key into memory for a passkey with PRF), so nothing here
 * lists them: this takes everything this app put on its origin, as on a device
 * that has never been here. That is fine as "stay signed in" only if it can be
 * undone, and until this it could not, short of clearing site data in the
 * browser's settings.
 *
 * Everything means `localStorage` and `sessionStorage` in full, and the
 * IndexedDB databases under the prefixes `wipePersistentStorage()` owns
 * (`level-js-orbitdb/`, `level-js-simple-todo/`). The passkey stays on the
 * authenticator, the lists stay with the devices and relays that hold them,
 * and the account stays on Sepolia: the same passkey finds all of it again, as
 * on a new device.
 *
 * In two steps, because the running app holds those databases open.
 * `indexedDB.deleteDatabase` on an open database waits (`blocked`) until every
 * connection closes, and libp2p, Helia and OrbitDB do not let go while the page
 * lives. So the click empties both storages, leaves a note in
 * `sessionStorage` (it survives a reload of this tab and nothing else) and
 * loads the page anew; the new page deletes the databases in `+layout.js`,
 * before anything opens one, and before the start dialog decides whether this
 * is a return.
 *
 * `apps/main` calls the same wipe from its consent dialog, where it may not
 * hang: it resolves on `blocked` and counts only what went. That is right here
 * too. A blocked delete is not cancelled but queued, and IndexedDB serves every
 * later open of that name after it, so nothing kept can be read again; it only
 * finishes once whoever holds it lets go. Which is why other tabs of this app
 * are told to forget as well (`BroadcastChannel`): one left running would hold
 * the databases, and the next start here would wait on it.
 */
import { derived, writable } from 'svelte/store';
import {
	getPersistentStorageEnabled,
	wipePersistentStorage
} from '@simple-todo/todo/storage-mode.js';
import { forgetSession } from '@simple-todo/todo/browser-memory.js';
import { hasStoredPasskeyCredential } from './passkey-identity.js';
import { initializationStore } from './p2p-stores.js';

/** The note one page leaves the next, in this tab's `sessionStorage`. */
export const FORGETTING_KEY = 'simpleTodo.forgettingThisBrowser';
/** The other tabs of this app on this origin. */
export const FORGET_CHANNEL = 'simple-todo/escrow01/forget-this-browser';

/**
 * What the two steps reach for. The page's own by default (`thisPage()`); a
 * unit test hands in its own, so that it neither empties the storage other
 * test files share nor loads its runner anew.
 *
 * @typedef {{
 *   localStorage: Storage,
 *   sessionStorage: Storage,
 *   location: Pick<Location, 'pathname' | 'replace'>,
 *   wipe: () => Promise<{ deleted: string[] }>,
 *   BroadcastChannel?: typeof BroadcastChannel
 * }} ForgetEnvironment
 */

/** @returns {ForgetEnvironment} */
function thisPage() {
	return {
		// Getters: with site data blocked, the property access itself throws, and
		// it has to do so inside the `try` that expects it.
		get localStorage() {
			return window.localStorage;
		},
		get sessionStorage() {
			return window.sessionStorage;
		},
		location: window.location,
		wipe: wipePersistentStorage,
		BroadcastChannel: window.BroadcastChannel
	};
}

/**
 * The link that opened the confirmation, while it is open: focus goes back
 * there on Cancel. One dialog for both links, the footer's and the welcome
 * step's (ForgetThisBrowser.svelte).
 *
 * @type {import('svelte/store').Writable<HTMLElement | null>}
 */
export const forgetOpener = writable(null);

/**
 * Whether this browser keeps anything a person could ask it to forget.
 *
 * "Keep in this browser" is written only when somebody starts with it, and a
 * stored credential only in that mode; in memory mode a reload forgets
 * everything already, and an action that offered to would say something
 * untrue about this device.
 */
export function keepsSomethingHere() {
	return getPersistentStorageEnabled() || hasStoredPasskeyCredential();
}

/**
 * The same, for the footer. Asked again whenever the start moves on: the
 * choice is written when somebody starts with it (`start()` on the page), so a
 * page that opened on a fresh device learns it then, not on the next visit.
 */
export const keepsSomethingHereStore = derived(initializationStore, () => keepsSomethingHere());

/**
 * Empty both storages, leave the note, and load the start dialog anew.
 *
 * The new address drops the `#…`: the list it names is one this browser should
 * no longer remember either, and on a new device nobody would arrive with it.
 * The language rides along as `?lang=`, which is read and never stored
 * (`initialLocale()`), so a German reader is not answered in English for
 * having asked to be forgotten.
 *
 * @param {{ lang?: string | null, tellOtherTabs?: boolean }} [options]
 * @param {ForgetEnvironment} [env]
 */
export async function forgetThisBrowser(
	{ lang = null, tellOtherTabs = true } = {},
	env = thisPage()
) {
	if (tellOtherTabs) tellTheOtherTabs(env);

	clear(() => env.localStorage);
	clear(() => env.sessionStorage);
	forgetSession();

	// Without a `sessionStorage` to carry the note, the new page would not know
	// to delete anything. Then deleting starts here: what is not blocked goes at
	// once, and what is goes as soon as the unload lets go of it.
	if (!leaveNote(env)) await env.wipe();

	// A full load even when only the `#…` goes: a URL without a fragment is
	// never a fragment navigation, so the router does not get to keep the page.
	const { pathname } = env.location;
	env.location.replace(lang === 'de' || lang === 'en' ? `${pathname}?lang=${lang}` : pathname);
}

/**
 * The second step, on the page after the click: delete the databases.
 *
 * Called from `+layout.js`, whose `load` the start dialog waits for. Does
 * nothing without the note, so an ordinary start pays one `sessionStorage`
 * read.
 *
 * @param {ForgetEnvironment} [env]
 * @returns {Promise<string[] | null>} what was deleted, or null when there was
 *   nothing to finish
 */
export async function finishForgettingThisBrowser(env = thisPage()) {
	let pending = false;
	try {
		pending = env.sessionStorage.getItem(FORGETTING_KEY) === '1';
	} catch {
		// No sessionStorage, no note: the first step deleted what it could.
	}
	if (!pending) return null;

	// The wipe empties `localStorage` once more as well: the old page could
	// still write between the click and its unload.
	const { deleted } = await env.wipe();
	clear(() => env.sessionStorage);
	console.info('🧹 forgot this browser:', deleted);
	return deleted;
}

/**
 * The channel this page listens on, once `followForgettingInOtherTabs` ran.
 *
 * @type {BroadcastChannel | null}
 */
let listening = null;

/**
 * Forget here too when another tab of this app does.
 *
 * Without this, a second tab keeps libp2p, Helia and OrbitDB running on the
 * databases the first one is deleting: the delete waits for it, and so does
 * the next start in the first tab. Installed once per page, from `+layout.js`.
 * Each tab keeps the language it shows, which is why the caller hands in how
 * to read it rather than the message carrying the first tab's.
 *
 * @param {{ lang?: () => string | null }} [options]
 * @param {ForgetEnvironment} [env]
 * @returns {() => void} stops listening
 */
export function followForgettingInOtherTabs({ lang = () => null } = {}, env = thisPage()) {
	if (typeof env.BroadcastChannel !== 'function') return () => {};
	const channel = new env.BroadcastChannel(FORGET_CHANNEL);
	listening = channel;
	channel.onmessage = (event) => {
		if (event.data?.type !== 'forget') return;
		void forgetThisBrowser({ lang: lang(), tellOtherTabs: false }, env);
	};
	return () => {
		channel.close();
		if (listening === channel) listening = null;
	};
}

/** @param {ForgetEnvironment} env */
function tellTheOtherTabs(env) {
	try {
		// Through the channel this page listens on: a channel hears every other
		// channel of its name, this page's own included, but never itself. Sent
		// from a second one, the page would be told to forget by itself.
		if (listening) {
			listening.postMessage({ type: 'forget' });
			return;
		}
		if (typeof env.BroadcastChannel !== 'function') return;
		const channel = new env.BroadcastChannel(FORGET_CHANNEL);
		channel.postMessage({ type: 'forget' });
		channel.close();
	} catch {
		// No other tab can be told; this one still forgets.
	}
}

/** @param {ForgetEnvironment} env */
function leaveNote(env) {
	try {
		env.sessionStorage.setItem(FORGETTING_KEY, '1');
		return env.sessionStorage.getItem(FORGETTING_KEY) === '1';
	} catch {
		return false;
	}
}

/** @param {() => Storage} storage */
function clear(storage) {
	try {
		storage().clear();
	} catch {
		// Blocked storage holds nothing to clear.
	}
}
