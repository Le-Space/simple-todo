<script>
	/**
	 * escrow01: this browser's three-word list, while another list is on screen.
	 *
	 * The start opens the shared list behind the browser's own three words and
	 * keeps it open, but without a link it ends in a list of one's own (#140). So
	 * the words are named here, without a Copy button, with the switch that puts
	 * their list on screen. Only there are they copied, and only there do the
	 * address bar and the page QR carry them: whoever hands them on is then in
	 * the list they hand on.
	 */
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';

	export let mnemonic = '';
	/** The switch is under way. */
	export let busy = false;

	const dispatch = createEventDispatcher();
</script>

<section
	class="mb-6 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
	data-testid="share-by-three-words"
>
	<h2 class="text-xs font-medium text-heading">{$_('lists.threeWords.heading')}</h2>
	<p class="mt-1 text-xs text-faint">{$_('lists.threeWords.hint')}</p>
	<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
		<code class="min-w-0 font-mono text-xs break-all text-text" data-testid="three-word-list-name"
			>{mnemonic}</code
		>
		<button
			type="button"
			on:click={() => dispatch('open')}
			disabled={busy}
			class="rounded border border-cyan-200 bg-surface px-2 py-1 text-xs font-medium text-cyan-800 disabled:opacity-60 dark:border-cyan/30 dark:text-cyan"
			data-testid="three-word-list-open"
		>
			{$_('lists.threeWords.open')}
		</button>
	</div>
	<button
		type="button"
		on:click={() => dispatch('change')}
		class="mt-3 text-xs font-medium text-cyan-700 underline"
	>
		{$_('lists.active.openAnother')}
	</button>
</section>
