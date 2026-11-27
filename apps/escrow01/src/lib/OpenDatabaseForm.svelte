<script>
	/**
	 * "Open a list" (acl01; escrow01 #127 PR C): one field for whatever somebody
	 * passed on -- three words, a link, or an `/orbitdb/` address -- instead of
	 * three ways in three places ("Open this list", "Open another shared list",
	 * "Open a shared list by address").
	 *
	 * An address, or a link that carries one, opens here. Words, typed or from a
	 * link, go to the page: a three-word list is the start's own list, so other
	 * words go through the start dialog, as words from a link always did, and
	 * the reader sees which list it is before joining it.
	 */
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { loadTodoDatabase } from './db-actions.js';
	import { readListInput } from './list-input.js';

	let value = '';
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;

	const dispatch = createEventDispatcher();

	async function open() {
		const { address, words } = readListInput(value);
		errorMessage = null;
		if (!address && !words) {
			errorMessage = $_('lists.open.unknown');
			return;
		}
		if (!address) {
			dispatch('openWords', words);
			value = '';
			return;
		}
		busy = true;
		try {
			await loadTodoDatabase(address);
			value = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}
</script>

<form class="min-w-0" data-testid="open-database-form" on:submit|preventDefault={open}>
	<h3 class="text-sm font-semibold text-heading">{$_('lists.open.heading')}</h3>
	<p class="mt-1 text-xs text-faint">{$_('lists.open.hint')}</p>
	<div class="mt-2 flex gap-2">
		<input
			type="text"
			bind:value
			placeholder={$_('lists.open.placeholder')}
			aria-label={$_('lists.open.heading')}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			data-testid="open-db-address-input"
			class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs"
		/>
		<button
			type="submit"
			disabled={busy || !value.trim()}
			data-testid="open-db-button"
			class="shrink-0 rounded-md border border-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-800 hover:bg-cyan-50 disabled:border-border disabled:text-faint dark:border-cyan dark:text-cyan dark:hover:bg-cyan/10"
		>
			{busy ? $_('lists.open.busy') : $_('lists.open.submit')}
		</button>
	</div>
	{#if errorMessage}
		<p class="mt-2 text-xs text-red-600" data-testid="open-db-error">{errorMessage}</p>
	{/if}
</form>
