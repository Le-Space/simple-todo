/**
 * escrow01's start, the three words: this browser's own shared list, kept or
 * made, and whether the words in the address came from a link or from a
 * reload. Moved out of +page.svelte as they were.
 */
import { recall, remember } from '@simple-todo/todo/browser-memory.js';
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
