<script>
	// The first block of the consent dialog (escrow01): what this app is for, in
	// one sentence, and the passkey that does all three things it asks of you —
	// signing in, signing, paying. Paying is what the demo is about, so it is the
	// one that stands out.
	//
	// What is kept where used to sit beside this as its own panel. It is part of
	// the statement now, under "All notices", next to the rest of what the app
	// does with data.
	//
	// The payment lines depend on the budget service actually in use. The fake
	// keeps amounts unencrypted in memory, and a consent screen that promised
	// encryption on a testnet it never talks to would be the one sentence here
	// that is false.
	import { _ } from '$lib/i18n/index.js';
	import { technicalView } from './technical-view.js';
	import BudgetIcon from './BudgetIcon.svelte';

	/** Whether budgets are really encrypted on a chain (not the in-memory fake). */
	export let confidential = false;

	$: payText = $technicalView
		? $_('onboarding.payTextTechnical')
		: confidential
			? $_('onboarding.payText')
			: $_('onboarding.payTextDemo');

	/** @type {Array<{ icon: 'key' | 'pen', title: string, text: string }>} */
	$: steps = [
		{ icon: 'key', title: $_('onboarding.signInTitle'), text: $_('onboarding.signInText') },
		{
			icon: 'pen',
			title: $_('onboarding.signTitle'),
			text: $technicalView ? $_('onboarding.signTextTechnical') : $_('onboarding.signText')
		}
	];
</script>

<section data-testid="one-passkey-intro">
	<p class="text-base leading-relaxed text-text" data-testid="consent-promise">
		{confidential ? $_('onboarding.promise') : $_('onboarding.promiseDemo')}
	</p>

	<h3 class="mt-4 mb-2 text-sm font-semibold text-heading">{$_('onboarding.heading')}</h3>
	<div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
		<ul class="flex flex-col justify-center gap-3 rounded-lg border border-border px-3 py-3">
			{#each steps as step (step.icon)}
				<li class="flex items-start gap-3">
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-faint"
					>
						<BudgetIcon name={step.icon} size={18} />
					</span>
					<span>
						<span class="block text-sm font-semibold text-heading">{step.title}</span>
						<span class="block text-xs text-faint">{step.text}</span>
					</span>
				</li>
			{/each}
		</ul>
		<!-- Paying: the step this demo exists to show. -->
		<div
			class="flex items-start gap-3 rounded-lg border border-cyan-300 bg-cyan-50 px-3.5 py-3.5 dark:border-cyan/40 dark:bg-cyan/10"
			data-testid="one-passkey-pay"
		>
			<span
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-800 text-white dark:bg-cyan dark:text-bg"
			>
				<BudgetIcon name="lock" size={22} />
			</span>
			<span>
				<span class="block text-base font-bold text-heading">{$_('onboarding.payTitle')}</span>
				<span class="mt-0.5 block text-sm leading-snug text-text">{payText}</span>
			</span>
		</div>
	</div>
</section>
