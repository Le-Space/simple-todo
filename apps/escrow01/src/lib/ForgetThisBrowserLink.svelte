<script>
	/**
	 * "Forget me on this browser", the link (escrow01). It only asks: the
	 * confirmation is ForgetThisBrowser.svelte, once on the page, and it
	 * returns focus here when somebody cancels.
	 */
	import { _ } from '$lib/i18n/index.js';
	import { forgetOpener } from './forget-this-browser.js';

	/** Extra classes for where it sits: the footer line or the welcome step. */
	export let className = '';
</script>

<button
	type="button"
	on:click={(event) => forgetOpener.set(event.currentTarget)}
	data-testid="forget-browser-open"
	class="underline underline-offset-2 hover:text-heading {className}"
>
	{$_('forget.open')}
</button>
