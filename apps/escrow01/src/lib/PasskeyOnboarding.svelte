<script>
	// Identity chooser for the onboarding modal: every user decides before the
	// P2P stack starts whether this session uses a passkey-backed DID identity
	// (new or recovered) or an anonymous throwaway identity. The actual WebAuthn
	// calls happen in +page.svelte on proceed — they need the button click's
	// user gesture.
	//
	// Plain words by default; the technical view names WebAuthn, OrbitDB and the
	// DID, as it does everywhere else on the page.
	import { _ } from '$lib/i18n/index.js';
	import { hasStoredPasskeyCredential } from './passkey-identity.js';
	import { technicalView } from './technical-view.js';

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

	const hasStoredPasskey = hasStoredPasskeyCredential();

	/**
	 * The plain sentence, or its technical twin. Both inputs are passed in, so
	 * the options below re-run when either the language or the view changes.
	 *
	 * @param {string} key
	 * @param {boolean} technical
	 * @param {(key: string) => string} format
	 */
	const plainOr = (key, technical, format) => format(technical ? `${key}Technical` : key);

	$: options = [
		{
			value: 'create',
			label: $_('consent.identityCreate'),
			hint: hasStoredPasskey
				? plainOr('consent.identityCreateHintAnother', $technicalView, $_)
				: plainOr('consent.identityCreateHint', $technicalView, $_)
		},
		{
			value: 'existing',
			label: $_('consent.identityExisting'),
			// Since provider 0.8.0 this option really does reach a passkey this
			// browser has never seen: `recoverPasskeyCredential()` uses a stored
			// credential when there is one, and otherwise asks the authenticator
			// itself — two touches, from which the provider derives the DID and
			// the signing key. It fails only on an authenticator that cannot
			// evaluate PRF, which is why the option stays selectable and says so
			// in its hint rather than being disabled.
			hint: hasStoredPasskey
				? $_('consent.identityExistingFound')
				: plainOr('consent.identityExistingNone', $technicalView, $_)
		},
		{
			value: 'anonymous',
			label: $_('consent.identityAnonymous'),
			hint: $_('consent.identityAnonymousHint')
		}
	];
</script>

<fieldset class="rounded-lg border border-border p-3" data-testid="passkey-onboarding">
	<legend class="px-1 text-sm font-semibold text-heading">{$_('consent.identityLegend')}</legend>
	<div class="space-y-2">
		{#each options as option (option.value)}
			<label class="flex cursor-pointer items-start gap-2 text-sm">
				<input
					type="radio"
					name="identity-mode"
					value={option.value}
					bind:group={mode}
					data-testid={`identity-mode-${option.value}`}
					class="mt-0.5"
				/>
				<span>
					<span class="font-medium">{option.label}</span>
					<span class="block text-xs text-faint">{option.hint}</span>
				</span>
			</label>
		{/each}
	</div>

	{#if mode === 'create'}
		<div class="mt-3">
			<input
				type="text"
				bind:value={label}
				placeholder={$_('consent.identityLabelPlaceholder')}
				data-testid="passkey-label"
				class="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
			/>
			<p class="mt-1 text-xs text-faint" data-testid="passkey-label-hint">
				{$_('consent.identityLabelHint')}
			</p>
		</div>
	{/if}
</fieldset>
