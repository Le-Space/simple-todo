<script>
	// The Account tab: the passkey's DID, the account on Sepolia, the balance,
	// the chain and the way to the auditor view. Moved out of +page.svelte as it
	// was; the <section> around it stays on the page with the other tabs.
	import { _ } from '$lib/i18n/index.js';
	import { ownDidStore } from '$lib/p2p-stores.js';
	import {
		accountStatusStore,
		balanceStore,
		budgetInfo,
		prepareBudgetAccount
	} from '$lib/budget/budget-store.js';
	import { etherscanAddress } from '$lib/chain/config.js';
	import { technicalView } from '$lib/technical-view.js';
	import DidBadge from '$lib/DidBadge.svelte';
	import BalanceCard from '$lib/budget/BalanceCard.svelte';
	import TechnicalExplanation from '$lib/TechnicalExplanation.svelte';

	/** Whether the balance card is shown; the page decides, since its notices use it too. */
	export let showBalance = false;

	// The starting funds are a sentence about *this* account, so it stops being
	// true the moment the account holds anything -- a recipient's balance comes
	// from a payout, and telling them the first lock will mint them 1,000.00
	// reads as an explanation of the number above it. Unknown counts as empty:
	// before the first read there is nothing to contradict.
	$: showFundingHint = !($balanceStore.state === 'ready' && ($balanceStore.units ?? 0n) > 0n);
</script>

<div
	class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
	data-testid="account-passkey"
>
	<h2 class="text-sm font-medium text-faint">{$_('sections.account.passkey')}</h2>
	{#if $ownDidStore}
		<div class="mt-2 flex flex-wrap">
			<DidBadge did={$ownDidStore} />
		</div>
		<p class="mt-2 text-xs text-faint">{$_('sections.account.passkeyHint')}</p>
	{:else}
		<p class="mt-1 text-sm text-text">{$_('sections.account.noPasskey')}</p>
	{/if}
</div>

{#if budgetInfo.kind === 'zama' && $ownDidStore}
	<div
		class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
		data-testid="account-chain-account"
		data-phase={$accountStatusStore.phase}
	>
		<h2 class="text-sm font-medium text-faint">{$_('sections.account.chainAccount')}</h2>
		{#if $accountStatusStore.phase === 'ready' && $accountStatusStore.address}
			<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<code class="font-mono text-xs break-all text-heading" data-testid="chain-account-address"
					>{$accountStatusStore.address}</code
				>
				<a
					href={etherscanAddress($accountStatusStore.address)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-xs font-medium text-cyan-800 underline-offset-2 hover:underline dark:text-cyan"
					>{$_('sections.account.viewOnEtherscan')}</a
				>
			</p>
			<p class="mt-2 text-xs text-faint">
				{$_('sections.account.accountHint')}
				{#if showFundingHint}
					<span data-testid="account-funding-hint">{$_('sections.account.accountFunding')}</span>
				{/if}
			</p>
			<p class="mt-1 text-xs text-faint" data-testid="account-etherscan-hint">
				{$_('sections.account.etherscanHint')}
			</p>
		{:else if $accountStatusStore.phase === 'not-found'}
			<!-- An earlier passkey whose published profile did not arrive in
			     time: an account may exist, so the app asks rather than
			     creating a second one (budget-service-zama.js, ensureAccount). -->
			<p class="mt-1 text-sm text-text" data-testid="chain-account-not-found">
				{$_('sections.account.accountNotFound')}
			</p>
			{#if $technicalView}
				<p class="mt-2 text-xs text-faint">{$_('sections.account.accountNotFoundTechnical')}</p>
			{/if}
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					on:click={() => void prepareBudgetAccount({ intent: 'search' })}
					class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:text-heading"
					data-testid="chain-account-search">{$_('sections.account.accountSearch')}</button
				>
				<button
					type="button"
					on:click={() => void prepareBudgetAccount({ intent: 'create' })}
					class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:text-heading"
					data-testid="chain-account-create">{$_('sections.account.accountCreate')}</button
				>
			</div>
			<p class="mt-2 text-xs text-faint">{$_('sections.account.accountCreateHint')}</p>
		{:else if $accountStatusStore.phase === 'failed'}
			<p class="mt-1 text-sm text-danger-700 dark:text-danger" role="alert">
				{$_('sections.account.accountFailed', {
					values: { reason: $accountStatusStore.error ?? '' }
				})}
			</p>
			<button
				type="button"
				on:click={() => void prepareBudgetAccount()}
				class="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:text-heading"
				data-testid="chain-account-retry">{$_('sections.account.accountRetry')}</button
			>
		{:else}
			<p class="mt-1 flex items-center gap-2 text-sm text-text">
				<span
					class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border border-t-cyan-700 dark:border-t-cyan"
					aria-hidden="true"
				></span>
				{$_('sections.account.accountCreating')}
			</p>
		{/if}
	</div>
{/if}

<!-- The balance appears where the storyboard has it: once a budget was paid
     out to this session. -->
{#if showBalance}
	<BalanceCard />
{:else}
	<div
		class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
		data-testid="account-balance-waiting"
	>
		<h2 class="text-sm font-medium text-faint">{$_('budget.balance.heading')}</h2>
		<p class="mt-1 text-sm text-text">
			{$_(
				budgetInfo.kind === 'zama'
					? 'sections.account.balanceAfterAccount'
					: 'sections.account.balanceWaiting'
			)}
		</p>
	</div>
{/if}

<div
	class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
	data-testid="account-chain"
>
	<h2 class="text-sm font-medium text-faint">{$_('sections.account.chain')}</h2>
	<span
		class="mt-2 inline-block rounded-md border px-2 py-1 text-xs font-medium {budgetInfo.network ===
		'demo'
			? 'border-data-400 bg-data-100 text-data-800 dark:border-data/40 dark:bg-data/10 dark:text-data'
			: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan/40 dark:bg-cyan/10 dark:text-cyan'}"
		data-testid="budget-network"
		data-network={budgetInfo.network}
		>{budgetInfo.network === 'demo'
			? $_('budget.network.demo')
			: $_('budget.network.sepolia')}</span
	>
	<!-- What "Demo ohne Chain" means, and the real run it stands in for. -->
	{#if budgetInfo.network === 'demo'}
		<p class="mt-2 text-sm text-text">{$_('budget.network.demoTitle')}</p>
		<TechnicalExplanation step="demo" collapsible className="mt-3" />
	{/if}
</div>

<div
	class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
	data-testid="account-auditor"
>
	<h2 class="text-sm font-medium text-faint">{$_('sections.account.auditor')}</h2>
	<p class="mt-1 text-sm text-text">{$_('sections.account.auditorHint')}</p>
	<a
		href="#pruefstelle"
		data-testid="auditor-view-open"
		class="mt-3 inline-block rounded-md border border-cyan-200 px-3 py-1.5 text-sm font-medium text-cyan-800 no-underline hover:bg-cyan-50 dark:border-cyan/40 dark:text-cyan dark:hover:bg-cyan/10"
		>{$_('sections.account.auditorOpen')}</a
	>
</div>
