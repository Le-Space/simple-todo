<script>
	/**
	 * The open list, at the top of the lists tab: which one it is, and what to
	 * pass on so that somebody else opens the same one.
	 *
	 * escrow01: only what belongs to the open list can be copied here. The
	 * browser's three-word list stays open underneath one's own list, and this
	 * card used to offer its words whatever list was on screen -- so somebody
	 * who handed them on sent the other person into a list their own todos
	 * never reached. The words are copied here only while that shared list is
	 * the open one; otherwise `ShareByThreeWords` names them, with the switch
	 * to it.
	 */
	import { createEventDispatcher } from 'svelte';
	import { _, SLOT, around } from '$lib/i18n/index.js';

	export let mnemonic = '';
	export let databaseAddress = '';
	export let embedded = false;
	/** escrow01: in the lists tab the open list is what the tab is about, so it starts open. */
	export let open = false;
	/**
	 * Which list is actually open. The summary used to be hard-wired to
	 * "Shared list" and the shared mnemonic, so after creating a private list the
	 * header kept advertising a list the user was no longer writing to (#114).
	 * @type {{ kind: 'shared' | 'private' | 'guest', name: string }}
	 */
	export let activeList = { kind: 'shared', name: '' };
	/**
	 * escrow01: the name of the list of one's own that the first todo will make,
	 * while there is none yet (`homeListPendingStore`). It has nothing to pass
	 * on until then: no address, no link, no QR code.
	 * @type {string | null}
	 */
	export let pendingName = null;

	const KINDS = ['shared', 'private', 'guest'];
	$: kind = pendingName ? 'pending' : KINDS.includes(activeList?.kind) ? activeList.kind : 'shared';
	$: heading = $_(`lists.active.${kind === 'pending' ? 'private' : kind}`);
	$: subtitle = kind === 'pending' ? pendingName : kind === 'shared' ? mnemonic : activeList?.name;
	$: writingTo = around($_('lists.active.writingTo', { values: { name: SLOT } }));
	/** What the Copy button copies: the open list's words, or its address. */
	$: shareable = kind === 'shared' ? mnemonic : kind === 'pending' ? '' : databaseAddress;

	let copied = false;
	const dispatch = createEventDispatcher();

	async function copy() {
		if (!shareable) return;
		await navigator.clipboard.writeText(shareable);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<details
	{open}
	class="group"
	class:mb-6={!embedded}
	class:rounded-lg={!embedded}
	class:border={!embedded}
	class:border-border={true}
	class:bg-surface={!embedded}
	class:px-4={!embedded}
	class:py-3={!embedded}
	class:shadow-sm={!embedded}
	class:border-t={embedded}
	class:pt-2={embedded}
	data-testid="shared-list-details"
	data-kind={kind}
>
	<summary
		class="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-xs font-medium text-text outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500 [&::-webkit-details-marker]:hidden"
	>
		<svg
			class="h-3.5 w-3.5 transition-transform group-open:rotate-90"
			viewBox="0 0 20 20"
			fill="currentColor"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M7.2 4.7a1 1 0 011.4 0l4.6 4.6a1 1 0 010 1.4l-4.6 4.6a1 1 0 11-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 010-1.4z"
				clip-rule="evenodd"
			/>
		</svg>
		<span data-testid="active-list-kind">{heading}</span>
		{#if subtitle}
			<code
				class="hidden min-w-0 truncate font-mono font-normal text-faint sm:inline"
				data-testid="active-list-label">· {subtitle}</code
			>
		{/if}
	</summary>
	<div class="mt-3 border-t border-border pt-3">
		{#if kind === 'pending'}
			<p class="text-xs text-text" data-testid="active-list-pending-note">
				{$_('lists.home.pendingNote')}
			</p>
		{:else if kind === 'shared'}
			<p class="text-xs text-faint">{$_('lists.active.mnemonicLabel')}</p>
			<div class="mt-1 flex items-center gap-2 rounded-md bg-cyan-50 p-2 dark:bg-cyan/10">
				<code
					class="min-w-0 flex-1 font-mono text-xs break-all"
					data-testid="active-shared-list-name">{mnemonic}</code
				>
				<button
					type="button"
					on:click={copy}
					class="rounded border border-cyan-200 bg-surface px-2 py-1 text-xs dark:border-cyan/30"
				>
					{copied ? $_('lists.active.copied') : $_('lists.active.copy')}
				</button>
			</div>
			{#if databaseAddress}
				<p class="mt-2 text-xs text-faint">{$_('lists.active.addressLabel')}</p>
				<code
					class="mt-1 block font-mono text-[11px] break-all text-text"
					data-testid="active-database-address">{databaseAddress}</code
				>
			{/if}
			<p class="mt-2 text-xs text-data-700">
				{$_('lists.active.anyone')}
			</p>
			<p class="mt-1 text-xs text-faint">
				{$_('lists.active.replication')}
			</p>
			<button
				type="button"
				on:click={() => dispatch('change')}
				class="mt-3 text-xs font-medium text-cyan-700 underline"
			>
				{$_('lists.active.openAnother')}
			</button>
		{:else}
			<p class="mb-2 text-xs text-data-700" data-testid="active-list-note">
				{writingTo.before}<strong>{activeList.name}</strong>{writingTo.after}
			</p>
			{#if databaseAddress}
				<p class="text-xs text-faint">{$_('lists.active.addressLabel')}</p>
				<div class="mt-1 flex items-center gap-2 rounded-md bg-cyan-50 p-2 dark:bg-cyan/10">
					<code
						class="min-w-0 flex-1 font-mono text-[11px] break-all text-text"
						data-testid="active-database-address">{databaseAddress}</code
					>
					<button
						type="button"
						on:click={copy}
						class="rounded border border-cyan-200 bg-surface px-2 py-1 text-xs dark:border-cyan/30"
					>
						{copied ? $_('lists.active.copied') : $_('lists.active.copy')}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</details>
