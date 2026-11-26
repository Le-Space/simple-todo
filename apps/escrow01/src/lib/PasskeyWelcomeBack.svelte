<script>
	/**
	 * The way back in for somebody whose passkey is already linked to this
	 * device (escrow01).
	 *
	 * A passkey needs a tap on every start — WebAuthn asks for a user gesture —
	 * so a remembered passkey session cannot start by itself. It used to bring
	 * back the whole consent dialog, with a sentence explaining that nothing had
	 * gone wrong. That person has read the dialog: a passkey is linked to this
	 * device only after it was accepted. What they need is the tap, so this is
	 * the tap, and the dialog is one click away for anybody who wants to change
	 * something or read the notices again.
	 *
	 * The press itself is the page's (`continue`): the passkey prompt must run
	 * inside this click's user gesture, so nothing here awaits before it.
	 */
	import { createEventDispatcher, onMount } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import LanguageSwitcher from '@simple-todo/ui/LanguageSwitcher.svelte';
	import BudgetIcon from './BudgetIcon.svelte';
	import ForgetThisBrowserLink from './ForgetThisBrowserLink.svelte';

	/** Whether the passkey prompt is up, so the button says so and waits. */
	export let busy = false;
	/** What went wrong on the last press, shown here rather than behind a dialog. */
	/** @type {string | null} */
	export let error = null;

	const dispatch = createEventDispatcher();

	/** @type {HTMLDialogElement} */
	let dialog;
	/** @type {HTMLButtonElement} */
	let continueButton;

	onMount(() => {
		dialog.showModal();
		// The one thing to do here; on a dialog this small the language switch
		// in the corner is not where the cursor belongs.
		continueButton.focus();
		return () => {
			if (dialog.open) dialog.close();
		};
	});
</script>

<!--
	`cancel` is Escape. This step is the way into the app, not a notice to wave
	away: closing it would leave an empty page behind it.
-->
<dialog
	bind:this={dialog}
	on:cancel|preventDefault
	data-testid="passkey-welcome"
	aria-labelledby="passkey-welcome-title"
	class="m-auto box-border w-[calc(100vw-2rem)] max-w-md rounded-[14px] border border-border bg-surface p-5 text-text backdrop:bg-black/55"
>
	<div class="flex items-start justify-between gap-3">
		<span
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-800 text-white dark:bg-cyan dark:text-bg"
		>
			<BudgetIcon name="key" size={22} />
		</span>
		<LanguageSwitcher />
	</div>

	<h2 id="passkey-welcome-title" class="mt-4 text-xl font-bold text-heading">
		{$_('welcome.title')}
	</h2>
	<p class="mt-2 text-sm leading-relaxed">{$_('welcome.text')}</p>

	{#if error}
		<p
			role="alert"
			data-testid="passkey-welcome-error"
			class="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
		>
			{error}
		</p>
	{/if}

	<button
		type="button"
		bind:this={continueButton}
		on:click={() => dispatch('continue')}
		aria-disabled={busy}
		data-testid="passkey-welcome-continue"
		class="mt-5 w-full rounded-md bg-coral-700 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-800 aria-disabled:cursor-wait aria-disabled:bg-surface-2 aria-disabled:text-faint"
	>
		{busy ? $_('welcome.waiting') : $_('welcome.continue')}
	</button>

	<p class="mt-4 text-xs text-faint">{$_('welcome.accepted')}</p>
	<button
		type="button"
		on:click={() => dispatch('more')}
		data-testid="passkey-welcome-more"
		class="mt-1 text-sm text-text underline underline-offset-2 hover:text-heading"
	>
		{$_('welcome.more')}
	</button>
	<!-- The moment somebody on a shared computer needs it, and it asks for no
	     passkey: what this browser keeps goes, and the start begins anew. -->
	<ForgetThisBrowserLink className="mt-2 block text-sm text-text" />
</dialog>
