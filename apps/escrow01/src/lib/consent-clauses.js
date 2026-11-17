import { get } from 'svelte/store';
import { _ } from '$lib/i18n/index.js';
import { budgetInfo } from '$lib/budget-store.js';

/**
 * What this chapter does with your data, in plain words, as a function of the
 * choices on the consent screen. The dialog itself is shared
 * (`@simple-todo/ui/ConsentModal.svelte`); the statement is the chapter's,
 * because what a chapter does with data is the chapter's to state. Read at
 * call time, so a language switch repaints it.
 *
 * In groups, because two of them used to contradict each other in adjacent
 * bullets: "Nothing here is encrypted" beside "Budgets, encrypted". Both were
 * true of different things. The amounts are encrypted on the chain, the todos
 * and the lists are not, and each now stands under a heading that says which
 * is which.
 *
 * The technical view names the machinery (IPFS, Kubo, Sepolia, DID); the plain
 * one says the same thing without it. No sentence is weaker in either.
 *
 * @typedef {{ identity?: string, storage?: string, technical?: boolean }} ConsentState
 * @param {ConsentState} state
 * @returns {Array<{ title: string, lines: string[] }>}
 */
export const clauses = (state) => {
	const t = get(_);
	const technical = state.technical === true;
	const anonymous = state.identity === 'anonymous';
	const plainOr = (/** @type {string} */ key) => t(technical ? `${key}Technical` : key);

	return [
		{
			title: t(budgetInfo.confidential ? 'consent.group.amounts' : 'consent.group.amountsDemo'),
			lines: [
				...(budgetInfo.confidential
					? [plainOr('consent.clause.amountsChain'), t('consent.clause.amountsPublic')]
					: [t('consent.clause.amountsDemo')]),
				// The one thing a session without a passkey cannot do here, and the
				// thing this demo is for — said where the amounts are.
				...(anonymous ? [t('consent.clause.noBudgetWithoutPasskey')] : [])
			]
		},
		{
			title: t('consent.group.lists'),
			lines: [
				t('consent.clause.readingIsOpen'),
				t('consent.clause.sharedList'),
				t('consent.clause.privateList'),
				// This chapter's own sentence: a grant can be taken back, which is the
				// whole difference between delegating write access and handing
				// somebody a key.
				t('consent.clause.delegation')
			]
		},
		{
			title: t('consent.group.network'),
			lines: [
				t('consent.clause.noServer'),
				plainOr('consent.clause.gateway'),
				t('consent.clause.relay'),
				anonymous
					? state.storage === 'indexeddb'
						? t('consent.clause.identityAnonymousKept')
						: t('consent.clause.identityAnonymous')
					: t('consent.clause.identityPasskey'),
				...(anonymous
					? []
					: [
							plainOr(
								state.storage === 'indexeddb' ? 'consent.clause.keys' : 'consent.clause.keysMemory'
							)
						]),
				state.storage === 'indexeddb'
					? t('consent.clause.storagePersistent')
					: t('consent.clause.storageMemory'),
				t('consent.clause.cookies')
			]
		}
	];
};

/**
 * The same statement in four sentences, for the dialog's first screen: the
 * amounts, the lists, where things are kept, and that this is a demonstration.
 * The full statement stays one click away, unabridged.
 *
 * @param {ConsentState} state
 * @returns {string[]}
 */
export const summary = (state) => {
	const t = get(_);
	const technical = state.technical === true;
	return [
		budgetInfo.confidential
			? t(technical ? 'consent.summary.amountsChainTechnical' : 'consent.summary.amountsChain')
			: t('consent.summary.amountsDemo'),
		t('consent.summary.lists'),
		// "Nothing", with or without a passkey: in memory mode not even the link to
		// the passkey stays (memory-mode-passkey.spec.js takes the inventory).
		state.storage === 'indexeddb'
			? t('consent.summary.networkKept')
			: t('consent.summary.networkMemory'),
		t('consent.summary.demo')
	];
};
