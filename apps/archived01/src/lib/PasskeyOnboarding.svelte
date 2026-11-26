<script>
	// The new passkey's name, on the start dialog's second screen ("Notices and
	// settings"). Which way somebody takes -- a new passkey, an existing one, or
	// none -- is the button and the links under it (`StartChoices`). The
	// WebAuthn calls happen in +page.svelte on the button's press -- they need
	// its user gesture.
	import { _ } from '$lib/i18n/index.js';

	/** @type {'create' | 'existing' | 'anonymous'} */
	export let mode = 'anonymous';

	// One field, because there is only one thing to say. WebAuthn takes a
	// `user.name` and a `displayName`, but both are labels for the credential
	// picker — neither identifies the passkey. What identifies it is the user
	// handle, which the identity provider now generates as 64 random bytes
	// instead of deriving it from the text typed here
	// (Le-Space/orbitdb-identity-provider-webauthn-did#45). Asking twice for a
	// label suggested the first one meant something.
	export let label = '';
</script>

{#if mode === 'create'}
	<label class="block rounded-lg border border-border p-3 text-sm" data-testid="passkey-onboarding">
		<span class="block font-medium text-heading">{$_('consent.identityLabelTitle')}</span>
		<input
			type="text"
			bind:value={label}
			placeholder={$_('consent.identityLabelPlaceholder')}
			data-testid="passkey-label"
			class="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-sm"
		/>
		<span class="mt-1 block text-xs text-faint" data-testid="passkey-label-hint">
			{$_('consent.identityLabelHint')}
		</span>
	</label>
{/if}
