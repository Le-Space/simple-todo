<script>
	// One icon per tab (invoice01, from escrow01). Drawn here rather than taken
	// from a library: four shapes do not justify a dependency.

	/** @type {'aufgaben' | 'rechnungen' | 'listen' | 'netzwerk'} */
	export let name;
</script>

<svg
	class="h-5 w-5 shrink-0"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'aufgaben'}
		<!-- A ticked box. -->
		<rect x="3.5" y="3.5" width="17" height="17" rx="3" />
		<path d="M8 12.5l2.8 2.8L16.5 9" />
	{:else if name === 'listen'}
		<!-- Three rows. -->
		<path d="M9 6.5h11M9 12h11M9 17.5h11" />
		<path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.6" />
	{:else if name === 'rechnungen'}
		<!-- A document with lines and a torn foot: an invoice. -->
		<path d="M6 3.5h9l3.5 3.5v11.5l-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5-2.5-1.5z" />
		<path d="M14.5 3.5V7H18" />
		<path d="M9 10.5h6M9 14h4" />
	{:else}
		<!-- A globe. -->
		<circle cx="12" cy="12" r="8.5" />
		<path
			d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z"
		/>
	{/if}
</svg>
