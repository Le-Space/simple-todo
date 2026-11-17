<script>
	import '../app.css';
	import { _ } from '$lib/i18n/index.js';
	// import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
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
