<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { formatEuro } from './invoice/money.js';
	import { formatDay } from './invoice/document.js';
	import { invoiceTotals } from './invoice/records.js';
	import { duplicateGroups, isDuplicated, mustGiveWay } from './invoice/duplicates.js';

	/** @type {any[]} */
	export let invoices = [];
	export let locale = 'de';

	const dispatch = createEventDispatcher();

	/** Newest first, and a draft belongs at the top: it is what somebody is working on. */
	// Two invoices with one number: found here rather than waited for, because
	// nobody notices it by reading a list.
	$: clashes = duplicateGroups(invoices);

	$: sorted = [...invoices].sort((a, b) => {
		if (a.state !== b.state) return a.state === 'draft' ? -1 : 1;
		return String(b.issueDate ?? '').localeCompare(String(a.issueDate ?? ''));
	});
</script>

{#if sorted.length === 0}
	<p class="mt-4 text-sm text-faint" data-testid="invoice-empty">{$_('invoice.none')}</p>
{:else}
	<div class="mt-4 overflow-x-auto">
		<table class="w-full text-left text-sm" data-testid="invoice-list">
			<thead class="text-xs text-faint">
				<tr>
					<th class="py-1 pr-3">{$_('invoice.columns.number')}</th>
					<th class="py-1 pr-3">{$_('invoice.columns.customer')}</th>
					<th class="py-1 pr-3">{$_('invoice.columns.date')}</th>
					<th class="py-1 pr-3 text-right">{$_('invoice.columns.gross')}</th>
					<th class="py-1 pr-3">{$_('invoice.columns.state')}</th>
					<th class="py-1"></th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as invoice (invoice.id)}
					<tr class="border-t border-gray-200 dark:border-gray-700" data-testid="invoice-row">
						<td class="py-2 pr-3 font-mono text-xs">
							{invoice.number ?? '—'}
							{#if isDuplicated(invoice, clashes)}
								<span
									class="block font-sans text-amber-700 dark:text-amber-400"
									data-testid="invoice-duplicate-mark"
									title={mustGiveWay(invoice, clashes)
										? $_('invoice.duplicate.explain')
										: $_('invoice.duplicate.keeps')}>{$_('invoice.duplicate.mark')}</span
								>
							{/if}
							{#if invoice.cancels}
								<span class="block text-faint"
									>{$_('invoice.cancelled.of', { values: { number: invoice.cancels } })}</span
								>
							{/if}
						</td>
						<td class="py-2 pr-3">{invoice.customer?.name || '—'}</td>
						<td class="py-2 pr-3 whitespace-nowrap">{formatDay(invoice.issueDate, locale)}</td>
						<td class="py-2 pr-3 text-right tabular-nums">
							{formatEuro(invoiceTotals(invoice).grossTotalCents)}
						</td>
						<td class="py-2 pr-3">
							{#if invoice.cancelledBy}
								<span
									class="text-faint"
									title={$_('invoice.cancelled.by', { values: { number: invoice.cancelledBy } })}
								>
									{$_('invoice.state.cancelled')}
								</span>
							{:else}
								{$_(`invoice.state.${invoice.state}`)}
							{/if}
						</td>
						<td class="py-2 text-right whitespace-nowrap">
							{#if invoice.state === 'draft'}
								<button
									class="rounded border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-600"
									data-testid="invoice-edit"
									on:click={() => dispatch('edit', invoice)}>{$_('invoice.actions.edit')}</button
								>
								<button
									class="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600"
									data-testid="invoice-delete"
									on:click={() => dispatch('delete', invoice)}
									>{$_('invoice.actions.delete')}</button
								>
							{:else}
								<button
									class="rounded border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-600"
									data-testid="invoice-pdf"
									on:click={() => dispatch('pdf', invoice)}>{$_('invoice.actions.pdf')}</button
								>
								{#if mustGiveWay(invoice, clashes)}
									<button
										class="rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400"
										data-testid="invoice-reissue"
										on:click={() => dispatch('reissue', invoice)}
										>{$_('invoice.duplicate.giveWay')}</button
									>
								{:else if !invoice.cancelledBy && !invoice.cancels}
									<button
										class="rounded border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-600"
										data-testid="invoice-storno"
										on:click={() => dispatch('storno', invoice)}
										>{$_('invoice.actions.storno')}</button
									>
								{/if}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
