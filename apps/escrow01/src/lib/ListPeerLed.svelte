<script>
	// Under the open list's name (escrow01), in the simple view as well: whether
	// another browser on this list is connected directly (WebRTC), only through
	// the relay, or not there at all. A link to the network tab, where each
	// peer's transport is listed.
	import { onDestroy } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { libp2pStore } from './p2p-stores.js';
	import { todoDBStore } from './db-actions.js';
	import { listPeerState } from './list-peers.js';

	/** Recompute this often even without an event: cheap, and events can be missed. */
	const REFRESH_MS = 3000;
	/** How long the LED pulses after another browser has connected directly. */
	const FLASH_MS = 4000;

	/** @type {ReturnType<typeof listPeerState>} */
	let peers = listPeerState({});
	let flashing = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let flashTimer;

	/** @type {Array<() => void>} */
	let unlisten = [];
	/** @type {ReturnType<typeof setInterval> | undefined} */
	let refreshTimer;

	$: watch($libp2pStore, $todoDBStore);

	/**
	 * @param {any} node
	 * @param {any} db
	 */
	function watch(node, db) {
		stop();
		const update = () => recompute(node, db);
		/**
		 * @param {any} target
		 * @param {string} event
		 */
		const on = (target, event) => {
			if (typeof target?.addEventListener === 'function') {
				target.addEventListener(event, update);
				unlisten.push(() => target.removeEventListener(event, update));
			} else if (typeof target?.on === 'function') {
				target.on(event, update);
				unlisten.push(() => target.off?.(event, update));
			}
		};
		on(node, 'connection:open');
		on(node, 'connection:close');
		on(node?.services?.pubsub, 'subscription-change');
		on(db?.events, 'join');
		on(db?.events, 'leave');
		refreshTimer = setInterval(update, REFRESH_MS);
		update();
	}

	/**
	 * @param {any} node
	 * @param {any} db
	 */
	function recompute(node, db) {
		const before = peers.state;
		if (!node || !db) {
			peers = listPeerState({});
		} else {
			const topic = db.address?.toString?.() ?? '';
			/** @type {unknown[]} */
			let subscribers = [];
			try {
				subscribers = Array.from(node.services?.pubsub?.getSubscribers?.(topic) ?? []);
			} catch {
				// Not subscribed yet: nobody to list.
			}
			peers = listPeerState({
				connections: node.getConnections?.() ?? [],
				subscribers: [...subscribers, ...Array.from(db.peers ?? [])],
				selfId: node.peerId?.toString?.() ?? null
			});
		}
		if (peers.state === 'direct' && before !== 'direct') flash();
	}

	function flash() {
		flashing = true;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashing = false), FLASH_MS);
	}

	function stop() {
		for (const off of unlisten) off();
		unlisten = [];
		clearInterval(refreshTimer);
	}

	onDestroy(() => {
		stop();
		clearTimeout(flashTimer);
	});

	$: count = peers.state === 'relay' ? peers.relayed : peers.direct;
	$: label = $_(`lists.peers.${peers.state}`, { values: { count } });
	$: sentence = $_(`lists.peers.${peers.state}Sentence`);
	$: alsoRelayed =
		peers.state === 'direct' && peers.relayed > 0
			? $_('lists.peers.alsoRelayed', { values: { count: peers.relayed } })
			: '';
</script>

<a
	href="#netzwerk"
	title={sentence}
	data-testid="list-peer-led"
	data-state={peers.state}
	data-direct={peers.direct}
	data-relayed={peers.relayed}
	class="mt-1.5 inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium no-underline outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 {peers.state ===
	'direct'
		? 'border-identity-600/50 bg-identity-500/10 text-identity-800 dark:text-identity-500'
		: peers.state === 'relay'
			? 'border-data-600/50 bg-data-400/10 text-data-800 dark:text-data-400'
			: 'border-border bg-surface text-faint'}"
>
	<span class="relative flex h-3 w-3 shrink-0" aria-hidden="true">
		{#if flashing}
			<span
				class="absolute inline-flex h-full w-full rounded-full bg-identity-500 opacity-75 motion-safe:animate-ping"
			></span>
		{/if}
		<span
			class="relative inline-flex h-3 w-3 rounded-full {peers.state === 'direct'
				? 'bg-identity-500 ring-4 ring-identity-500/25'
				: peers.state === 'relay'
					? 'bg-data-400 ring-4 ring-data-400/25'
					: 'bg-faint/40'}"
		></span>
	</span>
	<span class="truncate">{label}</span>
	{#if alsoRelayed}
		<span class="truncate font-normal opacity-80">· {alsoRelayed}</span>
	{/if}
	<span class="sr-only">– {sentence} {$_('sections.status.details')}</span>
</a>
