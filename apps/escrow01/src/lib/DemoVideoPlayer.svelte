<script>
	/**
	 * The demo video, large, over whatever is on screen (escrow01).
	 *
	 * Its own `<dialog>`, opened with `showModal()`: that puts it in the top
	 * layer, above the start dialog when the teaser there opened it, and makes
	 * it the one Escape closes. The start dialog underneath hears nothing of it
	 * -- its close handler is what starts the app, and watching is not consent.
	 * Placed on the page, not inside the start dialog, so both ways in (the
	 * teaser there, the link in the header) open the same player.
	 *
	 * The `<video>` exists only while the player is open: before the click
	 * nothing of the video is fetched, not even its metadata.
	 */
	import { onDestroy } from 'svelte';
	import { _, locale } from '$lib/i18n/index.js';
	import { demoVideoFor, demoVideoOpener, youtubeUrl } from './demo-video.js';

	/** @type {HTMLDialogElement | undefined} */
	let dialog;
	/** @type {HTMLButtonElement | undefined} */
	let closeButton;
	let open = false;

	$: video = demoVideoFor($locale);
	$: youtube = youtubeUrl(video?.youtubeId);
	$: language = String($locale ?? 'en').slice(0, 2) === 'de' ? 'de' : 'en';
	// A language without a video, switched to while the player was open: the
	// dialog leaves with the entry, and with it the reason to wait for a close.
	$: if (!video && open) {
		open = false;
		demoVideoOpener.set(null);
	}

	const stop = demoVideoOpener.subscribe((opener) => {
		if (!opener || !dialog || dialog.open) return;
		open = true;
		dialog.showModal();
		// The one control that is always there; the video's own controls take
		// the cursor from here with a single Tab.
		closeButton?.focus();
	});
	onDestroy(stop);

	function close() {
		dialog?.close();
	}

	/** Escape and the close button both end here. */
	function onClose() {
		open = false;
		const opener = $demoVideoOpener;
		demoVideoOpener.set(null);
		// Back where the reader was. The browser does this for a dialog on its
		// own in some versions and not in others.
		opener?.focus({ preventScroll: true });
	}
</script>

{#if video}
	<dialog
		bind:this={dialog}
		on:close={onClose}
		data-testid="demo-video-player"
		aria-labelledby="demo-video-title"
		class="m-auto box-border w-[calc(100vw-2rem)] max-w-3xl rounded-[14px] border border-border bg-surface p-4 text-text backdrop:bg-black/80 sm:p-5"
	>
		<h2 id="demo-video-title" class="mb-3 text-base font-semibold text-heading">
			{$_('video.title')}
		</h2>
		{#if open}
			<video
				controls
				playsinline
				preload="none"
				poster={video.poster}
				src={video.src}
				data-testid="demo-video"
				class="aspect-video w-full rounded-md bg-black"
			>
				<track
					kind="captions"
					src={video.captions}
					srclang={language}
					label={$_('video.captions')}
					default
				/>
				{$_('video.unsupported')}
			</video>
		{/if}
		<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
			{#if youtube}
				<a
					href={youtube}
					target="_blank"
					rel="noopener noreferrer"
					data-testid="demo-video-youtube"
					class="inline-block py-2 text-sm text-text underline underline-offset-2 hover:text-heading"
					>{$_('video.youtube')} <span aria-hidden="true">↗</span></a
				>
			{:else}
				<span></span>
			{/if}
			<button
				type="button"
				bind:this={closeButton}
				on:click={close}
				data-testid="demo-video-close"
				class="min-h-10 rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:text-heading"
			>
				{$_('video.close')}
			</button>
		</div>
	</dialog>
{/if}
