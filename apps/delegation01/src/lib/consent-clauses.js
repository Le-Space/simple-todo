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

/**
 * The start dialog's short form: three sentences under the promise, the gist
 * of `clauses` for somebody outside the tutorial. The full statement stays on
 * the dialog's second screen, unabridged; what is accepted is still all of it.
 *
 * What a person has to know before handing a todo over: that nothing is
 * encrypted, that a todo goes to a passkey identity, and where the todos are
 * kept.
 *
 * @param {{ identity?: string, storage?: string, technical?: boolean }} state
 * @returns {string[]}
 */
export const summary = (state) => {
	const t = get(_);
	const kept = state.storage === 'indexeddb';
	return [
		t(state.technical ? 'consent.summary.listsTechnical' : 'consent.summary.lists'),
		t('consent.summary.delegate'),
		t(
			kept
				? state.technical
					? 'consent.summary.keptTechnical'
					: 'consent.summary.kept'
				: 'consent.summary.memory'
		)
	];
};
