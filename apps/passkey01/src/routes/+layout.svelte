<script>
	import '../app.css';
	// import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<!-- The one place this app sets its title. The chapter comes first: in a
	     strip of nine tabs the first characters are all anybody reads, and every
	     chapter used to say "Simple-Todo". The version stays, it is how a reader
	     tells which build they are looking at. -->
	<title
		>passkey01 · Simple-Todo {typeof __APP_VERSION__ !== 'undefined'
			? __APP_VERSION__
			: '0.0.0'}</title
	>
</svelte:head>

{@render children?.()}
