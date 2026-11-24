<script>
	/**
	 * "Join a shared list", in the start dialog's settings (escrow01).
	 *
	 * Every browser starts on a three-word list of its own, generated here. The
	 * share code is needed only by somebody who wants somebody else's list, so
	 * the field appears when they ask for it. Handing one's own words on is what
	 * the page QR and the link are for, after the start. (Later this moves to the
	 * lists tab, where switching lists belongs.)
	 *
	 * Unticked, the words typed here are kept, not cleared: ticking it again
	 * brings them back.
	 */
	import { _ } from '$lib/i18n/index.js';
	import { technicalView } from './technical-view.js';
	import { MnemonicError, normalizeSpanishMnemonic } from '@simple-todo/todo/spanish-mnemonic.js';

	/** Whether the start opens the list behind the words below. */
	export let join = false;
	/** The share code typed, or brought by a link. */
	export let value = '';

	/** @type {HTMLInputElement | undefined} */
	let input;
	// A code brought by a link or by "switch list" is shown as it is; an error
	// waits until somebody has typed.
	let touched = false;

	// `$_` is passed in so a language switch rewrites a message already showing.
	$: validation = validate(value, $_);

	/**
	 * @param {string} words
	 * @param {(id: string, options?: { values?: Record<string, string> }) => string} format
	 */
	function validate(words, format) {
		try {
			return { canonical: normalizeSpanishMnemonic(words), error: '' };
		} catch (error) {
			const message =
				error instanceof MnemonicError
					? format(`consent.mnemonicError.${error.code}`, { values: { word: error.word } })
					: error instanceof Error
						? error.message
						: String(error);
			return { canonical: '', error: message };
		}
	}

	/** @param {Event & { currentTarget: HTMLInputElement }} event */
	function toggle(event) {
		join = event.currentTarget.checked;
		if (join) requestAnimationFrame(() => input?.focus());
	}
</script>

<div class="rounded-lg border border-border p-3" data-testid="shared-list-selector">
	<label class="flex cursor-pointer items-start gap-2.5">
		<input
			type="checkbox"
			checked={join}
			on:change={toggle}
			data-testid="consent-join-list"
			class="mt-0.5 h-4 w-4 shrink-0"
		/>
		<span class="text-sm">
			<span class="block font-medium text-heading">{$_('consent.join')}</span>
			<span class="block text-xs text-faint">{$_('consent.joinHint')}</span>
		</span>
	</label>
	{#if join}
		<div class="mt-3 pl-[26px]">
			<label for="shared-list-mnemonic" class="sr-only">{$_('consent.mnemonicLabel')}</label>
			<input
				id="shared-list-mnemonic"
				bind:this={input}
				data-testid="shared-list-mnemonic-input"
				bind:value
				on:input={() => (touched = true)}
				aria-describedby="shared-list-help shared-list-error"
				aria-invalid={validation.error ? 'true' : 'false'}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				class="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-cyan-500"
				placeholder={$_('consent.mnemonicPlaceholder')}
			/>
			{#if validation.error && touched}
				<p
					id="shared-list-error"
					role="alert"
					class="mt-1 text-xs text-danger-700 dark:text-danger"
				>
					{validation.error}
				</p>
			{:else}
				<p id="shared-list-error" class="sr-only">{$_('consent.mnemonicSrError')}</p>
			{/if}
			<p id="shared-list-help" class="mt-1.5 text-xs leading-relaxed text-faint">
				{$technicalView ? $_('consent.mnemonicHelpTechnical') : $_('consent.mnemonicHelp')}
			</p>
		</div>
	{/if}
</div>
