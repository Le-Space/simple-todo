<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { emptyIssuer } from './invoice/settings.js';
	import { startFromNumber } from './invoice/numbering.js';

	/** @type {any} */
	export let settings;
	/** The circle this device issues from — shown, not edited: it is derived.
	 * @type {import('./invoice/numbering.js').NumberCircle | null} */
	export let circle = null;
	export let busy = false;

	const dispatch = createEventDispatcher();

	let issuer = emptyIssuer(settings.issuer);
	let paymentTermsDays = settings.paymentTermsDays;
	let firstNumber = '';
	let problem = '';

	/**
	 * A logo is stored as a PNG data URL in the list, so every device prints it.
	 *
	 * Whatever was picked — PNG, JPEG or SVG — is drawn onto a canvas first and
	 * comes back out as a PNG of at most 600 pixels. That bounds what travels
	 * with the list, and it is also how an SVG becomes something `pdf-lib` can
	 * embed.
	 *
	 * @param {Event} event
	 */
	async function readLogo(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const file = input.files?.[0];
		if (!file) return;
		problem = '';

		try {
			issuer = { ...issuer, logo: await toPng(file) };
		} catch {
			problem = $_('invoice.settings.logoTooLarge');
		} finally {
			input.value = '';
		}
	}

	/** @param {File} file @returns {Promise<string>} */
	function toPng(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error('unreadable'));
			reader.onload = () => {
				const image = new Image();
				image.onerror = () => reject(new Error('not an image'));
				image.onload = () => {
					const longest = Math.max(image.width, image.height) || 1;
					const scale = Math.min(1, 600 / longest);
					const canvas = document.createElement('canvas');
					canvas.width = Math.max(1, Math.round(image.width * scale));
					canvas.height = Math.max(1, Math.round(image.height * scale));
					const context = canvas.getContext('2d');
					if (!context) return reject(new Error('no canvas'));
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					resolve(canvas.toDataURL('image/png'));
				};
				image.src = String(reader.result);
			};
			reader.readAsDataURL(file);
		});
	}

	function submit() {
		problem = '';
		/** @type {any} */
		const patch = { issuer, paymentTermsDays };

		// "The first number here is 2026-005" — a series carried over from
		// another program, which the circle keeps as its floor.
		if (firstNumber.trim() && circle) {
			const start = startFromNumber(circle, firstNumber.trim());
			if (!start) {
				problem = $_('invoice.settings.seriesStartInvalid');
				return;
			}
			patch.circles = { ...settings.circles, [circleKey]: { ...circle, start } };
		}
		dispatch('save', patch);
	}

	/** Which identity's circle is being edited: the one shown. */
	export let circleKey = '';
</script>

<form
	class="mt-4 space-y-5 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="invoice-settings"
	on:submit|preventDefault={submit}
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
			<span class="text-faint">{$_('invoice.settings.issuerTaxNumber')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-taxnumber"
				bind:value={issuer.taxNumber}
			/>
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
			<span class="text-faint">{$_('invoice.settings.issuerPhone')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-phone"
				bind:value={issuer.phone}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.issuerWeb')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="issuer-web"
				bind:value={issuer.web}
			/>
		</label>
	</div>

	<fieldset class="grid gap-3 sm:grid-cols-3">
		<legend class="mb-1 text-sm font-medium text-heading">
			{$_('invoice.settings.registerHeading')}
		</legend>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.registerCourt')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="register-court"
				bind:value={issuer.register.court}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.registerNumber')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="register-number"
				bind:value={issuer.register.number}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.managingDirector')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="register-director"
				bind:value={issuer.register.managingDirector}
			/>
		</label>
	</fieldset>

	<fieldset class="grid gap-3 sm:grid-cols-3">
		<legend class="mb-1 text-sm font-medium text-heading">
			{$_('invoice.settings.bankHeading')}
		</legend>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.bankName')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="bank-name"
				bind:value={issuer.bank.name}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.bankIban')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono dark:border-gray-600"
				data-testid="bank-iban"
				bind:value={issuer.bank.iban}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.bankBic')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono dark:border-gray-600"
				data-testid="bank-bic"
				bind:value={issuer.bank.bic}
			/>
		</label>
		<p class="text-xs text-faint sm:col-span-3">{$_('invoice.settings.bankHint')}</p>
	</fieldset>

	<fieldset class="grid gap-3 sm:grid-cols-2">
		<legend class="mb-1 text-sm font-medium text-heading">
			{$_('invoice.settings.cryptoHeading')}
		</legend>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.cryptoBtc')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs dark:border-gray-600"
				data-testid="crypto-btc"
				bind:value={issuer.crypto.btc}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.cryptoEth')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs dark:border-gray-600"
				data-testid="crypto-eth"
				bind:value={issuer.crypto.eth}
			/>
		</label>
		<p class="text-xs text-faint sm:col-span-2">{$_('invoice.settings.cryptoHint')}</p>
	</fieldset>

	<fieldset class="space-y-2">
		<legend class="mb-1 text-sm font-medium text-heading">
			{$_('invoice.settings.logoHeading')}
		</legend>
		<div class="flex flex-wrap items-center gap-3">
			{#if issuer.logo}
				<img
					src={issuer.logo}
					alt=""
					class="h-12 w-12 rounded border border-gray-200 object-contain dark:border-gray-700"
					data-testid="issuer-logo-preview"
				/>
			{/if}
			<label
				class="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
			>
				{$_('invoice.settings.logoChoose')}
				<input
					type="file"
					class="hidden"
					accept="image/png,image/jpeg,image/svg+xml"
					data-testid="issuer-logo"
					on:change={readLogo}
				/>
			</label>
			{#if issuer.logo}
				<button
					type="button"
					class="rounded-md px-3 py-1.5 text-sm text-faint"
					data-testid="issuer-logo-remove"
					on:click={() => (issuer = { ...issuer, logo: '' })}
					>{$_('invoice.settings.logoRemove')}</button
				>
			{/if}
		</div>
		<p class="text-xs text-faint">{$_('invoice.settings.logoHint')}</p>
	</fieldset>

	<div class="grid gap-3 sm:grid-cols-2">
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
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.settings.seriesStart')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono dark:border-gray-600"
				data-testid="series-start"
				placeholder={circle ? circle.pattern : ''}
				bind:value={firstNumber}
			/>
		</label>
		<p class="text-xs text-faint sm:col-span-2">{$_('invoice.settings.seriesStartHint')}</p>
	</div>

	{#if circle}
		<div class="rounded-md bg-surface-2 p-3 text-sm">
			<p class="font-medium text-heading">{$_('invoice.settings.series')}</p>
			<p class="mt-1 font-mono text-xs" data-testid="invoice-series">{circle.pattern}</p>
			<p class="mt-1 text-xs text-faint">{$_('invoice.settings.seriesHint')}</p>
		</div>
	{/if}

	{#if problem}
		<p class="text-sm text-red-600" data-testid="invoice-settings-problem">{problem}</p>
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
