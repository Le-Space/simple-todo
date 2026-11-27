import { get } from 'svelte/store';
import { _ } from '$lib/i18n/index.js';
import { budgetInfo } from '$lib/budget/budget-store.js';

/**
 * What this chapter does with your data, in plain words, as a function of the
 * choices in the start dialog. The dialog itself is shared
 * (`@simple-todo/ui/ConsentModal.svelte`); the statement is the chapter's,
 * because what a chapter does with data is the chapter's to state. Read at
 * call time, so a language switch repaints it.
 *
 * In groups, because two of them used to contradict each other in adjacent
 * bullets: "Nothing here is encrypted" beside "Budgets, encrypted". Both were
 * true of different things, and each now stands under a heading that says
 * which is which. Since #127 there are three: the amounts, encrypted on the
 * chain; one's own lists, sealed in the browser (sealed/); and the list behind
 * three words, which stays open to anyone who has its words.
 *
 * What a sealed list does not hide is said beside it: who wrote when, how many
 * entries, who may write. A removed reader keeps what they could read until
 * then, and the sentence says so rather than promise more.
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
	const kept = state.storage === 'indexeddb';
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
			title: t('consent.group.listsEncrypted'),
			lines: [
				plainOr('consent.clause.ownListsSealed'),
				t('consent.clause.whoReads'),
				plainOr('consent.clause.listsMetadata'),
				// Without a passkey there is nothing to derive the key from: a key of
				// this browser seals the lists, and it goes where the browser goes.
				...(anonymous
					? [t(kept ? 'consent.clause.ownListsDeviceKeyKept' : 'consent.clause.ownListsDeviceKey')]
					: [])
			]
		},
		{
			title: t('consent.group.sharedList'),
			lines: [t('consent.clause.sharedList'), t('consent.clause.sharedListOpen')]
		},
		{
			title: t('consent.group.network'),
			lines: [
				t('consent.clause.noServer'),
				plainOr('consent.clause.gateway'),
				t('consent.clause.relay'),
				anonymous
					? kept
						? t('consent.clause.identityAnonymousKept')
						: t('consent.clause.identityAnonymous')
					: t('consent.clause.identityPasskey'),
				...(anonymous ? [] : [plainOr(kept ? 'consent.clause.keys' : 'consent.clause.keysMemory')]),
				kept ? t('consent.clause.storagePersistent') : t('consent.clause.storageMemory'),
				// What a browser extension sees: everything the page shows and keeps.
				plainOr('consent.clause.extensions'),
				// The decision to start is kept with everything else, or with nothing.
				kept ? t('consent.clause.cookiesKept') : t('consent.clause.cookiesMemory')
			]
		}
	];
};

/**
 * The statement in three sentences, for the dialog's first screen: what is
 * encrypted, the one list that is not, and the browser it runs in. The full statement is on the
 * dialog's second screen, unabridged; that relays may hold a copy of a list
 * stands there, where it has its context.
 *
 * In this order because the page hands each line an icon by its position
 * (`summaryIcons` in `+page.svelte`): a lock, an eye, a shield.
 *
 * @param {ConsentState} state
 * @returns {string[]}
 */
export const summary = (state) => {
	const t = get(_);
	const technical = state.technical === true;
	const amounts = budgetInfo.confidential
		? technical
			? 'consent.summary.amountsAndListsTechnical'
			: 'consent.summary.amountsAndLists'
		: 'consent.summary.amountsDemo';
	return [
		t(amounts),
		t('consent.summary.listsEncrypted'),
		t(technical ? 'consent.summary.extensionsTechnical' : 'consent.summary.extensions')
	];
};
