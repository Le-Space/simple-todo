<script>
	/**
	 * Whether this browser joins the peer-to-peer network at all.
	 *
	 * Next to the storage choice in the consent dialog, and for the same
	 * reason: the node is built from it. Off, nothing leaves the device and
	 * nothing arrives from a peer — the way to see what an archive alone gives
	 * back, and what somebody on a metered or hostile network may want.
	 *
	 * The strings come through the translator registry, so a chapter that has
	 * the keys shows its own wording and one that does not shows the English
	 * written here — see `i18n.js`.
	 */
	import { t } from './i18n.js';
	import { getP2PEnabled, setP2PEnabled } from '@simple-todo/todo/p2p-mode.js';

	/** Exposed so the page can say what the choice means before the start. */
	export let enabled = getP2PEnabled();

	// Written when somebody chooses, not when the dialog is merely shown — the
	// dialog's one promise is that nothing is written before anybody agreed.
	let chosen = false;
	$: if (chosen) setP2PEnabled(enabled);
</script>

<fieldset class="border-border mb-4 rounded-md border p-3" data-testid="p2p-mode">
	<legend class="text-heading px-1 text-xs font-medium"
		>{$t('consent.p2pLegend', 'Peer-to-peer network')}</legend
	>

	<label class="flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="radio"
			bind:group={enabled}
			value={true}
			on:change={() => (chosen = true)}
			data-testid="p2p-mode-on"
			class="mt-1"
		/>
		<span>
			<span class="text-text">{$t('consent.p2pOnLabel', 'On')}</span>
			<span class="text-faint mt-0.5 block text-xs">
				{$t(
					'consent.p2pOnHint',
					'This browser connects to a relay and to other devices, and the list replicates between them.'
				)}
			</span>
		</span>
	</label>

	<label class="mt-2 flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="radio"
			bind:group={enabled}
			value={false}
			on:change={() => (chosen = true)}
			data-testid="p2p-mode-off"
			class="mt-1"
		/>
		<span>
			<span class="text-text">{$t('consent.p2pOffLabel', 'Off')}</span>
			<span class="text-faint mt-0.5 block text-xs">
				{$t(
					'consent.p2pOffHint',
					'No relay, no other devices: the list does not replicate. An archive, if one is on, still talks to its store; nothing else leaves the browser.'
				)}
			</span>
		</span>
	</label>
</fieldset>
