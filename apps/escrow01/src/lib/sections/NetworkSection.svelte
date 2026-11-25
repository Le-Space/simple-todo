<script>
	// The Network tab: the P2P state and its controls, and the app's own
	// settings. Moved out of +page.svelte as it was; the <section> around it
	// stays on the page with the other tabs. A manual connection's outcome is
	// forwarded as `connected`, for the page's toast.
	import { _ } from '$lib/i18n/index.js';
	import { initializationStore, libp2pStore, peerIdStore } from '$lib/p2p-stores.js';
	import { technicalView } from '$lib/technical-view.js';
	import { formatVersions } from '@simple-todo/todo/build-info.js';
	import SocialIcons from '@simple-todo/ui/SocialIcons.svelte';
	import P2PStatusNav from '$lib/P2PStatusNav.svelte';
	import ManualConnectForm from '$lib/ManualConnectForm.svelte';
	import ConnectedPeers from '$lib/ConnectedPeers.svelte';
	import PeerIdCard from '$lib/PeerIdCard.svelte';
	import OwnMultiaddrs from '$lib/OwnMultiaddrs.svelte';
	import ThemeToggle from '$lib/ThemeToggle.svelte';

	// What this build is made of — versions and branch — in the technical view.
	// When it was built, and from which commit, the footer says on every tab.
	const buildStamp = `${formatVersions({ appName: 'Simple-Todo' })} · ${
		typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'local'
	}`;

	$: myPeerId = $peerIdStore;

	/** @type {any} */
	let connectedPeersRef;
</script>

<P2PStatusNav initialization={$initializationStore} libp2p={$libp2pStore} peerId={myPeerId}>
	<ManualConnectForm compact disabled={!$initializationStore.isInitialized} on:connected />
	<ConnectedPeers compact bind:this={connectedPeersRef} libp2p={$libp2pStore} />
	<div class="max-w-full min-w-0 space-y-3 overflow-hidden">
		<PeerIdCard compact peerId={myPeerId} />
		<OwnMultiaddrs libp2p={$libp2pStore} />
	</div>
</P2PStatusNav>

<div
	class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
	data-testid="app-settings"
>
	<h2 class="text-sm font-medium text-faint">{$_('sections.network.app')}</h2>
	<dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-2 text-sm">
		<dt class="text-text">{$_('sections.network.theme')}</dt>
		<dd><ThemeToggle /></dd>
		<dt class="text-text">{$_('sections.network.links')}</dt>
		<dd><SocialIcons size="w-5 h-5" className="-ml-2" /></dd>
		{#if $technicalView}
			<dt class="text-text">{$_('sections.network.version')}</dt>
			<dd>
				<code class="font-mono text-xs break-all text-text" data-testid="app-version"
					>{buildStamp}</code
				>
			</dd>
		{/if}
	</dl>
</div>
