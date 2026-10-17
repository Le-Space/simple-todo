<script>
	import { createEventDispatcher, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { _, json } from '$lib/i18n/index.js';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import { formatBuildDate, formatVersions } from '@simple-todo/todo/build-info.js';
	import { withoutNetworkCheck } from '@simple-todo/ui/qr-intro-network.js';

	const dispatch = createEventDispatcher();

	export let show = true;
	export let rememberDecision = false;
	/** Whether the app's own gate is satisfied — here, a valid mnemonic. */
	export let canProceed = true;
	/** @type {'anonymous' | 'create' | 'existing'} */
	export let identity = 'anonymous';
	/** The peer-to-peer network switch, the storage choice, the sealing box, the archive. */
	export let p2p = true;
	export let persistent = true;
	export let seal = true;
	export let archive = false;
	export let owner = false;
	/**
	 * What went wrong the last time somebody pressed proceed.
	 *
	 * It belongs here rather than on the page behind: the dialog reopens on
	 * every failure, so a message rendered in `<main>` is covered by the very
	 * dialog that is asking again. Somebody then sees the consent screen
	 * return with no explanation, which is how "existing passkey" looked like
	 * a dead button (#337).
	 *
	 * @type {string | null}
	 */
	export let error = null;
	/**
	 * Something the person should know before they press proceed, which is not
	 * a failure — a passkey session that needs its tap, for instance.
	 *
	 * @type {string | null}
	 */
	export let notice = null;

	/** @type {any} */
	let introEl;
	let ready = false;
	let technical = false;
	let accepted = false;

	const version = `${formatVersions()} [${formatBuildDate(
		typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''
	)}]`;

	/**
	 * The statement in plain words, assembled from what is actually configured.
	 *
	 * This is the "simple" half of the dialog; the element's technical view is
	 * the other, and it renders itself. Written for somebody who does not work
	 * in security and still has to decide something: what exists where, who can
	 * read it, and what cannot be undone. No stack names, no protocol names —
	 * those are one button away in the technical view for anyone who wants them.
	 *
	 * A function rather than a list, because two of these sentences depend on
	 * the identity chosen three inches above; the element re-reads them whenever
	 * `choices` changes.
	 *
	 * @param {any} state
	 */
	const clauses = (state) => {
		const passkey = state.identity !== 'anonymous';
		const t = get(_);
		return [
			t('consent.clause.gateway'),
			state.p2p ? t('consent.clause.relayOn') : t('consent.clause.networkOff'),
			passkey ? t('consent.clause.listPasskey') : t('consent.clause.listOpen'),
			!passkey
				? t('consent.clause.sealingNeedsPasskey')
				: state.seal
					? t('consent.clause.sealed')
					: t('consent.clause.notSealed'),
			passkey
				? t('consent.clause.identityPasskey')
				: state.persistent
					? t('consent.clause.identityAnonymousKept')
					: t('consent.clause.identityAnonymous'),
			state.persistent ? t('consent.clause.storageKept') : t('consent.clause.storageMemory'),
			state.archive
				? state.owner
					? t('consent.clause.archiveOnOwner')
					: t('consent.clause.archiveOn')
				: t('consent.clause.archiveOff'),
			t('consent.clause.noTracking')
		].filter(Boolean);
	};

	/*
		The element carries 30-odd strings and we used to hand it three, so the
		other 30 stayed on its English defaults: "I have read this and accept it"
		sat one line above "Auf diesem Gerät nicht mehr anzeigen".

		`consent.element` mirrors the element's own keys, which means an element
		release that adds one leaves a hole here — `consent-screen.spec.js`
		compares the two sets in the browser so the hole is a failing test rather
		than a sentence in the wrong language.

		`technical` is deliberately absent: the element's own bullets are about
		networks, and this chapter replaces them with its own.
	*/
	$: strings = {
		.../** @type {Record<string, string>} */ ($json('consent.element')),
		title: $_('app.title'),
		close: $_('consent.proceed'),
		dontShow: $_('consent.remember'),
		// Two of the element's strings are functions of a count, so they cannot
		// travel in the plain map above.
		relayReachable: (/** @type {number} */ count) =>
			$_('consent.relayReachable', { values: { count } }),
		relayDiscovered: (/** @type {number} */ count) =>
			$_('consent.relayDiscovered', { values: { count } })
	};

	$: if (ready) introEl.strings = strings;
	$: if (ready) introEl.technical = technical;
	$: if (ready) {
		introEl.privacy = { accept: true, clauses };
		watchAcceptance();
		hideDeadCloseControl();
	}
	$: if (ready) introEl.choices = { identity, p2p, persistent, seal, archive, owner };

	/*
		One label for two different blockers told people to fill in a field that
		was already filled: the mnemonic is generated and valid on arrival, so
		what actually holds the button is the acceptance tick further down.

		Named in reading order — the mnemonic sits above the tick, so an invalid
		one is what to say first.
	*/
	$: proceedLabel = !canProceed
		? $_('consent.proceedDisabled')
		: !accepted
			? $_('consent.proceedNeedsAccept')
			: $_('consent.proceed');
	$: if (ready && show && !introEl.isOpen) void introEl.open();

	/**
	 * The element disables its own close control; the proceed button below is
	 * ours and has to know whether the statement was accepted. Idempotent,
	 * because the reactive block above runs again on every choice.
	 */
	/**
	 * Open the statement, bring the acceptance tick into view and put the
	 * cursor on it. The tick sits inside the element's collapsed "what this
	 * means for your data": scrolling to it inside a closed <details> shows
	 * nothing, and on a phone the button naming the tick was the only thing in
	 * view (2026-10-17).
	 */
	function revealAcceptance() {
		const box = introEl?.shadowRoot?.querySelector('input[part=accept]');
		if (!(box instanceof HTMLElement)) return;
		const details = box.closest('details');
		if (details) details.open = true;
		box.scrollIntoView({ block: 'center', behavior: 'smooth' });
		box.focus();
	}

	/** A press on the waiting button leads to what it is waiting for. */
	function onProceed() {
		if (!canProceed) return;
		if (!accepted) return revealAcceptance();
		introEl.close();
	}

	/**
	 * The element ships a close control and disables it — deliberately, since
	 * this dialog is a decision rather than something to dismiss. A visible
	 * cross that does nothing is worse than no cross, and it sits in the corner
	 * where people reach to get out.
	 */
	function hideDeadCloseControl() {
		const close = introEl?.shadowRoot?.querySelector('button[disabled]');
		if (!(close instanceof HTMLElement)) return;
		close.hidden = true;
		close.setAttribute('aria-hidden', 'true');
	}

	function watchAcceptance() {
		const box = introEl?.shadowRoot?.querySelector('input[part=accept]');
		if (!box || box.dataset.watched === 'true') return;
		box.dataset.watched = 'true';
		accepted = box.checked === true;
		box.addEventListener('change', () => (accepted = box.checked === true));
	}

	onMount(async () => {
		await import('@le-space/libp2p-webrtc-qr/elements');
		introEl.strings = strings;

		introEl.addEventListener('close', (/** @type {any} */ event) => {
			rememberDecision = event.detail?.remember === true;
			show = false;
			dispatch('proceed');
		});
		// This chapter connects through a relay. The element's network check and
		// its caveats are about a direct WebRTC-QR connection it never makes, so
		// both are off, and the check measures against no STUN server: opening
		// the dialog asks nobody outside for this reader's address before they
		// have agreed to anything.
		withoutNetworkCheck(introEl);
		ready = true;
	});
</script>

<qr-intro bind:this={introEl} data-testid="consent-modal">
	<!--
		The language switch belongs in here rather than in the page header: this
		dialog is the first thing anybody sees, and sending somebody to the header
		to change the language of the screen they are currently failing to read
		would be a poor joke.
	-->
	<div slot="header" class="flex shrink-0 items-center gap-2">
		<LanguageSwitcher />
		<button
			type="button"
			on:click={() => (technical = !technical)}
			data-testid="consent-technical"
			class="rounded-md border border-border px-2 py-1 text-xs text-faint hover:text-text"
		>
			{technical ? $_('consent.simple') : $_('consent.technical')}
		</button>
	</div>

	<!--
		Build metadata was the second line of the first screen anybody sees. It
		belongs where somebody goes looking for it.
	-->
	{#if technical}
		<p class="text-xs text-faint" data-testid="consent-version">{version}</p>
	{/if}

	<div class="my-4 rounded-md border border-border p-3 text-sm" data-testid="consent-warning">
		<span class="font-medium text-heading">{$_('consent.warningHeading')}</span>
		<span class="text-text">{$_('consent.warningBody')}</span>
	</div>

	<!--
		The chapter's own controls: the shared-list mnemonic and the identity
		choice. They stay the app's markup in the element's story slot, which is
		the split the element is built around — it knows about dialogs, not about
		this app.
	-->
	<slot name="before-confirmation" />

	<div slot="footer" class="flex flex-col items-stretch gap-2 sm:items-end">
		{#if notice && !error}
			<p
				data-testid="consent-notice"
				class="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text"
			>
				{notice}
			</p>
		{/if}
		{#if error}
			<p
				role="alert"
				data-testid="consent-error"
				class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
			>
				{error}
			</p>
		{/if}
		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if canProceed && !accepted}
				<!--
					The dialog's body scrolls and its foot does not, so on a phone the
					acceptance tick can sit above the fold while the button naming it
					is in view. This is the way back to it.
				-->
				<button
					type="button"
					on:click={revealAcceptance}
					data-testid="consent-show-notice"
					class="rounded-md px-2 py-1 text-sm text-text underline underline-offset-2 hover:text-heading"
				>
					{$_('consent.showNotice')}
				</button>
			{/if}
			<!--
				Not `disabled` while it waits for the tick: a disabled button swallows
				the press, and the press is how somebody finds the tick (onProceed).
				`aria-disabled` keeps it announced as not yet available.
			-->
			<button
				type="button"
				aria-disabled={!accepted || !canProceed}
				data-waiting={!accepted || !canProceed ? 'true' : undefined}
				on:click={onProceed}
				data-testid="consent-proceed"
				class="rounded-md bg-coral-700 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
			>
				{proceedLabel}
			</button>
		</div>
	</div>
</qr-intro>

<style>
	/*
		The element ships a dark-first palette and reads it from `--qr-intro-*`.
		Every name it does not find falls back to that dark default, and the
		fallback is silent — which is how `--qr-intro-text` (a name the element
		never reads; it is `--qr-intro-color`) left the dialog with #e8ecf3 text
		on the white `--surface` we did set: 1.18:1, with the identity choice as
		the casualty. So map the whole set, not the two that seemed to matter.

		Mapping to the app tokens rather than to literals also carries the dark
		theme for free: `.dark` redefines them on :root and the dialog follows.
	*/
	qr-intro {
		--qr-intro-background: var(--surface);
		--qr-intro-color: var(--text);
		--qr-intro-muted: var(--faint);
		--qr-intro-border: var(--border);
		--qr-intro-accent: var(--identity);
		--qr-intro-panel-background: var(--surface-2);
		--qr-intro-panel-border: var(--border);
		--qr-intro-panel-color: var(--text);
	}
</style>
