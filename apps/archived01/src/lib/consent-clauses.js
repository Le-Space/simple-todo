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
