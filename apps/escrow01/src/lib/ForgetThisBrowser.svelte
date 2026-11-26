<script>
	/**
	 * "Should this browser forget you?" -- the confirmation (escrow01).
	 *
	 * One dialog for both ways in, the footer and the welcome step, placed on
	 * the page like the demo video's player and opened the same way: a link
	 * sets `forgetOpener` to itself, and focus goes back there on Cancel. Its
	 * own `<dialog>` with `showModal()`, so it lies above the welcome step when
	 * that opened it, and that step's Escape guard hears nothing of it.
	 *
	 * It says what goes and, as plainly, what stays: somebody about to press a
	 * button that cannot be undone needs to know that the passkey, the lists
	 * elsewhere and the money are not what it deletes. The work is in
	 * forget-this-browser.js.
	 */
	import { onDestroy } from 'svelte';
	import { _, locale } from '$lib/i18n/index.js';
	import { technicalView } from './technical-view.js';
	import { forgetOpener, forgetThisBrowser } from './forget-this-browser.js';

	/** @type {HTMLDialogElement | undefined} */
	let dialog;
	/** @type {HTMLButtonElement | undefined} */
	let cancelButton;
	let busy = false;

	const stop = forgetOpener.subscribe((opener) => {
		if (!opener || !dialog || dialog.open) return;
		dialog.showModal();
		// The answer that changes nothing is where the cursor starts.
		cancelButton?.focus();
	});
	onDestroy(stop);

	/** Escape and Cancel both end here. */
	function onClose() {
		const opener = $forgetOpener;
		forgetOpener.set(null);
		opener?.focus({ preventScroll: true });
	}

	async function confirm() {
		if (busy) return;
		busy = true;
		// Ends in a reload; nothing after this runs on this page.
		await forgetThisBrowser({ lang: $locale ?? null });
	}
</script>

<dialog
	bind:this={dialog}
	on:close={onClose}
	data-testid="forget-browser"
	aria-labelledby="forget-browser-title"
	aria-describedby="forget-browser-goes"
	class="m-auto box-border w-[calc(100vw-2rem)] max-w-md rounded-[14px] border border-border bg-surface p-5 text-text backdrop:bg-black/55"
>
	<h2 id="forget-browser-title" class="text-xl font-bold text-heading">
		{$_('forget.title')}
	</h2>
	<p id="forget-browser-goes" class="mt-2 text-sm leading-relaxed">{$_('forget.goes')}</p>
	<p class="mt-2 text-sm leading-relaxed">{$_('forget.unsynced')}</p>

	<h3 class="mt-4 text-sm font-semibold text-heading">{$_('forget.staysTitle')}</h3>
	<ul
		class="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed"
		data-testid="forget-browser-stays"
	>
		<li>{$_('forget.staysPasskey')}</li>
		<li>{$_('forget.staysLists')}</li>
		<li>{$_('forget.staysAccount')}</li>
	</ul>

	{#if $technicalView}
		<p class="mt-3 text-xs leading-relaxed text-faint" data-testid="forget-browser-technical">
			{$_('forget.technical')}
		</p>
	{/if}

	<div class="mt-5 flex flex-wrap justify-end gap-2">
		<button
			type="button"
			bind:this={cancelButton}
			on:click={() => dialog?.close()}
			data-testid="forget-browser-cancel"
			class="min-h-10 rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:text-heading"
		>
			{$_('forget.cancel')}
		</button>
		<button
			type="button"
			on:click={confirm}
			aria-disabled={busy}
			data-testid="forget-browser-confirm"
			class="min-h-10 rounded-md bg-danger-700 px-4 py-2 text-sm font-medium text-white hover:bg-danger-800 aria-disabled:cursor-wait aria-disabled:bg-surface-2 aria-disabled:text-faint"
		>
			{busy ? $_('forget.busy') : $_('forget.confirm')}
		</button>
	</div>
</dialog>
