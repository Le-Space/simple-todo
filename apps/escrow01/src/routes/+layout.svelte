<script>
	import '../app.css';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { _, addressWithoutLocale } from '$lib/i18n/index.js';
	// import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

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
