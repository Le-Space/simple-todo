import { get } from 'svelte/store';
import { _ } from '$lib/i18n/index.js';

/**
 * What this chapter does with your data, in plain words, as a function of the
 * choices on the consent screen. The dialog itself is shared
 * (`@simple-todo/ui/ConsentModal.svelte`); the statement is the chapter's,
 * because what a chapter does with data is the chapter's to state. Read at
 * call time, so a language switch repaints it.
 *
 * @param {{ identity?: string, storage?: string }} state
 * @returns {string[]}
 */
export const clauses = (state) => {
	const t = get(_);
	return [
		t('consent.clause.noServer'),
		t('consent.clause.gateway'),
		t('consent.clause.relay'),
		t('consent.clause.sharedList'),
		t('consent.clause.privateList'),
		t('consent.clause.readingIsOpen'),
		// This chapter's own sentence: a grant can be taken back, which is the
		// whole difference between delegating write access and handing somebody a key.
		t('consent.clause.delegation'),
		state.identity === 'anonymous'
			? state.storage === 'indexeddb'
				? t('consent.clause.identityAnonymousKept')
				: t('consent.clause.identityAnonymous')
			: t('consent.clause.identityPasskey'),
		state.storage === 'indexeddb'
			? t('consent.clause.storagePersistent')
			: t('consent.clause.storageMemory'),
		t('consent.clause.cookies')
	].filter(Boolean);
};
