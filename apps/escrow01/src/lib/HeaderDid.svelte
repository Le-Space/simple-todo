<script>
	// This session's own DID in the header, on every tab (escrow01). The same
	// value the Account tab shows (`ownDidStore`, set once the passkey identity
	// exists), shortened the same way, so the two can be matched by eye. A click
	// copies the whole DID: what somebody needs it for is to hand it to the
	// person who delegates a todo to them.
	//
	// Nothing before the identity exists, and nothing for the anonymous one: no
	// empty box waiting to be filled. Where it appears is chosen so that it
	// appearing moves nothing -- it arrives mid-start, while the page is already
	// on screen. The header renders it twice and shows one (AppHeader.svelte):
	//
	// - `row`, below `sm`: in the phone's second row, beside the network's state.
	//   Below 30rem only the DID's last six characters, the same six the Account
	//   tab ends with: at 360px that row holds the state, this and the video
	//   link, and the whole short form beside "Connected directly" pushed the
	//   link onto a row of its own. Measured: 146 + 194 + 57 px and two gaps in
	//   328.
	// - `corner`, from `sm` on: under the language, QR and technical switches.
	//   That column is already wider than the button and the row already taller
	//   than both; in the state's column, between them, it took a third line
	//   (+22px) and, at 768px, cut the title down to "Confidential e…".
	//
	// "Copied ✓" takes the DID's place for a moment rather than being added to
	// it. Both sit in one grid cell, so the button is as wide as the wider of
	// the two all along and nothing beside it moves.
	import { onDestroy } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { shortId } from '@simple-todo/todo/utils.js';
	import { ownDidStore } from './p2p-stores.js';

	/** @type {'row' | 'corner'} */
	export let placement = 'row';

	let copied = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;

	$: did = $ownDidStore ?? '';
	// A copy confirmed for one identity says nothing about the next.
	$: if (!did) copied = false;
	$: shownAt = placement === 'corner' ? 'hidden sm:inline-flex' : 'inline-flex sm:hidden';

	async function copyDid() {
		try {
			await navigator.clipboard.writeText(did);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch (error) {
			console.warn('Clipboard unavailable:', error);
		}
	}

	onDestroy(() => clearTimeout(timer));
</script>

{#if did}
	<button
		type="button"
		on:click={copyDid}
		title={$_('identity.header.title', { values: { did } })}
		aria-label={$_('identity.header.copy', { values: { did } })}
		data-testid="header-did"
		data-placement={placement}
		data-did={did}
		data-copied={copied}
		class="{shownAt} items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium whitespace-nowrap text-text outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500"
	>
		<!-- A key: the DID is the passkey's public key. -->
		<svg
			class="h-3.5 w-3.5 shrink-0 text-identity-600 dark:text-identity"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="8" cy="15" r="4.5" />
			<path d="M11.2 11.8 20 3M16.5 6.5l2.5 2.5M14 9l2 2" />
		</svg>
		<span class="grid" aria-hidden="true">
			<code class="font-mono [grid-area:1/1]" class:invisible={copied}
				><span class="min-[30rem]:hidden" data-testid="header-did-tail">…{did.slice(-6)}</span><span
					class="hidden min-[30rem]:inline"
					data-testid="header-did-value">{shortId(did)}</span
				></code
			>
			<span
				class="text-center text-identity-800 [grid-area:1/1] dark:text-identity"
				class:invisible={!copied}
				data-testid="header-did-copied">{$_('identity.copied')}</span
			>
		</span>
	</button>
	<!-- The button's name stays the same; this is what is read out after a copy. -->
	<span
		class="sr-only {placement === 'corner' ? 'hidden sm:block' : 'sm:hidden'}"
		aria-live="polite"
		data-testid="header-did-status">{copied ? $_('identity.copied') : ''}</span
	>
{/if}
