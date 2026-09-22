<script>
	/**
	 * The header mark, linked to local-first.le-space.de — where the stack these
	 * chapters are built on is described. qr01 had this link on its own; every
	 * chapter has it now, from one place.
	 *
	 * The mark keeps its round node here: the header is where the logo stands
	 * (the heart variant is for the credit line in the footer only).
	 */
	import LeSpaceLogo from './LeSpaceLogo.svelte';
	import { t } from './i18n.js';

	/** @type {{ size?: number }} */
	let { size = 52 } = $props();
</script>

<a
	href="https://local-first.le-space.de"
	target="_blank"
	rel="noopener noreferrer"
	class="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-cyan focus-visible:outline-none"
	aria-label={$t('ui.localFirst.link', 'Le Space: the local-first stack behind this app')}
	title={$t('ui.localFirst.link', 'Le Space: the local-first stack behind this app')}
	data-testid="local-first-link"
>
	<LeSpaceLogo {size} />
</a>
