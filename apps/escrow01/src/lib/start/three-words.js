/**
 * escrow01's start, the three words: this browser's own shared list, kept or
 * made, the words its last start joined, and whether the words in the address
 * came from a link or from a reload. Moved out of +page.svelte as they were;
 * the joined words came later.
 */
import { forget, recall, remember } from '@simple-todo/todo/browser-memory.js';
import {
	SPANISH_MNEMONIC_STORAGE_KEY,
	generateSpanishMnemonic,
	isValidSpanishMnemonic,
	normalizeSpanishMnemonic
} from '@simple-todo/todo/spanish-mnemonic.js';

/** This browser's own three words, if it keeps any. */
export function storedMnemonic() {
	try {
		const saved = recall(SPANISH_MNEMONIC_STORAGE_KEY);
		if (saved && isValidSpanishMnemonic(saved)) return normalizeSpanishMnemonic(saved);
	} catch {
		// Nothing kept, or no storage to keep it in.
	}
	return null;
}

/**
 * Whether this page load is a reload or a step back to it, rather than a
 * link followed. In memory mode the words in the address are then the only
 * trace of the list this tab was on.
 */
export function cameBackToThisAddress() {
	try {
		const [entry] = /** @type {PerformanceNavigationTiming[]} */ (
			performance.getEntriesByType('navigation')
		);
		return entry?.type === 'reload' || entry?.type === 'back_forward';
	} catch {
		return false;
	}
}

/*
	The words the last start joined, apart from this browser's own.

	Before the private start, the own words were the list on screen, so own
	words in the address meant "this list again". Now a start without "Join a
	shared list" ends in one's own private list, while its address still carries
	the own words until the first todo makes that list. And a start that joins
	keeps the joined words as its own. So own words in the address no longer
	tell a reload of a joined shared list from a reload of the list still to be
	made. This key does.
*/
const JOINED_LIST_KEY = 'simpleTodo.joinedList';

/** The words the last start joined, if it joined a shared list. */
export function joinedMnemonic() {
	try {
		const saved = recall(JOINED_LIST_KEY);
		if (saved && isValidSpanishMnemonic(saved)) return normalizeSpanishMnemonic(saved);
	} catch {
		// Nothing kept, or no storage to keep it in.
	}
	return null;
}

/** @param {string | null} words the words joined, or null for a start that joined none */
export function rememberJoined(words) {
	try {
		if (words) remember(JOINED_LIST_KEY, words);
		else forget(JOINED_LIST_KEY);
	} catch {
		// A reload then ends in one's own list, as it did before this was kept.
	}
}

export function loadOrGenerateMnemonic() {
	const saved = storedMnemonic();
	if (saved) return saved;
	const generated = generateSpanishMnemonic();
	try {
		remember(SPANISH_MNEMONIC_STORAGE_KEY, generated);
	} catch {
		// The generated value remains usable for this session.
	}
	return generated;
}
