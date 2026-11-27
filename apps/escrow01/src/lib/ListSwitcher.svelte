<script>
	// The rows of "Your lists" (acl01, issue #114 step 3; escrow01 #127 PR C).
	// Entries come from the identity's own registry database, so they survive a
	// reload and replicate to the same passkey on another device -- see
	// list-registry.js.
	//
	// Plain rows: the open one is marked, and "Forget" sits behind a menu
	// rather than beside every row, where it was the loudest button on the tab.
	import { _ } from '$lib/i18n/index.js';
	import {
		listRegistryStore,
		listRegistryReadyStore,
		listRegistryNameStore,
		forgetList
	} from './list-registry.js';
	import { orbitdbStore, todoDBAddressStore, loadTodoDatabase } from './db-actions.js';

	/** @type {string | null} */
	let busyAddress = null;
	/** @type {string | null} */
	let errorMessage = null;

	/** @param {string} address */
	async function open(address) {
		if (address === $todoDBAddressStore) return;
		busyAddress = address;
		errorMessage = null;
		try {
			await loadTodoDatabase(address);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busyAddress = null;
		}
	}

	/** @param {string} address @param {Event} event */
	async function forget(address, event) {
		/** @type {HTMLElement} */ (event.currentTarget).closest('details')?.removeAttribute('open');
		try {
			await forgetList($orbitdbStore, address);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
	}
</script>

{#if $listRegistryReadyStore && $listRegistryStore.length}
	<ul
		class="divide-y divide-border"
		data-testid="list-switcher"
		data-registry-name={$listRegistryNameStore}
	>
		{#each $listRegistryStore as entry (entry.address)}
			{@const active = entry.address === $todoDBAddressStore}
			{@const label = entry.name || $_('lists.switcher.unnamed')}
			<li class="flex items-center gap-2 py-1">
				<button
					type="button"
					on:click={() => open(entry.address)}
					disabled={busyAddress !== null}
					aria-current={active ? 'true' : undefined}
					data-testid="list-switcher-open"
					data-address={entry.address}
					data-active={active}
					class="min-w-0 flex-1 rounded-md border-l-2 py-1.5 pr-2 pl-2.5 text-left text-sm disabled:opacity-50 {active
						? 'border-cyan-600 dark:border-cyan'
						: 'border-transparent hover:bg-surface-2'}"
				>
					<span class="font-medium text-heading">{label}</span>
					<span class="ml-1 text-xs text-faint"
						>· {$_(`lists.switcher.role.${entry.role}`, { default: entry.role })}</span
					>
					{#if active}<span class="ml-1 text-xs font-medium text-cyan-800 dark:text-cyan"
							>· {$_('lists.switcher.open')}</span
						>{/if}
					<code class="mt-0.5 block truncate font-mono text-[10px] text-faint">{entry.address}</code
					>
				</button>
				<details class="relative shrink-0">
					<summary
						class="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-faint outline-none hover:bg-surface-2 hover:text-text focus-visible:ring-2 focus-visible:ring-cyan-500 [&::-webkit-details-marker]:hidden"
						aria-label={$_('lists.switcher.more', { values: { name: label } })}
						title={$_('lists.switcher.more', { values: { name: label } })}
						data-testid="list-switcher-menu"
						data-address={entry.address}
					>
						<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
							<path
								d="M4 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm4.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM14.5 8.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"
							/>
						</svg>
					</summary>
					<div
						class="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border bg-surface p-1 shadow-lg"
					>
						<button
							type="button"
							on:click={(event) => forget(entry.address, event)}
							data-testid="list-switcher-forget"
							data-address={entry.address}
							class="w-full rounded px-2 py-1.5 text-left text-sm text-text hover:bg-surface-2"
						>
							{$_('lists.switcher.forget')}
							<span class="block text-xs text-faint">{$_('lists.switcher.forgetTitle')}</span>
						</button>
					</div>
				</details>
			</li>
		{/each}
	</ul>

	{#if errorMessage}
		<p class="mt-2 text-xs text-red-600" data-testid="list-switcher-error">{errorMessage}</p>
	{/if}
{/if}
