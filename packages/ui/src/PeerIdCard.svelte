<script>
	import { formatPeerId } from '@simple-todo/todo/utils.js';
	import { t } from './i18n.js';

	/** @type {string | null | undefined} */
	export let peerId = null;
	// The three texts default to the chapter's wording in the language on screen;
	// a chapter that wants its own still passes one.
	/** @type {string | null} */
	export let title = null;
	/** @type {string | null} */
	export let description = null;
	/** @type {string | null} */
	export let loadingMessage = null;
	export let copyable = true;
	export let compact = false;

	$: shownDescription =
		description ?? $t('ui.peerId.description', 'Share this ID with others to assign TODOs to you.');

	let copied = false;

	async function copyToClipboard() {
		if (!peerId || !copyable) return;

		try {
			await navigator.clipboard.writeText(peerId);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			console.warn('Failed to copy to clipboard:', err);
			// Fallback for older browsers
			fallbackCopyToClipboard(peerId);
		}
	}

	/**
	 * @param {string} text
	 */
	function fallbackCopyToClipboard(text) {
		const textArea = document.createElement('textarea');
		textArea.value = text;
		textArea.style.position = 'fixed';
		textArea.style.left = '-999999px';
		textArea.style.top = '-999999px';
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();

		try {
			document.execCommand('copy');
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			console.warn('Fallback copy failed:', err);
		}

		document.body.removeChild(textArea);
	}
</script>

<div
	class:rounded-lg={!compact}
	class:bg-surface={!compact}
	class:p-6={!compact}
	class:shadow-md={!compact}
>
	<h2
		class:mb-4={!compact}
		class:mb-2={compact}
		class:text-xl={!compact}
		class:text-sm={compact}
		class="font-semibold"
	>
		{title ?? $t('ui.peerId.title', 'My Peer ID')}
	</h2>
	{#if peerId}
		<div
			class="dark:bg-cyan/10 relative rounded-md bg-cyan-50"
			class:p-3={!compact}
			class:p-2={compact}
		>
			<code class="block select-all truncate pr-7 font-mono text-xs" title={peerId}
				>{formatPeerId(peerId)}</code
			>
			{#if copyable}
				<button
					on:click={copyToClipboard}
					class="dark:hover:bg-cyan/20 absolute right-2 top-2 rounded p-1 transition-colors hover:bg-cyan-200"
					title={copied
						? $t('ui.copy.copied', 'Copied!')
						: $t('ui.copy.title', 'Copy to clipboard')}
				>
					{#if copied}
						<svg
							class="text-identity-600 h-4 w-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							></path>
						</svg>
					{:else}
						<svg class="text-text h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
							></path>
						</svg>
					{/if}
				</button>
			{/if}
		</div>
		{#if shownDescription && !compact}
			<p class="text-text mt-2 text-sm">{shownDescription}</p>
		{/if}
		{#if copied}
			<p class="text-identity-600 mt-1 text-sm font-medium">
				{$t('ui.copy.copiedToClipboard', 'Copied to clipboard!')}
			</p>
		{/if}
	{:else}
		<p class="text-faint">{loadingMessage ?? $t('ui.peerId.loading', 'Loading...')}</p>
	{/if}
</div>
