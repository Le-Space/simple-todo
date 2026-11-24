<script>
	/**
	 * "Keep in this browser", ticked unless somebody unticks it (escrow01).
	 *
	 * One box where the dialog had two radios with the word "memory" in them
	 * and, further down, "don't show this again". For somebody who is not
	 * reading a tutorial the question is whether this device should remember
	 * them, and the answer decides both: what is kept, and whether the dialog
	 * comes back. Unticked, nothing is written to this device, the decision to
	 * start included, so a reload asks again.
	 *
	 * Nothing is written here. The choice is only a choice once somebody
	 * starts with it, so the page writes it in `start()`. A box that wrote on
	 * every click would store "keep it" before anybody agreed to anything.
	 *
	 * The shared `StorageModeSelector` stays as it is for the other chapters;
	 * this is escrow01's own control for the same setting.
	 */
	import { _ } from '$lib/i18n/index.js';
	import { technicalView } from './technical-view.js';

	/** @type {'memory' | 'indexeddb'} As `StorageModeSelector` names them. */
	export let mode = 'indexeddb';

	$: kept = mode === 'indexeddb';
</script>

<label
	class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3"
	data-testid="storage-mode"
>
	<input
		type="checkbox"
		checked={kept}
		on:change={(event) => (mode = event.currentTarget.checked ? 'indexeddb' : 'memory')}
		data-testid="storage-keep"
		class="mt-0.5 h-4 w-4 shrink-0"
	/>
	<span class="text-sm">
		<span class="block font-medium text-heading">{$_('consent.keep')}</span>
		<span class="block text-xs text-faint" data-testid="storage-keep-hint">
			{$technicalView ? $_('consent.keepHintTechnical') : $_('consent.keepHint')}
		</span>
	</span>
</label>
