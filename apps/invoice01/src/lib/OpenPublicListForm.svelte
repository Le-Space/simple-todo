<script>
	/*
		The public three-word list, as a deliberate choice in the lists tab.

		It used to be the first thing the app asked about, on the screen before
		anything else — and the invoices tab then explained that this was not the
		list to put invoices in. Two contradictory instructions in one session.

		So it lives here now, next to the other ways to open a list, and says what
		it is: words anybody who has them may write with. The picker itself is the
		same `SharedListSelector` the dialog used, so generating a fresh set,
		copying it and the wording for an invalid one all stay where they were.
	*/
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { isValidSpanishMnemonic } from '@simple-todo/todo/spanish-mnemonic.js';
	import SharedListSelector from '$lib/SharedListSelector.svelte';

	export let busy = false;

	let words = '';
	const dispatch = createEventDispatcher();

	$: valid = isValidSpanishMnemonic(words);

	function open() {
		if (!valid || busy) return;
		dispatch('open', { words });
	}
</script>

<section class="mb-6 rounded-lg border border-border bg-surface p-4" data-testid="public-list-form">
	<h2 class="text-sm font-semibold text-heading">{$_('lists.public.heading')}</h2>
	<p class="mt-1 mb-2 text-xs text-faint">{$_('lists.public.hint')}</p>
	<SharedListSelector bind:value={words} disabled={busy} />
	<button
		type="button"
		on:click={open}
		disabled={!valid || busy}
		data-testid="public-list-open"
		class="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white! disabled:opacity-50"
	>
		{busy ? $_('lists.public.busy') : $_('lists.public.submit')}
	</button>
</section>
