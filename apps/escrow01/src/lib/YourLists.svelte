<script>
	/**
	 * "Your lists", the second of the lists tab's three parts (#127 PR C): the
	 * lists in this identity's registry, and this browser's three-word list as
	 * one more row.
	 *
	 * The start opens the shared list behind the browser's own three words and
	 * keeps it open, but without a link it ends in a list of one's own (#140).
	 * So its row names the words, without a Copy button, with the switch that
	 * puts it on screen. Only there are they copied ("This list"), and only
	 * there do the address bar and the page QR carry them: whoever hands them on
	 * is then in the list they hand on. It used to be a card of its own, between
	 * the open list's permissions and these rows, though it is about neither.
	 */
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import ListSwitcher from './ListSwitcher.svelte';

	/** This browser's three words; empty while there are none to offer. */
	export let mnemonic = '';
	/** The three-word list is the one on screen. */
	export let sharedOpen = false;
	/** The switch to it is under way. */
	export let busy = false;

	const dispatch = createEventDispatcher();
</script>

<section
	class="mb-6 rounded-lg border border-border bg-surface px-4 py-4 shadow-sm"
	aria-labelledby="your-lists-heading"
	data-testid="your-lists"
>
	<h2 id="your-lists-heading" class="text-xs font-semibold tracking-wide text-faint uppercase">
		{$_('lists.switcher.heading')}
	</h2>
	<p class="mt-1 text-xs text-faint">{$_('lists.switcher.hint')}</p>

	<div class="mt-2">
		<ListSwitcher />
	</div>

	{#if mnemonic}
		<div
			class="mt-1 flex items-center gap-2 border-t border-border pt-2"
			data-testid="three-word-list-row"
			data-active={sharedOpen}
		>
			<div
				class="min-w-0 flex-1 border-l-2 py-1.5 pl-2.5 {sharedOpen
					? 'border-cyan-600 dark:border-cyan'
					: 'border-transparent'}"
			>
				<p class="text-sm">
					<span class="font-medium text-heading">{$_('lists.threeWords.heading')}</span>
					{#if sharedOpen}<span class="ml-1 text-xs font-medium text-cyan-800 dark:text-cyan"
							>· {$_('lists.switcher.open')}</span
						>{/if}
				</p>
				<p class="text-xs text-faint">
					<code class="font-mono break-all text-text" data-testid="three-word-list-name"
						>{mnemonic}</code
					>
					· {$_('lists.threeWords.hint')}
				</p>
			</div>
			{#if !sharedOpen}
				<button
					type="button"
					on:click={() => dispatch('open')}
					disabled={busy}
					class="shrink-0 rounded-md border border-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-800 hover:bg-cyan-50 disabled:opacity-60 dark:border-cyan dark:text-cyan dark:hover:bg-cyan/10"
					data-testid="three-word-list-open"
				>
					{$_('lists.threeWords.open')}
				</button>
			{/if}
		</div>
	{/if}
</section>
