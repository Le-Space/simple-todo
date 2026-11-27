<script>
	// Create a new access-controlled private list (acl01). The public mnemonic
	// list stays available; this opens a fresh owner-only list and switches to
	// it, after which "This list" offers the field for letting someone in.
	// escrow01 (#127): the list is sealed from its first entry. Its button is
	// the lists tab's one primary action (#127 PR C).
	import { _, SLOT, around } from '$lib/i18n/index.js';
	import { createPrivateTodoList } from './db-actions.js';

	let name = '';
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ name: string, address: string } | null} */
	let created = null;
	let copied = false;

	async function create() {
		busy = true;
		errorMessage = null;
		created = null;
		try {
			// Keep the result. Dropping it is what made a created list invisible:
			// the box promises "share its address" and then never showed one (#114).
			created = await createPrivateTodoList(name);
			name = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function copyAddress() {
		if (!created?.address) return;
		await navigator.clipboard.writeText(created.address);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<form class="min-w-0" data-testid="new-private-list" on:submit|preventDefault={create}>
	<h3 class="text-sm font-semibold text-heading">{$_('lists.create.heading')}</h3>
	<p class="mt-1 text-xs text-faint">
		{$_('lists.create.hint')}
	</p>
	<div class="mt-2 flex gap-2">
		<input
			type="text"
			bind:value={name}
			placeholder={$_('lists.create.namePlaceholder')}
			aria-label={$_('lists.create.namePlaceholder')}
			data-testid="new-list-name"
			class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
		/>
		<button
			type="submit"
			disabled={busy}
			data-testid="new-list-create"
			class="shrink-0 rounded-md bg-coral-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-coral-600 disabled:bg-faint"
		>
			{busy ? $_('lists.create.busy') : $_('lists.create.submit')}
		</button>
	</div>
	{#if errorMessage}
		<p class="mt-2 text-xs text-red-600" data-testid="new-list-error">{errorMessage}</p>
	{/if}

	{#if created}
		<!-- The name sits in the sentence where each language puts it. -->
		{@const sentence = around($_('lists.create.created', { values: { name: SLOT } }))}
		<div class="mt-3 rounded-md bg-surface-2 p-2" data-testid="new-list-created">
			<p class="text-xs text-heading">
				{sentence.before}<strong data-testid="new-list-created-name">{created.name}</strong
				>{sentence.after}
			</p>
			<p class="mt-2 text-xs text-faint">
				{$_('lists.create.share')}
			</p>
			<div class="mt-1 flex items-center gap-2">
				<code
					class="min-w-0 flex-1 truncate font-mono text-xs text-text"
					title={created.address}
					data-testid="new-list-created-address">{created.address}</code
				>
				<button
					type="button"
					on:click={copyAddress}
					data-testid="new-list-copy-address"
					class="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:text-heading"
				>
					{copied ? $_('lists.create.copied') : $_('lists.create.copy')}
				</button>
			</div>
		</div>
	{/if}
</form>
