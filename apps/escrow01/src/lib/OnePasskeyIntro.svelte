<script>
	// The first block of the start dialog (escrow01): what this app is for, in
	// one sentence, and the passkey that does all three things it asks of you —
	// signing in, signing, paying — as one row of chips. Paying is what the demo
	// is about, so it is the chip that stands out.
	//
	// It used to be two boxes with a sentence per verb, and "the amount stays
	// encrypted" stood three times on one screen: in the promise, in the pay box
	// and in the first sentence about the data. The promise says it once now,
	// and the sentences about the data follow under these chips.
	//
	// The payment words depend on the budget service actually in use. The fake
	// keeps amounts unencrypted in memory, and a start screen that promised
	// encryption on a testnet it never talks to would be the one sentence here
	// that is false.
	import { _ } from '$lib/i18n/index.js';
	import { technicalView } from './technical-view.js';
	import BudgetIcon from './BudgetIcon.svelte';

	/** Whether budgets are really encrypted on a chain (not the in-memory fake). */
	export let confidential = false;

	/** @type {Array<{ icon: 'key' | 'pen' | 'lock', title: string, pay?: boolean }>} */
	$: chips = [
		{ icon: 'key', title: $_('onboarding.signInTitle') },
		{ icon: 'pen', title: $_('onboarding.signTitle') },
		{ icon: 'lock', title: $_('onboarding.payTitle'), pay: true }
	];
</script>

<section data-testid="one-passkey-intro">
	<p class="text-base leading-relaxed text-text" data-testid="consent-promise">
		{confidential ? $_('onboarding.promise') : $_('onboarding.promiseDemo')}
	</p>

	<!-- One row on a phone too: the German "Unterschreiben" is the long one. -->
	<ul class="mt-3 flex flex-wrap items-center gap-1 sm:gap-2">
		{#each chips as chip (chip.icon)}
			<li
				class="inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-1 text-xs font-semibold text-heading sm:gap-1.5 sm:pr-2.5 sm:pl-1.5 sm:text-[13px] {chip.pay
					? 'border-cyan-300 bg-cyan-50 dark:border-cyan/40 dark:bg-cyan/10'
					: 'border-border bg-surface-2'}"
				data-testid={chip.pay ? 'one-passkey-pay' : undefined}
			>
				<span class={chip.pay ? 'text-cyan-800 dark:text-cyan' : 'text-faint'}>
					<BudgetIcon name={chip.icon} size={16} />
				</span>
				{chip.title}
			</li>
		{/each}
	</ul>
	<p class="mt-1.5 text-[13px] text-faint" data-testid="one-passkey-note">
		{$technicalView ? $_('onboarding.chipNoteTechnical') : $_('onboarding.chipNote')}
	</p>
</section>
