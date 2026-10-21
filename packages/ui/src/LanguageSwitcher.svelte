<script>
	/**
	 * The language switch, once.
	 *
	 * Nine chapters carried this file, eight of them byte for byte. It reads
	 * the locale and its setter from the translator registry (`i18n.js`), where
	 * the chapter registers them beside its translator — so it needs neither
	 * the chapter's `$lib/i18n` nor two props at every call site. A chapter
	 * that registered no locale renders nothing: there is no language to
	 * switch to.
	 *
	 * Flags, not a dropdown: two options do not need one, and a flag is
	 * recognisable before any of the surrounding words are. The label still
	 * carries the language name for screen readers and for anyone who cannot
	 * tell the flags apart at a glance.
	 */
	import { locale, setLocale } from './i18n.js';

	const options = /** @type {const} */ ([
		{ code: 'de', flag: '🇩🇪', label: 'Deutsch' },
		{ code: 'en', flag: '🇬🇧', label: 'English' }
	]);
</script>

{#if $locale}
	<div class="flex items-center gap-1" data-testid="language-switcher">
		{#each options as option (option.code)}
			<button
				type="button"
				lang={option.code}
				aria-label={option.label}
				aria-pressed={$locale === option.code}
				data-testid={`language-${option.code}`}
				class="hover:bg-surface-2 rounded-md px-1.5 py-1 text-lg leading-none transition {$locale ===
				option.code
					? 'opacity-100'
					: 'opacity-40 hover:opacity-80'}"
				on:click={() => setLocale(option.code)}
			>
				{option.flag}
			</button>
		{/each}
	</div>
{/if}
