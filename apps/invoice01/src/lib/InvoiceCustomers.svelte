<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { matchCustomers } from './invoice/customers.js';

	/** @type {any[]} */
	export let customers = [];
	export let busy = false;

	const dispatch = createEventDispatcher();
	let query = '';

	$: shown = matchCustomers(customers, query);

	/** @param {any} customer */
	function remove(customer) {
		const asked = $_('invoice.customers.deleteConfirm', { values: { name: customer.name } });
		if (typeof window !== 'undefined' && !window.confirm(asked)) return;
		dispatch('delete', customer);
	}
</script>

<section
	class="mt-4 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="invoice-customers"
>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h3 class="text-lg font-semibold text-heading">{$_('invoice.customers.heading')}</h3>
		<input
			class="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600"
			data-testid="customer-search"
			placeholder={$_('invoice.customers.search')}
			bind:value={query}
		/>
	</div>

	{#if shown.length === 0}
		<p class="text-sm text-faint" data-testid="customer-empty">{$_('invoice.customers.none')}</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead class="text-xs text-faint">
					<tr>
						<th class="py-1 pr-3">{$_('invoice.customers.columnsNumber')}</th>
						<th class="py-1 pr-3">{$_('invoice.customers.columnsName')}</th>
						<th class="py-1 pr-3">{$_('invoice.customers.columnsAddress')}</th>
						<th class="py-1 pr-3">{$_('invoice.customers.columnsVatId')}</th>
						<th class="py-1"></th>
					</tr>
				</thead>
				<tbody>
					{#each shown as customer (customer.id)}
						<tr class="border-t border-gray-200 dark:border-gray-700" data-testid="customer-row">
							<td class="py-2 pr-3 font-mono text-xs">{customer.number || '—'}</td>
							<td class="py-2 pr-3">{customer.name}</td>
							<td class="py-2 pr-3 whitespace-pre-line">{customer.address}</td>
							<td class="py-2 pr-3 font-mono text-xs">{customer.vatId || '—'}</td>
							<td class="py-2 text-right whitespace-nowrap">
								<button
									class="rounded border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-600"
									data-testid="customer-use"
									disabled={busy}
									on:click={() => dispatch('use', customer)}>{$_('invoice.new')}</button
								>
								<button
									class="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600"
									data-testid="customer-delete"
									disabled={busy}
									on:click={() => remove(customer)}>{$_('invoice.customers.delete')}</button
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<p class="text-xs text-faint" data-testid="customer-delete-hint">
		{$_('invoice.customers.deleteHint')}
	</p>
	<p class="text-xs text-faint">{$_('invoice.customers.privacyHint')}</p>

	<button
		type="button"
		class="rounded-md px-3 py-1.5 text-sm text-faint"
		on:click={() => dispatch('back')}>{$_('invoice.actions.back')}</button
	>
</section>
