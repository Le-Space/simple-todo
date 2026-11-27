<script>
	/**
	 * Who can write to the open list, inside "This list" (escrow01, #127 PR C).
	 *
	 * Backed by OrbitDBAccessController: grants and removals change the
	 * controller's own replicated store, so the list's address never changes
	 * and peers see a change live (list-access.js reads it).
	 *
	 * The owner is listed first, as "owner", and never with a Remove button: the
	 * panel used to list only the granted DIDs, so an owner looked at her own
	 * list and found nobody in it. Only the owner may grant, so only she gets
	 * the field; everybody else reads the list, folded.
	 */
	import { _ } from '$lib/i18n/index.js';
	import { giveWriterKeys, rotateKeysWithout, todoDBStore } from './db-actions.js';
	import { listAccessStore, listRoleStore, refreshListAccess } from './list-access.js';
	// From p2p-stores.js, not p2p.js: this panel loads with the page, and a
	// static import of p2p.js pulls libp2p and gossipsub into the bundle the
	// consent dialog waits for, even though the page loads p2p.js lazily.
	import { ownDidStore } from './p2p-stores.js';

	let newDid = '';
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** A note after a grant or a removal in a sealed list (#127). @type {string | null} */
	let keyNote = null;

	$: access = $listAccessStore;
	$: owner = $listRoleStore === 'owner';
	$: count = access.admins.length + access.writers.length;

	/** @param {string} did */
	const short = (did) => (did.length > 30 ? `${did.slice(0, 18)}…${did.slice(-8)}` : did);

	async function grant() {
		const did = newDid.trim();
		if (!did) return;
		busy = true;
		errorMessage = null;
		keyNote = null;
		try {
			await /** @type {any} */ ($todoDBStore).access.grant('write', did);
			newDid = '';
			await refreshListAccess();
			// #127: in a sealed list, write access is no use without the keys.
			if ((await giveWriterKeys(did)) === 'no-public-key') {
				keyNote = $_('lists.permissions.keysLater');
			}
		} catch (error) {
			errorMessage = $_('lists.permissions.grantFailed', {
				values: { reason: error instanceof Error ? error.message : String(error) }
			});
		} finally {
			busy = false;
		}
	}

	/** @param {string} did */
	async function revoke(did) {
		busy = true;
		errorMessage = null;
		keyNote = null;
		try {
			await /** @type {any} */ ($todoDBStore).access.revoke('write', did);
			await refreshListAccess();
			// #127: new keys from here on, which the removed writer does not get.
			const rotated = await rotateKeysWithout(did);
			if (rotated !== 'not-sealed') keyNote = $_('lists.permissions.keysRenewed');
		} catch (error) {
			errorMessage = $_('lists.permissions.revokeFailed', {
				values: { reason: error instanceof Error ? error.message : String(error) }
			});
		} finally {
			busy = false;
		}
	}
</script>

{#if access.canGrant}
	<!-- Open for the owner, whose field this is; folded for everyone else. -->
	<details
		class="group mt-4 border-t border-border pt-3"
		open={owner || undefined}
		data-testid="permissions-panel"
		data-role={$listRoleStore ?? ''}
	>
		<summary
			class="flex cursor-pointer list-none items-center gap-2 rounded text-sm font-medium text-heading outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 [&::-webkit-details-marker]:hidden"
		>
			<svg
				class="h-3.5 w-3.5 text-faint transition-transform group-open:rotate-90"
				viewBox="0 0 20 20"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					fill-rule="evenodd"
					d="M7.2 4.7a1 1 0 011.4 0l4.6 4.6a1 1 0 010 1.4l-4.6 4.6a1 1 0 11-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 010-1.4z"
					clip-rule="evenodd"
				/>
			</svg>
			{$_('lists.permissions.heading', { values: { count } })}
		</summary>

		<p class="mt-2 text-xs text-faint">
			{owner ? $_('lists.permissions.hint') : $_('lists.permissions.hintOthers')}
		</p>

		<ul class="mt-2 divide-y divide-border">
			{#each access.admins as did (did)}
				<li
					class="flex min-h-9 items-center gap-2 py-1.5 text-xs"
					data-testid="permission-owner"
					data-did={did}
				>
					<code class="min-w-0 truncate font-mono text-text" title={did}>{short(did)}</code>
					<span class="shrink-0 text-faint">{$_('lists.permissions.owner')}</span>
					{#if did === $ownDidStore}<span class="shrink-0 text-faint"
							>{$_('lists.permissions.you')}</span
						>{/if}
				</li>
			{/each}
			{#each access.writers as did (did)}
				<li
					class="flex min-h-9 items-center gap-2 py-1.5 text-xs"
					data-testid="permission-entry"
					data-did={did}
				>
					<code class="min-w-0 truncate font-mono text-text" title={did}>{short(did)}</code>
					{#if did === $ownDidStore}<span class="shrink-0 text-faint"
							>{$_('lists.permissions.you')}</span
						>{/if}
					{#if owner}
						<button
							type="button"
							on:click={() => revoke(did)}
							disabled={busy}
							class="ml-auto shrink-0 rounded-md border border-border px-2 py-1 text-xs text-text hover:border-red-300 hover:text-red-700 disabled:opacity-50 dark:hover:text-red-400"
							data-testid="permission-revoke"
						>
							{$_('lists.permissions.remove')}
						</button>
					{/if}
				</li>
			{/each}
		</ul>

		{#if owner}
			<form class="mt-2 flex gap-2" on:submit|preventDefault={grant}>
				<input
					type="text"
					bind:value={newDid}
					placeholder={$_('lists.permissions.placeholder')}
					aria-label={$_('lists.permissions.placeholder')}
					data-testid="permission-did-input"
					class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs"
				/>
				<button
					type="submit"
					disabled={busy || !newDid.trim()}
					data-testid="permission-add"
					class="shrink-0 rounded-md border border-cyan-600 px-3 py-1.5 text-xs font-medium text-cyan-800 hover:bg-cyan-50 disabled:border-border disabled:text-faint dark:border-cyan dark:text-cyan dark:hover:bg-cyan/10"
				>
					{$_('lists.permissions.add')}
				</button>
			</form>
		{/if}

		{#if errorMessage}
			<p class="mt-2 text-xs text-red-600" data-testid="permission-error">{errorMessage}</p>
		{/if}
		{#if keyNote}
			<p class="mt-2 text-xs text-faint" data-testid="permission-key-note">{keyNote}</p>
		{/if}
	</details>
{/if}
