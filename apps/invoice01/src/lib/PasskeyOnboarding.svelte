<script>
	// The passkey's details, on the start dialog's second screen ("Notices and
	// settings"). Which way somebody takes -- a new passkey, an existing one, or
	// none -- is the button and the links under it (`StartChoices`); what is
	// left to set is here: the new passkey's name, and for an existing one,
	// whether to ask the authenticator past the one this browser keeps. The
	// WebAuthn calls happen in +page.svelte on the button's press -- they need
	// its user gesture.
	import { _ } from '$lib/i18n/index.js';
	import { hasStoredPasskeyCredential } from './passkey-identity.js';

	/** @type {'create' | 'existing' | 'anonymous'} */
	export let mode = 'create';

	// One field, because there is only one thing to say. WebAuthn takes a
	// `user.name` and a `displayName`, but both are labels for the credential
	// picker — neither identifies the passkey. What identifies it is the user
	// handle, which the identity provider now generates as 64 random bytes
	// instead of deriving it from the text typed here
	// (Le-Space/orbitdb-identity-provider-webauthn-did#45). Asking twice for a
	// label suggested the first one meant something.
	export let label = '';

	// invoice01: the stored passkey is the one this browser starts with, and a
	// second passkey of its lists (list-vault.js) has to get past it. Ticked, the
	// authenticator is asked which passkey it holds -- two touches, as on a
	// device that kept nothing.
	export let askAuthenticator = false;

	const hasStoredPasskey = hasStoredPasskeyCredential();
</script>

{#if mode === 'create' || (mode === 'existing' && hasStoredPasskey)}
	<div class="rounded-lg border border-border p-3" data-testid="passkey-onboarding">
		{#if mode === 'create'}
			<label class="block text-sm">
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
		{:else}
			<label class="flex cursor-pointer items-start gap-2 text-sm">
				<input
					type="checkbox"
					bind:checked={askAuthenticator}
					data-testid="passkey-ask-authenticator"
					class="mt-0.5"
				/>
				<span>
					<span class="font-medium text-heading">{$_('consent.identityAnother')}</span>
					<span class="block text-xs text-faint">{$_('consent.identityAnotherHint')}</span>
				</span>
			</label>
		{/if}
	</div>
{/if}
