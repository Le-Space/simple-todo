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
	 * Two segments, the active one filled. It used to be two flags, the active
	 * one merely brighter — and a dialog that opened with the cursor on the
	 * first flag drew a focus ring round the German one on an English page,
	 * which read as "German is selected" (2026-11-17). The ring now shows only
	 * for the keyboard, and the choice is a fill that cannot be mistaken for
	 * it. The code beside the flag is for anyone who cannot tell flags apart.
	 */
	import { locale, setLocale, t } from './i18n.js';

	const options = /** @type {const} */ ([
		{ code: 'de', flag: '🇩🇪', label: 'Deutsch' },
		{ code: 'en', flag: '🇬🇧', label: 'English' }
	]);
</script>

{#if $locale}
	<div
		class="border-border flex items-center gap-0.5 rounded-md border p-0.5"
		role="group"
		aria-label={$t('ui.language.label', 'Language')}
		data-testid="language-switcher"
	>
		{#each options as option (option.code)}
			<button
				type="button"
				lang={option.code}
				aria-label={option.label}
				aria-pressed={$locale === option.code}
				data-testid={`language-${option.code}`}
				class="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold leading-none transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 {$locale ===
				option.code
					? 'bg-heading text-surface'
					: 'text-faint hover:bg-surface-2 hover:text-text'}"
				on:click={() => setLocale(option.code)}
			>
				<span class="text-sm" aria-hidden="true">{option.flag}</span>
				<!-- Not on a phone, where the header has no room for it; the fill alone
				     still says which language is on. -->
				<span class="hidden sm:inline" aria-hidden="true">{option.code.toUpperCase()}</span>
			</button>
		{/each}
	</div>
{/if}
