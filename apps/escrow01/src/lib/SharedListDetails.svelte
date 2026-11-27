<script>
	/**
	 * "This list", the first of the lists tab's three parts (#127 PR C): the
	 * open list's name, whether it is sealed, what this session is in it, what
	 * to pass on so that somebody else opens it, and -- in the slot -- who can
	 * write to it.
	 *
	 * Only what belongs to the open list can be copied here. The browser's
	 * three-word list stays open underneath one's own list, and this card used
	 * to offer its words whatever list was on screen -- so somebody who handed
	 * them on sent the other person into a list their own todos never reached.
	 * The words are copied here only while that list is the open one; otherwise
	 * "Your lists" names them, with the switch to it.
	 *
	 * The note on where new todos go is information, so it is in the text's
	 * colour: in amber it read as a warning.
	 */
	import { _, SLOT, around } from '$lib/i18n/index.js';
	import { qrSvg } from '@simple-todo/ui/qr-svg.js';
	import { withoutFragmentKeys } from '@simple-todo/todo/list-link.js';
	import { sealedListStore } from './db-actions.js';
	import { listRoleStore } from './list-access.js';
	import { TAB_SECTIONS } from './sections.js';

	export let mnemonic = '';
	export let databaseAddress = '';
	/**
	 * Which list is actually open (#114).
	 * @type {{ kind: 'shared' | 'private' | 'guest', name: string }}
	 */
	export let activeList = { kind: 'shared', name: '' };
	/**
	 * The name of the list of one's own that the first todo will make, while
	 * there is none yet (`homeListPendingStore`). It has nothing to pass on
	 * until then: no address, no link, no QR code.
	 * @type {string | null}
	 */
	export let pendingName = null;

	const KINDS = ['shared', 'private', 'guest'];
	$: kind = pendingName ? 'pending' : KINDS.includes(activeList?.kind) ? activeList.kind : 'shared';
	$: heading = $_(`lists.active.${kind === 'pending' ? 'private' : kind}`);
	$: name =
		kind === 'pending'
			? pendingName
			: kind === 'shared'
				? mnemonic
				: activeList?.name || $_('lists.switcher.unnamed');
	$: newTodos = around($_('lists.thisList.newTodos', { values: { name: SLOT } }));
	/** What the Copy button copies: the open list's words, or its address. */
	$: shareable = kind === 'shared' ? mnemonic : kind === 'pending' ? '' : databaseAddress;
	/** Sealed or open: said for a list that exists; a list still to be made has neither yet. */
	$: sealing =
		kind === 'pending'
			? null
			: kind === 'shared'
				? 'open'
				: $sealedListStore.sealed
					? 'sealed'
					: 'open';
	$: role = kind === 'private' || kind === 'guest' ? $listRoleStore : null;

	/** @type {'' | 'value' | 'link'} */
	let copied = '';
	let qrOpen = false;
	let qrMarkup = '';

	/** The page as it is, the open list in its fragment; not the tab, not an invite. */
	const listLink = () => withoutFragmentKeys(location.href, ['invite', ...TAB_SECTIONS]);

	/** @param {'value' | 'link'} what */
	async function copy(what) {
		const text = what === 'link' ? listLink() : shareable;
		if (!text) return;
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => (copied = ''), 2000);
	}

	function toggleQr() {
		qrOpen = !qrOpen;
		if (qrOpen) qrMarkup = qrSvg(listLink());
	}

	// Another list on screen: its code is not this one's.
	$: if (shareable !== undefined) qrOpen = false;
</script>

<section
	class="mb-6 rounded-lg border border-border bg-surface px-4 py-4 shadow-sm"
	aria-labelledby="this-list-heading"
	data-testid="shared-list-details"
	data-kind={kind}
>
	<h2 id="this-list-heading" class="text-xs font-semibold tracking-wide text-faint uppercase">
		{$_('lists.thisList.heading')}
	</h2>
	<p class="mt-1 truncate text-xl font-bold text-heading" data-testid="active-list-label">{name}</p>
	<p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
		<span data-testid="active-list-kind">{heading}</span>
		{#if sealing}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-text"
				title={$_(`lists.thisList.${sealing}Title`)}
				data-testid="active-list-sealing"
				data-sealing={sealing}
			>
				{#if sealing === 'sealed'}
					<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
							clip-rule="evenodd"
						/>
					</svg>
				{/if}
				{$_(`lists.thisList.${sealing}`)}
			</span>
		{/if}
		{#if role}
			<span
				class="rounded-full border border-border px-2 py-0.5 text-text"
				data-testid="active-list-role"
				data-role={role}>{$_(`lists.thisList.role.${role}`)}</span
			>
		{/if}
	</p>

	{#if kind === 'pending'}
		<p class="mt-3 text-sm text-text" data-testid="active-list-pending-note">
			{$_('lists.home.pendingNote')}
		</p>
	{:else}
		{#if kind === 'shared'}
			<p class="mt-3 text-sm text-text">{$_('lists.active.anyone')}</p>
		{:else}
			<p class="mt-3 text-sm text-text" data-testid="active-list-note">
				{newTodos.before}<strong>{name}</strong>{newTodos.after}
			</p>
		{/if}

		<div class="mt-3 flex items-center gap-2 rounded-md bg-surface-2 py-1 pr-1 pl-2">
			{#if kind === 'shared'}
				<code
					class="min-w-0 flex-1 truncate font-mono text-xs text-text"
					data-testid="active-shared-list-name">{mnemonic}</code
				>
			{:else if databaseAddress}
				<code
					class="min-w-0 flex-1 truncate font-mono text-xs text-text"
					title={databaseAddress}
					data-testid="active-database-address">{databaseAddress}</code
				>
			{/if}
			<button
				type="button"
				on:click={() => copy('value')}
				class="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:text-heading"
			>
				{copied === 'value' ? $_('lists.active.copied') : $_('lists.active.copy')}
			</button>
		</div>
		{#if kind === 'shared' && databaseAddress}
			<!-- The words are what to pass on; the address is there for whoever asks. -->
			<code
				class="mt-1 block truncate px-2 font-mono text-[11px] text-faint"
				title={databaseAddress}
				data-testid="active-database-address">{databaseAddress}</code
			>
		{/if}

		<div class="mt-2 flex flex-wrap gap-2">
			<button
				type="button"
				on:click={() => copy('link')}
				class="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:text-heading"
				data-testid="active-list-copy-link"
			>
				{copied === 'link' ? $_('lists.thisList.linkCopied') : $_('lists.thisList.copyLink')}
			</button>
			<button
				type="button"
				on:click={toggleQr}
				aria-expanded={qrOpen}
				class="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:text-heading"
				data-testid="active-list-show-qr"
			>
				{qrOpen ? $_('lists.thisList.hideQr') : $_('lists.thisList.showQr')}
			</button>
		</div>
		{#if qrOpen}
			<div class="mt-3 max-w-56" data-testid="active-list-qr">
				<div
					class="rounded-lg bg-white p-2 leading-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's own SVG of our own URL -->
					{@html qrMarkup}
				</div>
				<p class="mt-1.5 text-xs text-faint">{$_('lists.thisList.qrHint')}</p>
			</div>
		{/if}
	{/if}

	<slot />
</section>
