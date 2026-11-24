<script>
	/**
	 * The other ways in, as links under the start button (escrow01).
	 *
	 * The identity used to be chosen twice: a link beside "Start", and the same
	 * two choices plus "without a passkey" as radios under "Advanced". Now the
	 * way somebody takes is the choice. A link changes only what the button says
	 * and does; nothing starts until the button is pressed.
	 *
	 * "Create a passkey" is the default, and in memory mode the page cannot tell
	 * a first visit from a return: nothing is kept. Somebody who already has a
	 * passkey for this demo must not create a second identity by pressing the
	 * button, so the other way is right under it.
	 */
	import { _ } from '$lib/i18n/index.js';
	import { hasStoredPasskeyCredential } from './passkey-identity.js';

	/** @type {'create' | 'existing' | 'anonymous'} */
	export let mode = 'create';

	const hasStoredPasskey = hasStoredPasskeyCredential();

	/** @type {Record<'create' | 'existing' | 'anonymous', string>} */
	$: labels = {
		existing: $_('consent.choice.existing'),
		// With a passkey linked here already, a new one is a second identity.
		create: hasStoredPasskey ? $_('consent.choice.createAnother') : $_('consent.choice.create'),
		anonymous: $_('consent.choice.anonymous')
	};

	// The two ways not taken. Without a passkey, the passkey ways come first:
	// they are the ones that lead to a budget.
	/** @type {Array<'create' | 'existing' | 'anonymous'>} */
	$: others =
		mode === 'create'
			? ['existing', 'anonymous']
			: mode === 'existing'
				? ['create', 'anonymous']
				: ['existing', 'create'];
</script>

<div class="flex flex-col items-center text-center" data-testid="consent-choices">
	{#if mode === 'anonymous'}
		<p class="text-xs text-faint" data-testid="consent-anonymous-note">
			{$_('consent.choice.anonymousNote')}
		</p>
	{/if}
	{#each others as other (other)}
		<button
			type="button"
			on:click={() => (mode = other)}
			data-testid={`consent-identity-${other}`}
			class="min-h-9 px-1 py-1.5 text-[13px] text-text underline underline-offset-2 hover:text-heading"
		>
			{labels[other]}
		</button>
	{/each}
</div>
