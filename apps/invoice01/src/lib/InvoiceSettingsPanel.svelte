<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';

	export let settings;
	/** The circle this device issues from — shown, not edited: it is derived.
	 * @type {import('./invoice/numbering.js').NumberCircle | null} */
	export let circle = null;
	export let busy = false;

	const dispatch = createEventDispatcher();
	let issuer = { ...settings.issuer };
	let paymentTermsDays = settings.paymentTermsDays;
</script>

<form
	class="mt-4 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="invoice-settings"
	on:submit|preventDefault={() => dispatch('save', { issuer, paymentTermsDays })}
>
	<h3 class="text-lg font-semibold text-heading">{$_('invoice.settings.heading')}</h3>

	<div class="grid gap-3 sm:grid-cols-2">
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.issuerName')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-name"
				bind:value={issuer.name}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.issuerVatId')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-vatid"
				bind:value={issuer.vatId}
			/>
		</label>
		<label class="block text-sm sm:col-span-2">
			<span class="text-faint">{$_('invoice.settings.issuerAddress')}</span>
			<textarea
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-address"
				rows="2"
				bind:value={issuer.address}
			></textarea>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.issuerEmail')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-email"
				bind:value={issuer.email}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.issuerIban')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-iban"
				bind:value={issuer.iban}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.paymentTerms')}</span>
			<input
				type="number"
				min="0"
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-terms"
				bind:value={paymentTermsDays}
			/>
		</label>
	</div>

	{#if circle}
		<div class="rounded-md bg-surface-2 p-3 text-sm">
			<p class="font-medium text-heading">{$_('invoice.settings.series')}</p>
			<p class="mt-1 font-mono text-xs" data-testid="invoice-series">{circle.pattern}</p>
			<p class="mt-1 text-xs text-faint">{$_('invoice.settings.seriesHint')}</p>
		</div>
	{/if}

	<div class="flex gap-2">
		<button
			type="submit"
			class="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
			disabled={busy}
			data-testid="invoice-settings-save">{$_('invoice.settings.save')}</button
		>
		<button
			type="button"
			class="rounded-md px-3 py-1.5 text-sm text-faint"
			on:click={() => dispatch('back')}>{$_('invoice.actions.back')}</button
		>
	</div>
</form>
