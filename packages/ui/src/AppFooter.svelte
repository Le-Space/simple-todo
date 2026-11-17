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
	 * Next, a GitHub mark and the chapter's name, linking the chapter's folder on
 * GitHub (`apps/<chapter>` on main): the page is a lesson, and its code is the
 * rest of it. Left out outside a chapter build.
 *
 * Then what is deployed: the commit and its instant, in the reader's locale,
	 * clock and zone, UTC on hover (the Le-Space time and date convention). Both
	 * are the chapter's last commit, baked in at build time; a build without git
	 * has neither and shows nothing rather than a date from the clock.
	 *
	 * A chapter passes its own links as children; they follow the credit.
	 */
	import { builtFrom, chapterSource } from '@simple-todo/todo/build-info.js';
	import { describeMoment } from '@simple-todo/todo/moment.js';
	import { t } from './i18n.js';

	/** @type {{ children?: import('svelte').Snippet }} */
	let { children } = $props();

	const build = builtFrom();
	const source = chapterSource();
	// Formatted here, in the browser: only the reader's browser knows their
	// locale, clock and zone, and the bytes on IPFS stay the same for everyone.
	const moment = build ? describeMoment(build.when) : null;
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
		{#if source}
			<span aria-hidden="true">·</span>
			<a
				href={source.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1 hover:text-text"
				data-testid="chapter-source"
			>
				<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true" class="flex-none">
					<path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
					/>
				</svg>
				<span class="font-mono underline">{source.chapter}</span>
			</a>
		{/if}
		{#if build && moment}
			<span aria-hidden="true">·</span>
			<span data-testid="build-stamp"
				>{$t('ui.build.state', 'Built')}
				<time datetime={moment.datetime} title={moment.utc}>{moment.local}</time>
				<a
					href="https://github.com/Le-Space/simple-todo/commit/{build.commit}"
					target="_blank"
					rel="noopener noreferrer"
					class="font-mono underline hover:text-text">{build.short}</a
				></span
			>
		{/if}
		{#if children}
			<span aria-hidden="true">·</span>
			{@render children()}
		{/if}
	</p>
</footer>
