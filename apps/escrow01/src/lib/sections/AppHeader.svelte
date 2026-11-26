<script>
	// The page header, moved out of +page.svelte as it was.
	import { _ } from '$lib/i18n/index.js';
	import { budgetInfo } from '$lib/budget/budget-store.js';
	import { shortId } from '@simple-todo/todo/utils.js';
	import LocalFirstLink from '@simple-todo/ui/LocalFirstLink.svelte';
	import LanguageSwitcher from '@simple-todo/ui/LanguageSwitcher.svelte';
	import PageQr from '@simple-todo/ui/PageQr.svelte';
	import DelegatedAuthBadge from '$lib/DelegatedAuthBadge.svelte';
	import DidBadge from '$lib/DidBadge.svelte';
	import NetworkStatusDot from '$lib/NetworkStatusDot.svelte';
	import HeaderDid from '$lib/HeaderDid.svelte';
	import DemoVideoButton from '$lib/DemoVideoButton.svelte';
	import TechnicalToggle from '$lib/TechnicalToggle.svelte';

	/** Whether the auditor view is open: the header then names it. */
	export let auditorOpen = false;
</script>

<!--
	What stays on screen on every tab: the app, the network's state as a dot
	(a link to the network tab), the language and the technical view — the
	switches somebody presenting reaches for while they talk — and, once there
	is a passkey identity, its DID, copied by a click.

	A grid, so a phone gets two short rows instead of three wrapped ones: the
	title and the switches on the first, the state on the second. From `sm` on,
	all three share one row.

	In that row the title is sized first and the state takes what is left,
	wrapping onto a second line inside its column when it has to. The other way
	round, the state's badges took the row and cut the title down to "A…" in
	the auditor view and to "Confidential esc…" beside "Release confirmed" --
	at every desktop width, since the page is never wider than 56rem. The
	state's column keeps at least its widest badge, so nothing in it overlaps.
-->
<header
	class="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:mb-6 sm:grid-cols-[minmax(0,max-content)_minmax(min-content,1fr)_auto]"
>
	<div class="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
		<LocalFirstLink size={44} />
		<!-- `flex-1`: as wide as the title's column, so the line under the title
		     wraps there, not at the width of a short title. -->
		<div class="min-w-0 flex-1">
			{#if auditorOpen}
				<!-- Short below `md`, as the app's own name is: beside the switches on a
				     phone, "Auditor view" lost its last letters. -->
				<h1
					class="truncate text-xl font-bold text-heading md:text-3xl"
					aria-label={$_('budget.auditor.title')}
				>
					<span class="md:hidden" aria-hidden="true">{$_('budget.auditor.titleShort')}</span>
					<span class="hidden md:inline" aria-hidden="true">{$_('budget.auditor.title')}</span>
				</h1>
				<!-- Wraps to the title's width rather than widening the title's column. -->
				<p class="mt-1 text-sm text-faint [contain:inline-size]">
					{$_('budget.auditor.escrow')}
					<code class="font-mono text-xs" title={budgetInfo.escrow}
						>{shortId(budgetInfo.escrow)}</code
					>
				</p>
			{:else}
				<!-- The full name from `md` on; below it the switches and the state beside
				     it leave room for one word (at 700px "Confidential esc…"). The
				     heading's accessible name stays the full one. -->
				<h1
					class="truncate text-xl font-bold text-heading md:text-3xl"
					aria-label={$_('header.title')}
				>
					<span class="md:hidden" aria-hidden="true">{$_('header.titleShort')}</span>
					<span class="hidden md:inline" aria-hidden="true">{$_('header.title')}</span>
				</h1>
				<!-- On a phone the list's name is the better use of the line. -->
				<!-- Wraps to the title's width rather than widening the title's column. -->
				<p
					class="mt-0.5 hidden text-sm text-faint [contain:inline-size] sm:block"
					data-testid="app-tagline"
				>
					{$_('header.tagline')}
				</p>
			{/if}
		</div>
	</div>
	<div
		class="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end"
	>
		<DelegatedAuthBadge />
		{#if auditorOpen}
			<DidBadge did={budgetInfo.auditor} label={$_('budget.auditor.role')} />
			<a
				href="#aufgaben"
				data-testid="auditor-view-close"
				class="rounded-md px-2 py-1 text-xs font-medium text-cyan-800 no-underline hover:underline dark:text-cyan"
				>{$_('header.backToTodos')}</a
			>
		{/if}
		<NetworkStatusDot />
		<!-- This session's DID, on a phone; from `sm` on it sits under the
		     switches (HeaderDid.svelte says why). The auditor view names the
		     auditor's instead. -->
		{#if !auditorOpen}
			<HeaderDid placement="row" />
		{/if}
		<!-- Here rather than beside the switches: on a phone this group has a row of
		     its own, and beside them it cut the German title down to "Treuh…". -->
		<DemoVideoButton variant="link" />
	</div>
	<div class="col-start-2 row-start-1 flex flex-col items-end gap-1.5 sm:col-start-3">
		<div class="flex items-center gap-1 sm:gap-2">
			<LanguageSwitcher />
			<PageQr />
			<TechnicalToggle />
		</div>
		{#if !auditorOpen}
			<HeaderDid placement="corner" />
		{/if}
	</div>
</header>
