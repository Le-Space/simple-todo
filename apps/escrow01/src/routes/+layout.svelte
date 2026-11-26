<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { _, addressWithoutLocale } from '$lib/i18n/index.js';
	// import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	// The splash in app.html has done its work once anything here is mounted:
	// the page is mounted by now, and its start dialog opens before the browser
	// draws again (e2e/first-frame.spec.js). The `:has()` rule there hides it
	// too; this is for a browser without `:has()`, which would otherwise leave
	// it over the app.
	onMount(() => {
		document.getElementById('app-splash')?.remove();
		document.getElementById('app-root')?.removeAttribute('aria-busy');
	});

	// `?lang=` has done its work once the language is set; take it out of the
	// address, through the router, which owns the history entry. Not in
	// `onMount`: the router counts as started only after the first navigation's
	// callbacks have run, and `replaceState` before that is refused (in a
	// development build, loudly; in production it was quietly overwritten).
	afterNavigate(({ type }) => {
		if (type !== 'enter') return;
		queueMicrotask(() => {
			const plain = addressWithoutLocale();
			if (plain) replaceState(plain, page.state);
		});
	});
</script>

<svelte:head>
	<!-- The one place this app sets its title, and it says what the app is for:
	     escrow01 is sent to people who have never heard of the tutorial, and a
	     tab reading "Simple-Todo 0.2.0" told them nothing. It follows the
	     language on screen. The chapter's name stays at the end, for the reader
	     with nine tabs open; the build is in the technical view, where somebody
	     who needs it looks. -->
	<title>{$_('app.pageTitle')} · escrow01</title>
</svelte:head>

{@render children?.()}
