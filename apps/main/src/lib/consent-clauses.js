import { get } from 'svelte/store';
import { _ } from '$lib/i18n/index.js';

/**
 * What this chapter does with your data, in plain words, as a function of the
 * choices on the consent screen. The dialog itself is shared
 * (`@simple-todo/ui/ConsentModal.svelte`); the statement is the chapter's,
 * because what a chapter does with data is the chapter's to state. Read at
 * call time, so a language switch repaints it.
 *
 * Cookies last: it is the only line about this dialog rather than about the
 * app, and the order is why it reads as a footnote.
 *
 * @param {{ relay?: boolean, persistent?: boolean }} state
 * @returns {string[]}
 */
export const clauses = (state) => {
	const t = get(_);
	return [
		t('consent.clause.noServer'),
		t('consent.clause.gateway'),
		state.relay ? t('consent.clause.relayOn') : t('consent.clause.relayOff'),
		state.persistent ? t('consent.clause.persistent') : t('consent.clause.memory'),
		t('consent.clause.cookies')
	].filter(Boolean);
};
