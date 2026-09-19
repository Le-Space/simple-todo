<script>
	import { createEventDispatcher } from 'svelte';

	export let mnemonic = '';
	export let databaseAddress = '';
	export let embedded = false;
	/**
	 * Which list is actually open. The summary used to be hard-wired to
	 * "Shared list" and the shared mnemonic, so after creating a private list the
	 * header kept advertising a list the user was no longer writing to (#114).
	 * @type {{ kind: 'shared' | 'private' | 'guest', name: string }}
	 */
	export let activeList = { kind: 'shared', name: '' };

	const LABELS = { shared: 'Shared list', private: 'Private list', guest: 'Opened list' };
	$: heading = LABELS[activeList?.kind] ?? LABELS.shared;
	$: subtitle = activeList?.kind === 'shared' ? mnemonic : activeList?.name;

	let copied = false;
	const dispatch = createEventDispatcher();

	async function copyMnemonic() {
		if (!mnemonic) return;
		await navigator.clipboard.writeText(mnemonic);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<details
	class="group"
	class:mb-6={!embedded}
	class:rounded-lg={!embedded}
	class:border={!embedded}
	class:border-border={true}
	class:bg-surface={!embedded}
	class:px-4={!embedded}
	class:py-3={!embedded}
	class:shadow-sm={!embedded}
	class:border-t={embedded}
	class:pt-2={embedded}
	data-testid="shared-list-details"
>
	<summary
		class="text-text hover:text-heading flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 [&::-webkit-details-marker]:hidden"
	>
		<svg
			class="h-3.5 w-3.5 transition-transform group-open:rotate-90"
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
		<span data-testid="active-list-kind">{heading}</span>
		{#if subtitle}
			<code
				class="text-faint hidden min-w-0 truncate font-mono font-normal sm:inline"
				data-testid="active-list-label">· {subtitle}</code
			>
		{/if}
	</summary>
	<div class="border-border mt-3 border-t pt-3">
		{#if activeList?.kind !== 'shared'}
			<p class="text-data-700 mb-2 text-xs" data-testid="active-list-note">
				You are writing to <strong>{activeList.name}</strong>. The mnemonic below still refers to
				the public shared list.
			</p>
		{/if}
		<p class="text-faint text-xs">Public mnemonic / OrbitDB database name</p>
		<div class="dark:bg-cyan/10 mt-1 flex items-center gap-2 rounded-md bg-cyan-50 p-2">
			<code class="min-w-0 flex-1 break-all font-mono text-xs" data-testid="active-shared-list-name"
				>{mnemonic}</code
			>
			<button
				type="button"
				on:click={copyMnemonic}
				class="bg-surface dark:border-cyan/30 rounded border border-cyan-200 px-2 py-1 text-xs"
			>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>
		{#if databaseAddress}
			<p class="text-faint mt-2 text-xs">OrbitDB address</p>
			<code
				class="text-text mt-1 block break-all font-mono text-[11px]"
				data-testid="active-database-address">{databaseAddress}</code
			>
		{/if}
		<p class="text-data-700 mt-2 text-xs">
			Anyone who knows this share code can open the same public database and edit it once connected.
		</p>
		<p class="text-faint mt-1 text-xs">
			The mnemonic selects the same database. Live replication also requires a connection to another
			browser peer.
		</p>
		<button
			type="button"
			on:click={() => dispatch('change')}
			class="mt-3 text-xs font-medium text-cyan-700 underline"
		>
			Open another shared list
		</button>
	</div>
</details>
