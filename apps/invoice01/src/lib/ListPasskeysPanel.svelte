<script>
	// The passkeys of these lists (invoice01, list-vault.js): which ones open the
	// vault, one more to add, one to take out. A second passkey is what keeps
	// sealed lists readable when the first is lost — the backup key in the
	// drawer. It reads; it writes once its DID is granted in the panel below.
	import { _ } from '$lib/i18n/index.js';
	import { getPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
	import { orbitdbStore } from './db-actions.js';
	import { listRegistryAddress, openListRegistry } from './list-registry.js';
	import {
		addListPasskey,
		isVaultOpen,
		listVaultStore,
		openListVault,
		removeListPasskey
	} from './list-vault.js';
	import { passkeyCredentialStore } from './p2p-stores.js';

	let label = $_('lists.passkeys.labelDefault');
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ label: string, did: string } | null} */
	let added = null;
	let copied = false;

	// A slot kept only for this tab would be gone before the second key is ever
	// needed, so in memory mode there is nothing to add it to.
	const keeps = getPersistentStorageEnabled();

	$: hasPasskey = Boolean($passkeyCredentialStore?.rawCredentialId);

	/** @param {unknown} error */
	function reasonOf(error) {
		const code = /** @type {any} */ (error)?.code;
		if (code === 'VAULT_SLOT_EXISTS') return $_('lists.passkeys.alreadyThere');
		if (code === 'VAULT_SLOT_IN_USE') return $_('lists.passkeys.cannotRemoveOwn');
		return error instanceof Error ? error.message : String(error);
	}

	async function add() {
		busy = true;
		errorMessage = null;
		added = null;
		try {
			const name = label.trim() || $_('lists.passkeys.labelDefault');
			if (!isVaultOpen()) {
				// The first vault names the registry, so the new passkey finds the
				// lists; it is open already unless something went wrong at the start.
				if ($orbitdbStore) await openListRegistry($orbitdbStore);
				await openListVault({ registry: listRegistryAddress() });
			}
			const { createAdditionalPasskey, didOfCredential } = await import('./passkey-identity.js');
			const credential = await addListPasskey(createAdditionalPasskey, name);
			added = { label: name, did: await didOfCredential(credential) };
		} catch (error) {
			errorMessage = $_('lists.passkeys.addFailed', { values: { reason: reasonOf(error) } });
		} finally {
			busy = false;
		}
	}

	/** @param {string} kid */
	async function remove(kid) {
		busy = true;
		errorMessage = null;
		try {
			await removeListPasskey(kid);
		} catch (error) {
			errorMessage = $_('lists.passkeys.removeFailed', { values: { reason: reasonOf(error) } });
		} finally {
			busy = false;
		}
	}

	async function copyDid() {
		if (!added) return;
		await navigator.clipboard.writeText(added.did);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	/** @param {string} iso */
	const day = (iso) => (iso ? iso.slice(0, 10) : '');
</script>

{#if hasPasskey}
	<section
		class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
		data-testid="list-passkeys"
	>
		<h2 class="text-lg font-semibold text-heading">{$_('lists.passkeys.heading')}</h2>
		<p class="mt-1 text-xs text-faint">{$_('lists.passkeys.hint')}</p>

		{#if $listVaultStore}
			<ul class="mt-3 space-y-1" data-testid="list-passkeys-slots">
				{#each $listVaultStore.slots as slot (slot.kid)}
					<li
						class="flex items-center justify-between gap-2 text-xs"
						data-testid="list-passkey"
						data-kid={slot.kid}
					>
						<span class="min-w-0 truncate">
							<span class="font-medium text-heading"
								>{slot.label || $_('lists.passkeys.unnamed')}</span
							>
							<span class="text-faint">{day(slot.addedAt)}</span>
							{#if slot.mine}<span class="text-emerald-600 dark:text-emerald-400">
									{$_('lists.passkeys.thisOne')}</span
								>{/if}
						</span>
						{#if !slot.mine}
							<button
								type="button"
								on:click={() => remove(slot.kid)}
								disabled={busy}
								class="rounded border border-red-300 px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
								data-testid="list-passkey-remove"
							>
								{$_('lists.passkeys.remove')}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-3 text-xs text-faint" data-testid="list-passkeys-none">
				{$_('lists.passkeys.none')}
			</p>
		{/if}

		{#if keeps}
			<div class="mt-3 flex gap-2">
				<input
					type="text"
					bind:value={label}
					placeholder={$_('lists.passkeys.labelPlaceholder')}
					data-testid="list-passkey-label"
					class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs"
				/>
				<button
					type="button"
					on:click={add}
					disabled={busy}
					data-testid="list-passkey-add"
					class="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
				>
					{busy ? $_('lists.passkeys.busy') : $_('lists.passkeys.add')}
				</button>
			</div>
			<p class="mt-1 text-xs text-faint">{$_('lists.passkeys.addHint')}</p>
		{:else}
			<p class="mt-3 text-xs text-faint" data-testid="list-passkeys-memory">
				{$_('lists.passkeys.memoryMode')}
			</p>
		{/if}

		{#if added}
			<div
				class="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950"
				data-testid="list-passkey-added"
			>
				<p class="text-xs text-heading">
					{$_('lists.passkeys.added', { values: { label: added.label } })}
				</p>
				<div class="mt-1 flex items-center gap-2">
					<code
						class="min-w-0 flex-1 font-mono text-xs break-all"
						data-testid="list-passkey-added-did">{added.did}</code
					>
					<button
						type="button"
						on:click={copyDid}
						class="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
					>
						{copied ? $_('lists.create.copied') : $_('lists.create.copy')}
					</button>
				</div>
			</div>
		{/if}

		{#if errorMessage}
			<p class="mt-2 text-xs text-red-600" data-testid="list-passkeys-error">{errorMessage}</p>
		{/if}
	</section>
{/if}
