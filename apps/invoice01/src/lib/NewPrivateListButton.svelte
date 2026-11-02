<script>
	// Create a new access-controlled private list (acl01). The public mnemonic
	// list stays available; this opens a fresh owner-only list and switches to
	// it, after which the permissions panel appears for granting DIDs.
	import { _, SLOT, around } from '$lib/i18n/index.js';
	import { createPrivateTodoList } from './db-actions.js';
	import { passkeyCredentialStore } from './p2p-stores.js';

	let name = '';
	// invoice01: a choice, and off unless ticked. A sealed list is readable only
	// to the passkeys of these lists (list-vault.js) — not to anybody granted
	// below or handed a todo, which is what this chapter is otherwise about.
	let sealed = false;
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ name: string, address: string, sealed: boolean } | null} */
	let created = null;
	let copied = false;

	async function create() {
		busy = true;
		errorMessage = null;
		created = null;
		try {
			// Keep the result. Dropping it is what made a created list invisible:
			// the box promises "share its address" and then never showed one (#114).
			created = await createPrivateTodoList(name, { sealed: sealed && canSeal });
			name = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	// A sealed list's key comes from a passkey; an anonymous identity has none.
	$: canSeal = Boolean($passkeyCredentialStore?.rawCredentialId);

	async function copyAddress() {
		if (!created?.address) return;
		await navigator.clipboard.writeText(created.address);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<section
	class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="new-private-list"
>
	<h2 class="text-lg font-semibold text-heading">{$_('lists.create.heading')}</h2>
	<p class="mt-1 text-xs text-faint">
		{$_('lists.create.hint')}
	</p>
	<div class="mt-3 flex gap-2">
		<input
			type="text"
			bind:value={name}
			placeholder={$_('lists.create.namePlaceholder')}
			data-testid="new-list-name"
			class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs"
		/>
		<button
			type="button"
			on:click={create}
			disabled={busy}
			data-testid="new-list-create"
			class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
		>
			{busy ? $_('lists.create.busy') : $_('lists.create.submit')}
		</button>
	</div>
	<label class="mt-2 flex cursor-pointer items-start gap-2 text-xs">
		<input
			type="checkbox"
			bind:checked={sealed}
			disabled={!canSeal || busy}
			data-testid="new-list-seal"
			class="mt-0.5"
		/>
		<span>
			<span class="font-medium text-heading">{$_('lists.create.seal')}</span>
			<span class="block text-faint" data-testid="new-list-seal-hint">
				{canSeal ? $_('lists.create.sealHint') : $_('lists.create.sealNeedsPasskey')}
			</span>
		</span>
	</label>
	{#if errorMessage}
		<p class="mt-2 text-xs text-red-600" data-testid="new-list-error">{errorMessage}</p>
	{/if}

	{#if created}
		<!-- The name sits in the sentence where each language puts it. -->
		{@const sentence = around($_('lists.create.created', { values: { name: SLOT } }))}
		<div
			class="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950"
			data-testid="new-list-created"
		>
			<p class="text-xs text-heading">
				{sentence.before}<strong data-testid="new-list-created-name">{created.name}</strong
				>{sentence.after}
			</p>
			{#if created.sealed}
				<p class="mt-1 text-xs text-faint" data-testid="new-list-created-sealed">
					{$_('lists.create.createdSealed')}
				</p>
			{/if}
			<p class="mt-2 text-xs text-faint">
				{$_('lists.create.share')}
			</p>
			<div class="mt-1 flex items-center gap-2">
				<code
					class="min-w-0 flex-1 font-mono text-xs break-all"
					data-testid="new-list-created-address">{created.address}</code
				>
				<button
					type="button"
					on:click={copyAddress}
					data-testid="new-list-copy-address"
					class="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
				>
					{copied ? $_('lists.create.copied') : $_('lists.create.copy')}
				</button>
			</div>
		</div>
	{/if}
</section>
