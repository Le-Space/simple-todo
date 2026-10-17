<script>
	// Seal the list with a key from the passkey (list-sealing.js). A choice on
	// the consent screen, next to the identity it depends on: without a passkey
	// there is no key, and the box says so instead of pretending.
	import { _ } from '$lib/i18n/index.js';
	import { setSealListEnabled } from '$lib/list-sealing.js';

	/** The remembered choice; the page binds it so the statement follows it. */
	export let enabled = true;
	/** Whether the identity chosen above is a passkey. */
	export let passkey = false;

	const onChange = () => setSealListEnabled(enabled);
</script>

<fieldset class="mt-4 rounded-md border border-border p-3 text-sm" data-testid="seal-list-fieldset">
	<legend class="px-1 font-medium">{$_('sealList.title')}</legend>
	<label class="flex items-start gap-2">
		<input
			type="checkbox"
			class="mt-1"
			bind:checked={enabled}
			on:change={onChange}
			disabled={!passkey}
			data-testid="seal-list"
		/>
		<span>
			{$_('sealList.label')}
			<span class="block text-xs text-faint">
				{passkey ? $_('sealList.hint') : $_('sealList.needsPasskey')}
			</span>
		</span>
	</label>
</fieldset>
