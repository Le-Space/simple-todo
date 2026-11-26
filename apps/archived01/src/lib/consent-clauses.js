import { get } from 'svelte/store';
import { _ } from '$lib/i18n/index.js';

/**
 * What this chapter does with your data, in plain words, as a function of the
 * choices on the consent screen. The dialog itself is shared
 * (`@simple-todo/ui/ConsentModal.svelte`); the statement is the chapter's,
 * because what a chapter does with data is the chapter's to state. Read at
 * call time, so a language switch repaints it.
 *
 * @param {{ identity?: string, p2p?: boolean, persistent?: boolean, seal?: boolean, archive?: boolean, owner?: boolean }} state
 * @returns {string[]}
 */
export const clauses = (state) => {
	const passkey = state.identity !== 'anonymous';
	const t = get(_);
	return [
		t('consent.clause.gateway'),
		state.p2p ? t('consent.clause.relayOn') : t('consent.clause.networkOff'),
		passkey ? t('consent.clause.listPasskey') : t('consent.clause.listOpen'),
		!passkey
			? t('consent.clause.sealingNeedsPasskey')
			: state.seal
				? t('consent.clause.sealed')
				: t('consent.clause.notSealed'),
		passkey
			? t('consent.clause.identityPasskey')
			: state.persistent
				? t('consent.clause.identityAnonymousKept')
				: t('consent.clause.identityAnonymous'),
		state.persistent ? t('consent.clause.storageKept') : t('consent.clause.storageMemory'),
		state.archive
			? state.owner
				? t('consent.clause.archiveOnOwner')
				: t('consent.clause.archiveOn')
			: t('consent.clause.archiveOff'),
		t('consent.clause.noTracking')
	].filter(Boolean);
};

/**
 * The start dialog's short form: three sentences under the promise, the gist
 * of `clauses` for somebody outside the tutorial. The full statement stays on
 * the dialog's second screen, unabridged; what is accepted is still all of it.
 *
 * What a person has to know before the first entry: whether the list is
 * sealed (and that it cannot be without a passkey), whether anything leaves
 * this device for the archive, and what a reload keeps.
 *
 * @param {{ identity?: string, persistent?: boolean, seal?: boolean, archive?: boolean }} state
 * @returns {string[]}
 */
export const summary = (state) => {
	const passkey = state.identity !== 'anonymous';
	const t = get(_);
	return [
		!passkey
			? t('consent.summary.noPasskey')
			: state.seal
				? t('consent.summary.sealed')
				: t('consent.summary.notSealed'),
		state.archive ? t('consent.summary.archiveOn') : t('consent.summary.archiveOff'),
		state.persistent ? t('consent.summary.kept') : t('consent.summary.memory')
	];
};
