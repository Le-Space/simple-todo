import { normalizeListAddress, readListLink } from '@simple-todo/todo/list-link.js';
import {
	isValidSpanishMnemonic,
	normalizeSpanishMnemonic
} from '@simple-todo/todo/spanish-mnemonic.js';

/**
 * What somebody pasted into "Open a list" (#127 PR C): a list's address, its
 * three words, or neither.
 *
 * - a link: whatever its fragment names (`#db=` or `#list=`, list-link.js),
 *   with or without the `https://` a messenger may have dropped, or the
 *   fragment alone;
 * - an `/orbitdb/` address, or its bare manifest CID;
 * - three Spanish words, in any of the spellings the start dialog accepts.
 *
 * @param {string} input
 * @returns {{ address: string | null, words: string | null }}
 */
export function readListInput(input) {
	const text = String(input ?? '').trim();
	if (!text) return { address: null, words: null };
	if (text.includes('#')) {
		const href = text.startsWith('#')
			? `https://list.invalid/${text}`
			: /^[a-z][a-z0-9+.-]*:/i.test(text)
				? text
				: `https://${text}`;
		const link = readListLink(href);
		if (link.address || link.words) return { address: link.address, words: link.words };
	}
	const address = normalizeListAddress(text);
	if (address) return { address, words: null };
	if (isValidSpanishMnemonic(text)) return { address: null, words: normalizeSpanishMnemonic(text) };
	return { address: null, words: null };
}
