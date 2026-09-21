<script>
	/**
	 * This page as a QR code, one click from the header — the Le-Space page-QR
	 * convention (le-space/landing, AGENTS.md "Page-QR convention").
	 *
	 * The code is whatever the address bar says when it is opened, fragment
	 * included, so a phone lands on exactly this page: the same chapter, the
	 * same `?ice=` mode, and — because the chapters keep the open list in the
	 * fragment (`@simple-todo/todo/list-link.js`) — the same list. One thing is
	 * taken out: a WebRTC invite (`#invite=`) is a one-time offer and has no
	 * business travelling on in a second code.
	 *
	 * Drawn here with `uqr`, bundled: no request leaves the page to render it.
	 * The code sits on a white plaque in both themes, with its quiet zone,
	 * because a camera reads it, not the theme.
	 *
	 * It lives beside the WebRTC codes of main and qr01 without getting in their
	 * way: it is only on screen when asked for, and their scanner checks what it
	 * reads, so this code scanned by mistake is refused with a reason, not used.
	 */
	import { renderSVG } from 'uqr';
	import { readListLink, withoutFragmentKeys } from '@simple-todo/todo/list-link.js';
	import { t } from './i18n.js';

	let open = $state(false);
	let url = $state('');
	let svg = $state('');
	let carriesList = $state(false);
	/** @type {HTMLElement | undefined} */
	let root = $state();

	function toggle() {
		open = !open;
		if (!open) return;
		url = withoutFragmentKeys(location.href, ['invite']);
		svg = renderSVG(url, { border: 2 });
		const linked = readListLink(url);
		carriesList = Boolean(linked.words || linked.address);
	}

	/** @param {MouseEvent} event */
	function closeOutside(event) {
		if (open && root && !root.contains(/** @type {Node} */ (event.target))) open = false;
	}
</script>

<svelte:window
	onkeydown={(event) => event.key === 'Escape' && (open = false)}
	onclick={closeOutside}
/>

<div class="relative" bind:this={root}>
	<button
		type="button"
		onclick={toggle}
		aria-expanded={open}
		aria-label={$t('ui.pageQr.open', 'This page as a QR code')}
		title={$t('ui.pageQr.open', 'This page as a QR code')}
		class="rounded-full p-2 text-text transition hover:bg-surface hover:text-coral focus:ring-2 focus:ring-cyan focus:outline-none"
		data-testid="page-qr-button"
	>
		<!-- a QR glyph: three finder squares and some modules -->
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path
				d="M3 3h8v8H3zm2 2v4h4V5zM13 3h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zM13 13h3v3h-3zM18 13h3v3h-3zM13 18h3v3h-3zM18 18h3v3h-3z"
			/>
		</svg>
	</button>

	{#if open}
		<!--
			Under the button on a wide screen; across the top on a phone, where the
			header wraps and a box anchored to the button could run off the edge.
		-->
		<div
			role="dialog"
			aria-label={$t('ui.pageQr.dialog', 'QR code of this page')}
			class="fixed inset-x-4 top-20 z-50 mx-auto max-w-64 rounded-xl border border-border bg-surface p-3.5 shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-64"
			data-testid="page-qr-dialog"
		>
			<div class="rounded-lg bg-white p-2 leading-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- uqr's own SVG of our own URL -->
				{@html svg}
			</div>
			<p class="mt-2.5 font-mono text-[0.66rem] leading-normal break-all text-faint" data-testid="page-qr-url">
				{url}
			</p>
			<p class="mt-1.5 text-xs text-faint">
				{carriesList
					? $t('ui.pageQr.hintList', 'Scan with your phone — it opens this page, and this list.')
					: $t('ui.pageQr.hint', 'Scan with your phone — it opens exactly this page.')}
			</p>
		</div>
	{/if}
</div>
