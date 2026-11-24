<script>
	/**
	 * The way to the demo video (escrow01), in two sizes: the teaser in the
	 * start dialog's top row, and a short link in the page header. Neither is
	 * on screen while the language on screen has no video (`demo-video.js`).
	 *
	 * The teaser sits left in the row of the language switch rather than in a
	 * row of its own: a row of its own pushed the German dialog on a phone to
	 * the bottom edge of the screen (781 to 810 of 810 px, measured). On a phone
	 * it says "Video · m:ss"; the full words are its accessible name either way.
	 */
	import { _, locale } from '$lib/i18n/index.js';
	import { demoVideoFor, demoVideoOpener } from './demo-video.js';

	/** @type {'teaser' | 'link'} */
	export let variant = 'teaser';

	$: video = demoVideoFor($locale);

	/** @param {MouseEvent} event */
	function openPlayer(event) {
		demoVideoOpener.set(/** @type {HTMLElement} */ (event.currentTarget));
	}
</script>

{#if video}
	{#if variant === 'teaser'}
		<button
			type="button"
			on:click={openPlayer}
			aria-label={`${$_('video.teaser')}, ${video.duration}`}
			data-testid="demo-video-teaser"
			class="mr-auto inline-flex min-h-8 items-center gap-2 rounded-md py-0.5 pr-1 text-xs font-semibold whitespace-nowrap text-heading hover:underline"
		>
			<span class="relative h-[27px] w-12 shrink-0 overflow-hidden rounded bg-surface-2">
				<img src={video.poster} alt="" class="h-full w-full object-cover" />
				<span
					class="absolute inset-0 m-auto h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-white drop-shadow"
					aria-hidden="true"
				></span>
			</span>
			<span class="hidden min-[34rem]:inline" aria-hidden="true"
				>{$_('video.teaser')} · {video.duration}</span
			>
			<span class="min-[34rem]:hidden" aria-hidden="true"
				>{$_('video.short')} · {video.duration}</span
			>
		</button>
	{:else}
		<button
			type="button"
			on:click={openPlayer}
			aria-label={$_('video.teaser')}
			data-testid="demo-video-link"
			class="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-text hover:text-heading"
		>
			<span
				class="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current"
				aria-hidden="true"
			></span>
			<span aria-hidden="true">{$_('video.short')}</span>
		</button>
	{/if}
{/if}
