<script>
	/**
	 * The line under every chapter: who made it, and whatever the chapter adds.
	 *
	 * "Made with [mark] Le Space" is the brand's signature line: the mark's local
	 * node drawn as a heart, the credit variant from le-space/landing
	 * (`docs/le-space-brand/logo/svg/le-space-mark-heart-*.svg`). Only this node
	 * changes shape — colours, geometry and edges are the mark's own, taken from
	 * the same `--coral`/`--cyan` tokens as `LeSpaceLogo`, so it follows the
	 * theme. 22 px is the variant's minimum: the heart is a third of the mark's
	 * height and needs the two pixels over the mark's 20 to read as a heart.
	 * Mark and name are one link, so the signature has somewhere to go.
	 *
	 * The heart is a gesture, not the logo: the header keeps `LeSpaceLogo`, whose
	 * round node *is* the mark. Here the mark is decorative and the link is named
	 * by its text, so a screen reader says "Made with Le Space" once.
	 *
	 * A chapter passes its own links as children; they follow the credit.
	 */
	import { t } from './i18n.js';

	/** @type {{ children?: import('svelte').Snippet }} */
	let { children } = $props();
</script>

<footer class="mt-10 border-t border-border pt-4 pb-2 text-xs text-faint" data-testid="app-footer">
	<p class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
		<span>{$t('ui.credit.madeWith', 'Made with')}</span>
		<a
			href="https://le-space.de"
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1 text-text hover:text-heading"
			data-testid="le-space-credit"
		>
			<svg
				viewBox="0 0 96 96"
				width="22"
				height="22"
				aria-hidden="true"
				class="flex-none"
				data-testid="le-space-credit-mark"
			>
				<line x1="42.7" y1="49.96" x2="58.56" y2="34.94" stroke="var(--cyan)" stroke-width="4" stroke-linecap="round" />
				<line x1="47.43" y1="63.58" x2="62.8" y2="64.98" stroke="var(--cyan)" stroke-width="4" stroke-linecap="round" stroke-dasharray="0.1 8" />
				<line x1="69.85" y1="38.36" x2="72.41" y2="55.37" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="0.1 6" opacity="0.65" />
				<path
					d="M 0.5 0.96 C 0.19 0.74 0 0.55 0 0.36 A 0.25 0.25 0 0 1 0.5 0.26 A 0.25 0.25 0 0 1 1 0.36 C 1 0.55 0.81 0.74 0.5 0.96 Z"
					transform="translate(15,47) scale(30)"
					fill="var(--coral)"
				/>
				<circle cx="68" cy="26" r="8" fill="none" stroke="var(--cyan)" stroke-width="5" />
				<circle cx="74" cy="66" r="6.5" fill="none" stroke="var(--cyan)" stroke-width="4.5" />
				<circle cx="17" cy="21" r="2.6" fill="var(--cyan)" opacity="0.55" />
			</svg>
			<span class="underline">Le Space</span>
		</a>
		{#if children}
			<span aria-hidden="true">·</span>
			{@render children()}
		{/if}
	</p>
</footer>
