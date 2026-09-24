<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { fillPlaceholders, parseTemplate, renderBlock } from './invoice/template.js';

	/** The Markdown as it stands. */
	export let markdown = '';
	/** What a placeholder resolves to in the preview: this list's own settings. */
	export let context = {};
	export let busy = false;

	const dispatch = createEventDispatcher();

	/** @type {HTMLInputElement | null} */
	let fileInput = null;

	$: parsed = parseTemplate(markdown);
	$: preview = ['intro', 'closing'].map((name) => {
		const filled = fillPlaceholders(parsed.blocks[name] ?? '', context);
		return { name, items: renderBlock(filled.text), missing: filled.missing };
	});
	$: missing = [...new Set(preview.flatMap((block) => block.missing))];

	function download() {
		const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'rechnung-vorlage.md';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	/** @param {Event} event */
	async function upload(event) {
		const input = /** @type {HTMLInputElement} */ (event.currentTarget);
		const file = input.files?.[0];
		if (!file) return;
		markdown = await file.text();
		input.value = '';
	}
</script>

<section
	class="mt-4 space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="invoice-template"
>
	<div>
		<h3 class="text-lg font-semibold text-heading">{$_('invoice.template.heading')}</h3>
		<p class="mt-1 text-xs text-faint">{$_('invoice.template.hint')}</p>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<label class="block text-sm">
			<span class="text-faint">{$_('invoice.template.editorLabel')}</span>
			<textarea
				class="mt-1 h-72 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs dark:border-gray-600"
				data-testid="template-source"
				spellcheck="false"
				bind:value={markdown}
			></textarea>
		</label>

		<div class="text-sm">
			<span class="text-faint">{$_('invoice.template.preview')}</span>
			<div
				class="mt-1 h-72 overflow-auto rounded-md border border-gray-200 bg-surface-2 p-3 dark:border-gray-700"
				data-testid="template-preview"
			>
				{#each preview as block (block.name)}
					{#each block.items as item, index (index)}
						{#if item.kind === 'bullet'}
							<p class="mb-1 pl-4 -indent-4">
								–
								{#each item.runs as run, at (at)}
									{#if run.bold}<strong>{run.text}</strong>{:else}{run.text}{/if}
								{/each}
							</p>
						{:else}
							<p class="mb-2">
								{#each item.runs as run, at (at)}
									{#if run.bold}<strong>{run.text}</strong>{:else}{run.text}{/if}
								{/each}
							</p>
						{/if}
					{/each}
					{#if block.name === 'intro' && block.items.length > 0}
						<hr class="my-3 border-gray-200 dark:border-gray-700" />
						<p class="mb-3 text-xs text-faint">· · ·</p>
					{/if}
				{/each}
			</div>
		</div>
	</div>

	{#if parsed.unknown.length > 0}
		<p class="text-sm text-amber-700 dark:text-amber-400" data-testid="template-unknown-heading">
			{$_('invoice.template.unknownHeading', { values: { names: parsed.unknown.join(', ') } })}
		</p>
	{/if}
	{#if missing.length > 0}
		<p
			class="text-sm text-amber-700 dark:text-amber-400"
			data-testid="template-unknown-placeholder"
		>
			{$_('invoice.template.unknownPlaceholder', { values: { names: missing.join(', ') } })}
		</p>
	{/if}

	<p class="text-xs text-faint">{$_('invoice.template.frozen')}</p>

	<div class="flex flex-wrap gap-2">
		<button
			type="button"
			class="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
			disabled={busy}
			data-testid="template-save"
			on:click={() => dispatch('save', { template: markdown })}
			>{$_('invoice.settings.save')}</button
		>
		<button
			type="button"
			class="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
			data-testid="template-download"
			on:click={download}>{$_('invoice.template.download')}</button
		>
		<button
			type="button"
			class="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
			data-testid="template-upload"
			on:click={() => fileInput?.click()}>{$_('invoice.template.upload')}</button
		>
		<input
			type="file"
			accept=".md,text/markdown,text/plain"
			class="hidden"
			bind:this={fileInput}
			on:change={upload}
		/>
		<button
			type="button"
			class="rounded-md px-3 py-1.5 text-sm text-faint"
			data-testid="template-reset"
			on:click={() => (markdown = $_('invoice.template.default'))}
			>{$_('invoice.template.reset')}</button
		>
		<button
			type="button"
			class="rounded-md px-3 py-1.5 text-sm text-faint"
			on:click={() => dispatch('back')}>{$_('invoice.actions.back')}</button
		>
	</div>
</section>
