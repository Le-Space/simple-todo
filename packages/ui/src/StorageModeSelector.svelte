<script>
	/**
	 * Where this browser keeps the todos it holds.
	 *
	 * Its own component in the consent dialog's slot, next to the mnemonic and
	 * the identity choice, because it is this app's decision rather than the
	 * dialog's — and because it has to be made *before* Helia and OrbitDB are
	 * built. Changing it afterwards would mean tearing the node down.
	 *
	 * Ported from `main`, where the same choice sat inline in the consent dialog.
	 * A chapter that does not offer it has been in-memory only without saying so,
	 * and a reload silently emptied everything.
	 *
	 * The strings come through the translator registry, so a chapter that has
	 * the keys shows its own wording and one that does not shows the English
	 * written here — see `i18n.js`.
	 */
	import { t } from './i18n.js';
	import {
		getPersistentStorageEnabled,
		setPersistentStorageEnabled
	} from '@simple-todo/todo/storage-mode.js';

	/**
	 * Exposed so the consent statement can name the consequence of the option
	 * actually selected, rather than describing both and leaving the reader to
	 * work out which one applies to them.
	 *
	 * @type {'memory' | 'indexeddb'}
	 */
	export let mode = getPersistentStorageEnabled() ? 'indexeddb' : 'memory';

	let persistent = mode === 'indexeddb';

	$: setPersistentStorageEnabled(persistent);
	$: mode = persistent ? 'indexeddb' : 'memory';
</script>

<fieldset class="border-border mb-4 rounded-md border p-3" data-testid="storage-mode">
	<legend class="text-heading px-1 text-xs font-medium"
		>{$t('consent.storageLegend', 'Where your todos are stored')}</legend
	>

	<label class="flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="radio"
			bind:group={persistent}
			value={false}
			data-testid="storage-mode-memory"
			class="mt-1"
		/>
		<span>
			<span class="text-text">{$t('consent.storageMemoryLabel', 'In memory only')}</span>
			<span class="text-faint mt-0.5 block text-xs">
				{$t(
					'consent.storageMemoryHint',
					'Todos are stored in a shared, unencrypted OrbitDB database in memory and will be deleted on reload or exit.'
				)}
			</span>
		</span>
	</label>

	<label class="mt-2 flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="radio"
			bind:group={persistent}
			value={true}
			data-testid="storage-mode-indexeddb"
			class="mt-1"
		/>
		<span>
			<span class="text-text">{$t('consent.storagePersistentLabel', 'IndexedDB')}</span>
			<span class="text-faint mt-0.5 block text-xs">
				{$t(
					'consent.storagePersistentHint',
					"I understand todos are stored in a shared, unencrypted OrbitDB database in the browser's IndexedDB and will persist between restarts."
				)}
			</span>
		</span>
	</label>
</fieldset>
