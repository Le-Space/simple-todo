import { readable } from 'svelte/store';

/**
 * The parts of the page (invoice01), and which one is on screen.
 *
 * The page used to show everything at once, so on a phone the todos began
 * three screens down, under the network panel and four cards about lists, and
 * the invoices below all of that. Now each part has a tab, and a phone shows
 * one at a time.
 *
 * Sections, not routes: this page owns the consent dialog and the P2P start,
 * and a navigation to another route would unmount it and start both over.
 * Every section stays mounted and is only hidden, so a half-filled form or an
 * open connection survives a switch.
 *
 * The section is the URL's fragment — its first part, ahead of the open list —
 * which is what makes reload, the back button and a link to one section work
 * without code of their own. The names are German, as in `escrow01`, where this
 * came from.
 */

/** @typedef {'aufgaben' | 'rechnungen' | 'listen' | 'netzwerk'} Section */

/** The sections with a tab, in the order the tab bar shows them. */
export const TAB_SECTIONS = /** @type {const} */ (['aufgaben', 'rechnungen', 'listen', 'netzwerk']);

/** Where the page opens without a fragment, or with one it does not know. */
export const DEFAULT_SECTION = 'aufgaben';

/**
 * @param {string | null | undefined} hash `location.hash`, with or without the `#`
 * @returns {Section}
 */
export function sectionFromHash(hash) {
	// The section is the fragment's first part; the open list follows it
	// (`#listen&list=agua-casa-flor`, see `@simple-todo/todo/list-link.js`).
	const id = String(hash ?? '')
		.replace(/^#/, '')
		.split('&')[0];
	return /** @type {readonly string[]} */ (TAB_SECTIONS).includes(id)
		? /** @type {Section} */ (id)
		: DEFAULT_SECTION;
}

/**
 * @param {Pick<Window, 'addEventListener' | 'removeEventListener'> & { location: { hash: string } } | null} [target]
 *   the window; a test hands in its own
 */
export function createSectionStore(target = typeof window === 'undefined' ? null : window) {
	return readable(
		/** @type {Section} */ (target ? sectionFromHash(target.location.hash) : DEFAULT_SECTION),
		(set) => {
			if (!target) return;
			const update = () => set(sectionFromHash(target.location.hash));
			update();
			// Fired for a click on a tab, for the back and forward buttons, and for a
			// fragment typed into the address bar alike.
			target.addEventListener('hashchange', update);
			return () => target.removeEventListener('hashchange', update);
		}
	);
}

export const currentSection = createSectionStore();
