<script>
	/**
	 * The consent dialog, once.
	 *
	 * Nine chapters carried their own copy of this file and drifted: a fix a
	 * phone forced on archived01 (the waiting button that swallowed the press,
	 * a statement that followed one choice and ignored the rest) stayed open in
	 * the others (#78). What is the same everywhere lives here — the element,
	 * its strings, the acceptance tick, the proceed button that leads to it, the
	 * technical view, the warning, the error and notice slots, the flash on the
	 * lines a choice rewrote. What differs stays in the chapter: the controls
	 * in the story slot, the choices they produce, and the clauses that follow
	 * from them.
	 *
	 * The strings come through the translator registry (`i18n.js`): a chapter's
	 * own `consent.*` keys win, the English written here is the fallback. The
	 * element's thirty-odd strings are the one thing that cannot travel that
	 * way — they are an object, not a key — so the chapter hands them in as
	 * `elementStrings`.
	 */
	import { createEventDispatcher, onMount } from 'svelte';
	import { t } from './i18n.js';
	import { formatBuildDate, formatVersions } from '@simple-todo/todo/build-info.js';
	import {
		NETWORK_CAVEATS,
		NETWORK_CHECK,
		deferNetworkCheck,
		withoutNetworkCheck
	} from './qr-intro-network.js';

	const dispatch = createEventDispatcher();

	export let show = true;
	export let rememberDecision = false;
	/** Whether the chapter's own gate is satisfied — a valid mnemonic, usually. */
	export let canProceed = true;
	/**
	 * What the person chose in the story slot, as the chapter names it
	 * (`identity`, `storage`, `p2p`, `seal`, …). Handed to the element, which
	 * re-reads the clauses whenever it changes.
	 *
	 * @type {Record<string, unknown>}
	 */
	export let choices = {};
	/**
	 * The statement in plain words, assembled from the choices: what exists
	 * where, who can read it, and what cannot be undone. The chapter's, because
	 * what a chapter does with data is the chapter's to state. Read at call
	 * time, so a language switch repaints it.
	 *
	 * @type {(state: Record<string, unknown>) => string[]}
	 */
	export let clauses = () => [];
	/**
	 * The element's own strings, translated: `$json('consent.element')` from
	 * the chapter's catalogue. `title`, `close` and `dontShow` are filled in
	 * here from the chapter's `app.title`, `consent.proceed` and
	 * `consent.remember`, and the two counted strings from
	 * `consent.relayReachable` and `consent.relayDiscovered`.
	 *
	 * `unknown`, because that is what `$json()` is typed to return.
	 *
	 * @type {unknown}
	 */
	export let elementStrings = {};
	/**
	 * What went wrong the last time somebody pressed proceed. It belongs here
	 * rather than on the page behind: the dialog reopens on every failure, so a
	 * message rendered in `<main>` is covered by the very dialog that is asking
	 * again (#337).
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
	/**
	 * The technical view. Bindable, so a chapter with a page-wide switch
	 * (escrow01) can hand its store in and the dialog opens the way the last
	 * visit left it.
	 */
	export let technical = false;
	/**
	 * The element's network check: `'off'` where the chapter connects through a
	 * relay and the check would measure a direct WebRTC connection it never
	 * makes (and ask a STUN server for this reader's address before they agreed
	 * to anything); `'deferred'` where it is wanted, held back until the
	 * statement is accepted.
	 *
	 * @type {'off' | 'deferred'}
	 */
	export let networkCheck = 'off';
	/**
	 * With `networkCheck: 'off'`, the sections of the element to hide. The
	 * default hides the check and its caveats; a chapter that brings its own
	 * technical bullets and wants the address table keeps the caveats visible.
	 *
	 * @type {string[]}
	 */
	export let hideSections = [NETWORK_CHECK, NETWORK_CAVEATS];
	/** The build, shown in the technical view. */
	export let version = `${formatVersions()} [${formatBuildDate(
		typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''
	)}]`;

	/** @type {any} */
	let introEl;
	let ready = false;
	let accepted = false;
	/** @type {(() => Promise<void>) | null} */
	let measureNetwork = null;

	$: if (accepted && measureNetwork) void measureNetwork();

	$: strings = {
		.../** @type {Record<string, unknown>} */ (elementStrings ?? {}),
		title: $t('app.title', 'Simple-Todo'),
		close: $t('consent.proceed', 'Open shared list'),
		dontShow: $t('consent.remember', "Don't show this again on this device"),
		// Two of the element's strings are functions of a count, so they cannot
		// travel in the plain map.
		relayReachable: (/** @type {number} */ count) =>
			$t('consent.relayReachable', '{count} known relays answered. No directory was queried.', {
				count
			}),
		relayDiscovered: (/** @type {number} */ count) =>
			$t(
				'consent.relayDiscovered',
				'{count} relays found in the directory - the ones shipped with this app stayed silent.',
				{ count }
			)
	};

	$: if (ready) introEl.strings = strings;
	$: if (ready) introEl.technical = technical;
	$: if (ready) {
		introEl.privacy = { accept: true, clauses };
		watchAcceptance();
		hideDeadCloseControl();
	}
	$: if (ready) {
		introEl.choices = choices;
		// After the assignment, not before: `set choices` repaints the panel
		// synchronously, so by this line the new clauses are in the DOM.
		markChangedClauses();
	}
	$: if (ready && show && !introEl.isOpen) void introEl.open();

	/*
		One label for two different blockers told people to fill in a field that
		was already filled: the mnemonic is generated and valid on arrival, so
		what actually holds the button is the acceptance tick further down.
		Named in reading order — the mnemonic sits above the tick, so an invalid
		one is what to say first.
	*/
	$: proceedLabel = !canProceed
		? $t('consent.proceedDisabled', 'Enter three Spanish words to continue')
		: !accepted
			? $t('consent.proceedNeedsAccept', 'Confirm the notice first')
			: $t('consent.proceed', 'Open shared list');

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

	/**
	 * The statement as it was last painted, so a choice can be told from a
	 * repaint.
	 *
	 * @type {string[]}
	 */
	let paintedClauses = [];

	/**
	 * Flash the lines a choice just rewrote. The panel is the point of
	 * assembling a statement — it says what *this* configuration means — and a
	 * switch three inches away silently rewrote two of its sentences. Compared
	 * by text, because the list is rebuilt whole on every repaint. Nothing is
	 * marked on the first paint: flashing the whole statement on arrival
	 * teaches nobody which line their choice moved.
	 */
	function markChangedClauses() {
		const list = introEl?.shadowRoot?.querySelector('.privacy ul');
		if (!list) return;
		const next = [...list.children].map((item) => item.textContent ?? '');
		if (paintedClauses.length > 0) {
			next.forEach((text, index) => {
				if (text !== paintedClauses[index]) list.children[index]?.classList.add('changed');
			});
		}
		paintedClauses = next;
	}

	/*
		The animation, inside the shadow root because that is where the clauses
		live. A `part` on each clause would be the clean way and the element does
		not offer one; appending a stylesheet is the reach that avoids forking it.
		The colour comes from a custom property on the host, so it follows the
		theme. Reduced motion gets the same signal without the blink.
	*/
	const HIGHLIGHT_STYLE = `
		.privacy li.changed {
			border-radius: 0.2rem;
			animation: consent-changed 900ms ease-in-out 2;
		}
		@keyframes consent-changed {
			0%, 100% { background: transparent; }
			50% { background: var(--consent-changed); }
		}
		@media (prefers-reduced-motion: reduce) {
			.privacy li.changed {
				animation: none;
				background: var(--consent-changed);
			}
		}
	`;

	onMount(async () => {
		await import('@le-space/libp2p-webrtc-qr/elements');
		introEl.strings = strings;

		// A plain style element rather than `adoptedStyleSheets`: one line, and
		// nothing else writes to the shadow root's children apart from the
		// element itself. The tag name is not spelled out in this block on
		// purpose: Svelte's parser takes a literal style tag in a comment for
		// the real thing.
		const highlight = document.createElement('style');
		highlight.textContent = HIGHLIGHT_STYLE;
		introEl.shadowRoot?.append(highlight);

		introEl.addEventListener('close', (/** @type {any} */ event) => {
			rememberDecision = event.detail?.remember === true;
			show = false;
			dispatch('proceed');
		});
		if (networkCheck === 'deferred') measureNetwork = deferNetworkCheck(introEl);
		else withoutNetworkCheck(introEl, hideSections);
		ready = true;
	});
</script>

<qr-intro bind:this={introEl} data-testid="consent-modal">
	<!--
		The language switch belongs in here rather than in the page header: this
		dialog is the first thing anybody sees, and sending somebody to the header
		to change the language of the screen they are currently failing to read
		would be a poor joke. It is the chapter's, in the header slot.
	-->
	<div slot="header" class="flex shrink-0 items-center gap-2">
		<slot name="header" />
		<button
			type="button"
			on:click={() => (technical = !technical)}
			data-testid="consent-technical"
			data-technical={technical}
			class="border-border text-faint hover:text-text rounded-md border px-2 py-1 text-xs"
		>
			{technical ? $t('consent.simple', 'Simple') : $t('consent.technical', 'Technical')}
		</button>
	</div>

	<!--
		Build metadata was the second line of the first screen anybody sees. It
		belongs where somebody goes looking for it.
	-->
	{#if technical}
		<p class="text-faint text-xs" data-testid="consent-version">{version}</p>
	{/if}

	<!--
		First, and quietly. It is a demonstration and saying so is fair — but a
		warning that frightens people off is not a warning, it is a door.
	-->
	<div class="border-border my-4 rounded-md border p-3 text-sm" data-testid="consent-warning">
		<span class="text-heading font-medium">{$t('consent.warningHeading', 'Early days')}</span>
		<span class="text-text"
			>{$t(
				'consent.warningBody',
				'This is a working demonstration rather than a finished product. It does what it says, and the format may still change - so keep anything you would be sorry to lose somewhere else as well.'
			)}</span
		>
	</div>

	<!--
		The chapter's own controls — the shared-list mnemonic, the identity
		choice, the storage choice. They stay the chapter's markup in the
		element's story slot, which is the split the element is built around: it
		knows about dialogs, not about this app.
	-->
	<slot name="before-confirmation" />

	<div slot="footer" class="flex flex-col items-stretch gap-2 sm:items-end">
		{#if notice && !error}
			<p
				data-testid="consent-notice"
				class="border-border bg-surface-2 text-text rounded-md border px-3 py-2 text-sm"
			>
				{notice}
			</p>
		{/if}
		{#if error}
			<p
				role="alert"
				data-testid="consent-error"
				class="border-danger/40 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm"
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
					class="text-text hover:text-heading rounded-md px-2 py-1 text-sm underline underline-offset-2"
				>
					{$t('consent.showNotice', 'Show the notice')}
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
				class="bg-coral-700 hover:bg-coral-800 rounded-md px-6 py-3 font-medium text-white transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
			>
				{proceedLabel}
			</button>
		</div>
	</div>
</qr-intro>

<style>
	/*
		The element ships a dark-first palette and reads it from `--qr-intro-*`.
		Every name it does not find falls back to that dark default, silently —
		which is how a misnamed variable once left #e8ecf3 text on a white
		surface. So map the whole set. Mapping to the app tokens rather than to
		literals carries the dark theme for free: `.dark` redefines them on :root
		and the dialog follows.

		The flash colour crosses into the shadow root the same way: amber in the
		light, yellow in the dark, because one value is invisible on the other
		background.
	*/
	qr-intro {
		--qr-intro-background: var(--surface);
		--qr-intro-color: var(--text);
		--qr-intro-muted: var(--faint);
		--qr-intro-border: var(--border);
		--qr-intro-accent: var(--identity, var(--cyan));
		--qr-intro-panel-background: var(--surface-2);
		--qr-intro-panel-border: var(--border);
		--qr-intro-panel-color: var(--text);
		--consent-changed: rgba(217, 119, 6, 0.3);
	}

	:global(html.dark) qr-intro {
		--consent-changed: rgba(250, 204, 21, 0.4);
	}
</style>
