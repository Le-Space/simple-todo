<script>
	/**
	 * The other ways in, as links under the start button of the consent
	 * dialog's short form (escrow01 first, then every chapter with a passkey).
	 *
	 * The identity used to be chosen twice: a link beside "Start", and the same
	 * two choices plus "without a passkey" as radios under "Advanced". Now the
	 * way somebody takes is the choice. A link changes only what the button says
	 * and does; nothing starts until the button is pressed.
	 *
	 * "Create a passkey" is the default, and in memory mode the page cannot tell
	 * a first visit from a return: nothing is kept. Somebody who already has a
	 * passkey must not create a second identity by pressing the button, so the
	 * other way is right under it.
	 *
	 * The wording is the shared `ui.consent.choice.*`; a chapter rewords a link
	 * with its own `consent.choice.*` (escrow01: "no budget then"), and adds a
	 * note under the links for the way without a passkey with
	 * `consent.choice.anonymousNote`, where that way costs something.
	 */
	import { t } from './i18n.js';

	/** @type {'create' | 'existing' | 'anonymous'} */
	export let mode = 'create';
	/**
	 * Whether this browser keeps a passkey already. Then a new one is a second
	 * identity, and the link says so. The chapter's, because only the chapter
	 * knows where it keeps its credential.
	 */
	export let hasStoredPasskey = false;

	/**
	 * The chapter's wording where it has one, the shared one otherwise.
	 *
	 * @param {string} key
	 * @param {string} english
	 */
	$: say = (key, english) => $t(`consent.choice.${key}`, $t(`ui.consent.choice.${key}`, english));

	/** @type {Record<'create' | 'existing' | 'anonymous', string>} */
	$: labels = {
		existing: say('existing', 'Already have a passkey? Sign in with it'),
		// With a passkey kept here already, a new one is a second identity.
		create: hasStoredPasskey
			? say('createAnother', 'Create another passkey – a second identity')
			: say('create', 'Create a new passkey'),
		anonymous: say('anonymous', 'Continue without a passkey')
	};
	$: anonymousNote = $t('consent.choice.anonymousNote', '');

	// The two ways not taken. Without a passkey, the passkey ways come first:
	// they are the ones that lead to an identity that comes back.
	/** @type {Array<'create' | 'existing' | 'anonymous'>} */
	$: others =
		mode === 'create'
			? ['existing', 'anonymous']
			: mode === 'existing'
				? ['create', 'anonymous']
				: ['existing', 'create'];
</script>

<div class="flex flex-col items-center text-center" data-testid="consent-choices">
	{#if mode === 'anonymous' && anonymousNote}
		<p class="text-faint text-xs" data-testid="consent-anonymous-note">
			{anonymousNote}
		</p>
	{/if}
	{#each others as other (other)}
		<button
			type="button"
			on:click={() => (mode = other)}
			data-testid={`consent-identity-${other}`}
			class="text-text hover:text-heading min-h-9 px-1 py-1.5 text-[13px] underline underline-offset-2"
		>
			{labels[other]}
		</button>
	{/each}
</div>
