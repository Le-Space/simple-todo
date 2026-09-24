<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { computeTotals, formatEuro, parseEuroToCents, parseQuantity } from './invoice/money.js';
	import { emptyLine } from './invoice/records.js';
	import { activeCustomers } from './invoice/customers.js';

	/** The draft being written. Replaced on every change, never mutated in place.
	 * @type {any} */
	export let draft;
	/** Problems reported by the last attempt to issue.
	 * @type {import('./invoice/records.js').Problem[]} */
	export let problems = [];
	export let nextNumber = '';
	export let busy = false;
	/** The directory, for picking instead of typing.
	 * @type {any[]} */
	export let customers = [];

	$: pickable = activeCustomers(customers);

	const dispatch = createEventDispatcher();

	/**
	 * Why everything goes through a replacement rather than `bind:value` on a
	 * nested field: a prop is not deeply reactive. `draft.lines[0].quantity = 2`
	 * updates the object and nothing else — the totals kept reading 0,00 € while
	 * the fields showed what had been typed. Replacing `draft` is what the
	 * compiler can see, and it is what reaches the parent through `bind:draft`.
	 */
	/** @param {string} field @param {unknown} value */
	function setField(field, value) {
		draft = { ...draft, [field]: value };
	}

	/** @param {string} field @param {string} value */
	function setCustomer(field, value) {
		draft = { ...draft, customer: { ...draft.customer, [field]: value } };
	}

	/** @param {number} index @param {string} field @param {unknown} value */
	function setLine(index, field, value) {
		draft = {
			...draft,
			lines: draft.lines.map((/** @type {any} */ line, /** @type {number} */ at) =>
				at === index ? { ...line, [field]: value } : line
			)
		};
	}

	/** Prices and quantities are typed in German ("1.234,56"), so the text of
	 * each field is kept beside the number it parses to. */
	let priceText = draft.lines.map((/** @type {any} */ line) =>
		(line.unitPriceCents / 100).toFixed(2).replace('.', ',')
	);
	let quantityText = draft.lines.map((/** @type {any} */ line) =>
		String(line.quantity).replace('.', ',')
	);
	/** The bullets as one text, one per line, so typing an empty line is fine. */
	let detailText = draft.lines.map((/** @type {any} */ line) => (line.details ?? []).join('\n'));

	$: totals = computeTotals(draft.lines, draft.taxMode);
	$: lineProblems = draft.lines.map((/** @type {any} */ _line, /** @type {number} */ index) =>
		problems.filter((problem) => problem.line === index).map((problem) => problem.code)
	);
	$: generalProblems = problems.filter((problem) => problem.line === undefined);

	function addLine() {
		draft = { ...draft, lines: [...draft.lines, emptyLine()] };
		priceText = [...priceText, '0,00'];
		quantityText = [...quantityText, '1'];
		detailText = [...detailText, ''];
	}

	/** @param {number} index */
	function removeLine(index) {
		draft = {
			...draft,
			lines: draft.lines.filter(
				(/** @type {any} */ _line, /** @type {number} */ at) => at !== index
			)
		};
		priceText = priceText.filter(
			(/** @type {string} */ _text, /** @type {number} */ at) => at !== index
		);
		quantityText = quantityText.filter(
			(/** @type {string} */ _text, /** @type {number} */ at) => at !== index
		);
		detailText = detailText.filter(
			(/** @type {string} */ _text, /** @type {number} */ at) => at !== index
		);
	}

	/** @param {number} index @param {string} text */
	function readDetails(index, text) {
		detailText[index] = text;
		setLine(
			index,
			'details',
			text
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
		);
	}

	/** @param {number} index @param {string} text */
	function readPrice(index, text) {
		priceText[index] = text;
		const cents = parseEuroToCents(text);
		if (cents !== null) setLine(index, 'unitPriceCents', cents);
	}

	/** @param {number} index @param {string} text */
	function readQuantity(index, text) {
		quantityText[index] = text;
		const quantity = parseQuantity(text);
		if (quantity !== null) setLine(index, 'quantity', quantity);
	}
</script>

<form
	class="mt-4 space-y-5 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="invoice-form"
	on:submit|preventDefault={() => dispatch('save')}
>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h3 class="text-lg font-semibold text-heading">
			{draft.cancels
				? $_('invoice.cancelled.of', { values: { number: draft.cancels } })
				: $_('invoice.new')}
		</h3>
		{#if nextNumber}
			<p class="text-xs text-faint" data-testid="invoice-next-number">
				{$_('invoice.nextNumber', { values: { number: nextNumber } })}
			</p>
		{/if}
	</div>

	<fieldset class="grid gap-3 sm:grid-cols-2">
		<legend class="mb-1 text-sm font-medium text-heading">{$_('invoice.form.customer')}</legend>
		{#if pickable.length > 0}
			<label class="block text-sm sm:col-span-2">
				<span class="text-faint">{$_('invoice.customers.pick')}</span>
				<select
					class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
					data-testid="invoice-customer-pick"
					value=""
					on:change={(event) => {
						dispatch('pickCustomer', event.currentTarget.value);
						event.currentTarget.value = '';
					}}
				>
					<option value="">{$_('invoice.customers.pickNone')}</option>
					{#each pickable as customer (customer.id)}
						<option value={customer.id}>{customer.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.form.customerName')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-customer-name"
				value={draft.customer.name}
				on:input={(event) => setCustomer('name', event.currentTarget.value)}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.form.customerNumber')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-customer-number"
				value={draft.customer.number ?? ''}
				on:input={(event) => setCustomer('number', event.currentTarget.value)}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.form.customerVatId')}</span>
			<input
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-customer-vatid"
				value={draft.customer.vatId ?? ''}
				on:input={(event) => setCustomer('vatId', event.currentTarget.value)}
			/>
		</label>
		<label class="block text-sm sm:col-span-2">
			<span class="text-faint">{$_('invoice.form.customerAddress')}</span>
			<textarea
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-customer-address"
				rows="2"
				value={draft.customer.address}
				on:input={(event) => setCustomer('address', event.currentTarget.value)}
			></textarea>
		</label>
		<div class="sm:col-span-2">
			<button
				type="button"
				class="rounded-md border border-gray-300 px-3 py-1 text-xs dark:border-gray-600"
				data-testid="invoice-customer-keep"
				on:click={() => dispatch('saveCustomer')}>{$_('invoice.customers.save')}</button
			>
		</div>
	</fieldset>

	<div class="grid gap-3 sm:grid-cols-4">
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.form.issueDate')}</span>
			<input
				type="date"
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-issue-date"
				value={draft.issueDate}
				on:input={(event) => setField('issueDate', event.currentTarget.value)}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.form.deliveryDate')}</span>
			<input
				type="date"
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-delivery-date"
				value={draft.deliveryDate}
				on:input={(event) => setField('deliveryDate', event.currentTarget.value)}
			/>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.form.taxMode')}</span>
			<select
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-tax-mode"
				value={draft.taxMode}
				on:change={(event) => setField('taxMode', event.currentTarget.value)}
			>
				<option value="standard">{$_('invoice.taxMode.standard')}</option>
				<option value="kleinunternehmer">{$_('invoice.taxMode.kleinunternehmer')}</option>
				<option value="reverse-charge">{$_('invoice.taxMode.reverseCharge')}</option>
			</select>
		</label>
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.form.paymentTerms')}</span>
			<input
				type="number"
				min="0"
				class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
				data-testid="invoice-payment-terms"
				value={draft.paymentTermsDays}
				on:input={(event) => setField('paymentTermsDays', Number(event.currentTarget.value))}
			/>
		</label>
	</div>

	<div class="space-y-3">
		<h4 class="text-sm font-medium text-heading">{$_('invoice.form.lines')}</h4>
		{#each draft.lines as line, index (index)}
			<div class="grid gap-2 rounded-md bg-surface-2 p-2 sm:grid-cols-12">
				<label class="block text-sm sm:col-span-5">
					<span class="text-faint">{$_('invoice.form.lineDescription')}</span>
					<input
						class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
						data-testid="invoice-line-description"
						value={line.description}
						on:input={(event) => setLine(index, 'description', event.currentTarget.value)}
					/>
				</label>
				<label class="block text-sm sm:col-span-7">
					<span class="text-faint">{$_('invoice.form.lineSubtitle')}</span>
					<input
						class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
						data-testid="invoice-line-subtitle"
						value={line.subtitle ?? ''}
						on:input={(event) => setLine(index, 'subtitle', event.currentTarget.value)}
					/>
				</label>
				<label class="block text-sm sm:col-span-2">
					<span class="text-faint">{$_('invoice.form.lineQuantity')}</span>
					<input
						class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
						data-testid="invoice-line-quantity"
						value={quantityText[index]}
						on:input={(event) => readQuantity(index, event.currentTarget.value)}
					/>
				</label>
				<label class="block text-sm sm:col-span-1">
					<span class="text-faint">{$_('invoice.form.lineUnit')}</span>
					<input
						class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
						value={line.unit}
						on:input={(event) => setLine(index, 'unit', event.currentTarget.value)}
					/>
				</label>
				<label class="block text-sm sm:col-span-2">
					<span class="text-faint">{$_('invoice.form.lineUnitPrice')}</span>
					<input
						class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-right dark:border-gray-600"
						data-testid="invoice-line-price"
						value={priceText[index]}
						on:input={(event) => readPrice(index, event.currentTarget.value)}
					/>
				</label>
				<label class="block text-sm sm:col-span-1">
					<span class="text-faint">{$_('invoice.form.lineVatRate')}</span>
					<select
						class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
						disabled={draft.taxMode !== 'standard'}
						value={line.vatRate}
						on:change={(event) => setLine(index, 'vatRate', Number(event.currentTarget.value))}
					>
						<option value={19}>19 %</option>
						<option value={7}>7 %</option>
						<option value={0}>0 %</option>
					</select>
				</label>
				<label class="block text-sm sm:col-span-12">
					<span class="text-faint">{$_('invoice.form.lineDetails')}</span>
					<textarea
						class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-600"
						data-testid="invoice-line-details"
						rows="2"
						placeholder={$_('invoice.form.lineDetailsHint')}
						value={detailText[index] ?? ''}
						on:input={(event) => readDetails(index, event.currentTarget.value)}
					></textarea>
				</label>
				<div class="flex items-end justify-between gap-2 sm:col-span-1">
					<span class="text-sm tabular-nums" data-testid="invoice-line-net">
						{formatEuro(totals.lines[index]?.netCents ?? 0)}
					</span>
					{#if draft.lines.length > 1}
						<button
							type="button"
							class="rounded border border-red-300 px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
							title={$_('invoice.form.removeLine')}
							on:click={() => removeLine(index)}>×</button
						>
					{/if}
				</div>
				{#each lineProblems[index] ?? [] as code (code)}
					<p class="text-xs text-red-600 sm:col-span-12">{$_(code)}</p>
				{/each}
			</div>
		{/each}
		<button
			type="button"
			class="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
			data-testid="invoice-add-line"
			on:click={addLine}>{$_('invoice.form.addLine')}</button
		>
	</div>

	<label class="block text-sm">
		<span class="text-faint">{$_('invoice.form.notes')}</span>
		<textarea
			class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600"
			rows="2"
			value={draft.notes ?? ''}
			on:input={(event) => setField('notes', event.currentTarget.value)}
		></textarea>
	</label>

	<dl class="ml-auto max-w-xs space-y-1 text-sm" data-testid="invoice-totals">
		<div class="flex justify-between gap-6">
			<dt class="text-faint">{$_('invoice.totals.net')}</dt>
			<dd class="tabular-nums">{formatEuro(totals.netTotalCents)}</dd>
		</div>
		{#if draft.taxMode === 'standard'}
			{#each totals.vatBreakdown as group (group.rate)}
				<div class="flex justify-between gap-6">
					<dt class="text-faint">{$_('invoice.totals.vat', { values: { rate: group.rate } })}</dt>
					<dd class="tabular-nums">{formatEuro(group.taxCents)}</dd>
				</div>
			{/each}
		{/if}
		<div
			class="flex justify-between gap-6 border-t border-gray-200 pt-1 font-semibold dark:border-gray-700"
		>
			<dt>{$_('invoice.totals.gross')}</dt>
			<dd class="tabular-nums" data-testid="invoice-gross">{formatEuro(totals.grossTotalCents)}</dd>
		</div>
	</dl>

	{#each generalProblems as problem (problem.code)}
		<p class="text-sm text-red-600" data-testid="invoice-problem">{$_(problem.code)}</p>
	{/each}

	<p class="text-xs text-faint">{$_('invoice.form.issueHint')}</p>

	<div class="flex flex-wrap gap-2">
		<button
			type="submit"
			class="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
			disabled={busy}
			data-testid="invoice-save">{$_('invoice.form.save')}</button
		>
		<button
			type="button"
			class="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
			disabled={busy}
			data-testid="invoice-issue"
			on:click={() => dispatch('issue')}>{$_('invoice.form.issue')}</button
		>
		<button
			type="button"
			class="rounded-md px-3 py-1.5 text-sm text-faint"
			on:click={() => dispatch('back')}>{$_('invoice.actions.back')}</button
		>
	</div>
</form>
