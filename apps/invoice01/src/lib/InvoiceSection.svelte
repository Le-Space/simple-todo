<script>
	import { _, locale } from '$lib/i18n/index.js';
	import InvoiceForm from './InvoiceForm.svelte';
	import InvoiceList from './InvoiceList.svelte';
	import InvoiceSettingsPanel from './InvoiceSettingsPanel.svelte';
	import { invoiceSettingsStore, invoicesStore } from './invoice/store.js';
	import { emptyDraft } from './invoice/records.js';
	import { circleOf, nextNumberFor, normaliseInvoiceSettings } from './invoice/settings.js';
	import { ownIdentityIdStore } from './db-actions.js';
	import { invoiceFileName, invoicePdfBytes } from './invoice/pdf.js';
	import { documentLabels } from './invoice/labels.js';
	import {
		deleteInvoiceDraft,
		issueInvoiceDraft,
		saveInvoiceDraft,
		saveInvoiceSettings,
		startCancellation
	} from './invoice-actions.js';

	/** Writing invoices needs a list this identity may write to. */
	export let enabled = false;

	/** @type {'list' | 'edit' | 'settings'} */
	let view = 'list';
	/** @type {any} */
	let draft = null;
	/** @type {import('./invoice/records.js').Problem[]} */
	let problems = [];
	let message = '';
	let error = '';
	let busy = false;

	// Everything here is read from the list, so a second device that writes an
	// invoice changes what this one shows without a reload.
	$: identityId = $ownIdentityIdStore ?? '';
	$: settings = normaliseInvoiceSettings($invoiceSettingsStore, identityId);
	$: circle = identityId ? circleOf(settings, identityId) : null;
	$: issuedNumbers = $invoicesStore
		.filter((invoice) => invoice.state === 'issued' && invoice.number)
		.map((invoice) => invoice.number);
	$: nextNumber = identityId ? nextNumberFor(settings, identityId, issuedNumbers) : '';

	function newInvoice() {
		draft = emptyDraft({
			taxMode: settings.taxMode,
			issueDate: new Date().toISOString().slice(0, 10)
		});
		draft.paymentTermsDays = settings.paymentTermsDays;
		problems = [];
		error = '';
		view = 'edit';
	}

	/** @param {CustomEvent<any>} event */
	function edit(event) {
		draft = {
			...event.detail,
			customer: { ...event.detail.customer },
			lines: event.detail.lines.map((/** @type {any} */ line) => ({ ...line }))
		};
		problems = [];
		error = '';
		view = 'edit';
	}

	async function save() {
		busy = true;
		const result = await saveInvoiceDraft(draft);
		busy = false;
		if (!result.ok) return (error = result.error ?? '');
		message = $_('invoice.form.saved');
		error = '';
		view = 'list';
	}

	async function issue() {
		busy = true;
		const saved = await saveInvoiceDraft(draft);
		if (!saved.ok) {
			busy = false;
			return (error = saved.error ?? '');
		}
		const result = await issueInvoiceDraft(draft);
		busy = false;
		if (!result.ok) {
			problems = result.problems ?? [];
			error = problems.length > 0 ? '' : (result.error ?? '');
			return;
		}
		message = $_('invoice.form.issued', { values: { number: result.number } });
		error = '';
		problems = [];
		view = 'list';
	}

	/** @param {CustomEvent<any>} event */
	async function remove(event) {
		const result = await deleteInvoiceDraft(event.detail.id);
		if (!result.ok) error = result.error ?? '';
	}

	/** @param {CustomEvent<any>} event */
	async function storno(event) {
		const invoice = event.detail;
		const asked = $_('invoice.cancelled.confirm', { values: { number: invoice.number } });
		if (typeof window !== 'undefined' && !window.confirm(asked)) return;
		const result = await startCancellation(invoice.number);
		if (!result.ok) return (error = result.error ?? '');
		draft = result.draft;
		problems = [];
		view = 'edit';
	}

	/** @param {CustomEvent<any>} event */
	async function download(event) {
		const invoice = event.detail;
		try {
			busy = true;
			const bytes = await invoicePdfBytes(invoice, documentLabels($_), {
				locale: $locale ?? 'de'
			});
			const url = URL.createObjectURL(
				new Blob([/** @type {BlobPart} */ (bytes)], { type: 'application/pdf' })
			);
			const link = document.createElement('a');
			link.href = url;
			link.download = invoiceFileName(invoice);
			link.click();
			// Revoked on the next turn of the event loop: the click has to have
			// started the download before the URL stops pointing anywhere.
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	/** @param {CustomEvent<any>} event */
	async function storeSettings(event) {
		busy = true;
		const result = await saveInvoiceSettings(event.detail);
		busy = false;
		if (!result.ok) return (error = result.error ?? '');
		message = $_('invoice.settings.saved');
		error = '';
		view = 'list';
	}
</script>

<section class="mt-6" data-testid="invoice-section">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-xl font-semibold text-heading">{$_('invoice.heading')}</h2>
		{#if enabled && view === 'list'}
			<div class="flex gap-2">
				<button
					class="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700"
					data-testid="invoice-new"
					on:click={newInvoice}>{$_('invoice.new')}</button
				>
				<button
					class="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
					data-testid="invoice-settings-open"
					on:click={() => (view = 'settings')}>{$_('invoice.actions.settings')}</button
				>
			</div>
		{/if}
	</div>

	{#if !enabled}
		<p class="mt-3 text-sm text-faint" data-testid="invoice-needs-list">
			{$_('invoice.needsList')}
		</p>
	{:else if view === 'edit' && draft}
		<InvoiceForm
			bind:draft
			{problems}
			{busy}
			nextNumber={draft.state === 'draft' ? nextNumber : ''}
			on:save={save}
			on:issue={issue}
			on:back={() => (view = 'list')}
		/>
	{:else if view === 'settings'}
		<InvoiceSettingsPanel
			{settings}
			{busy}
			{circle}
			circleKey={identityId}
			on:save={storeSettings}
			on:back={() => (view = 'list')}
		/>
	{:else}
		<InvoiceList
			invoices={$invoicesStore}
			locale={$locale ?? 'de'}
			on:edit={edit}
			on:delete={remove}
			on:pdf={download}
			on:storno={storno}
		/>
	{/if}

	{#if message}
		<p class="mt-3 text-sm text-green-700 dark:text-green-400" data-testid="invoice-message">
			{message}
		</p>
	{/if}
	{#if error}
		<p class="mt-3 text-sm text-red-600" data-testid="invoice-error">{error}</p>
	{/if}
</section>
