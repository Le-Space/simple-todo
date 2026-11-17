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
	import { locale, t } from './i18n.js';
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
	 * Plain sentences, or — in the short form only — sentences in groups under a
	 * heading each. The long form hands them to the element, which takes
	 * sentences.
	 *
	 * @type {(state: Record<string, unknown>) => Array<string | { title?: string, lines: string[] }>}
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
	/**
	 * The short form of the dialog. A chapter that hands in a summary — three or
	 * four sentences, the same way it hands in `clauses` — gets a dialog somebody
	 * outside the tutorial can read in ten seconds: the chapter's own story, the
	 * summary, the full statement and the chapter's settings each behind a
	 * disclosure, and the acceptance tick directly above the button it unlocks.
	 *
	 * Without one, the dialog is the long form it always was: the statement in
	 * the element's own panel beside the story, the tick at the end of it.
	 *
	 * The full statement stays complete in the short form. It is folded, not
	 * cut: what is accepted is still everything `clauses` says.
	 *
	 * @type {((state: Record<string, unknown>) => string[]) | null}
	 */
	export let summary = null;
	/**
	 * Short form only: one sentence beside the button once it can be pressed,
	 * saying what the press will do — that a passkey prompt follows, for
	 * instance. The chapter's, because only the chapter knows.
	 */
	export let readyHint = '';
	/**
	 * Short form only: open on the settings, for a dialog opened to change one
	 * of them (another list, for instance) rather than to read it.
	 */
	export let advancedOpen = false;
	/** The build, shown in the technical view. */
	export let version = `${formatVersions()} [${formatBuildDate(
		typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''
	)}]`;

	/** @type {any} */
	let introEl;
	let ready = false;
	let accepted = false;
	/** Short form: "do not show this again", which moves out of the element's foot. */
	let remember = false;
	/** @type {HTMLInputElement | undefined} */
	let acceptBox;
	/** @type {HTMLDetailsElement | undefined} */
	let advancedEl;
	/** @type {HTMLElement | undefined} */
	let startEl;
	let nudge = false;

	$: compact = typeof summary === 'function';
	/** @type {(() => Promise<void>) | null} */
	let measureNetwork = null;

	$: if (accepted && measureNetwork) void measureNetwork();

	$: strings = {
		.../** @type {Record<string, unknown>} */ (elementStrings ?? {}),
		// The dialog's own heading where the chapter has one: the app's name is
		// what the page header says, the dialog says what the app is for.
		title: $t('consent.title', $t('app.title', 'Simple-Todo')),
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
	// The element marks the lines a choice rewrote (0.14): it compares the
	// statement with the one it painted last, and flashes what is new. This
	// component did that from outside until then, reading the list out of the
	// shadow root; what is left of it is the colour, further down.
	//
	// The choices go in before the statement, and the order is the point: the
	// element paints when it is given the statement. Given the choices second,
	// it paints twice on arrival - once for no choices, once for these - and
	// marks whatever the second paint rewrote, before anybody chose anything.
	$: if (ready) introEl.choices = choices;
	$: if (ready) {
		// The short form keeps the statement and the tick in this component's own
		// markup, so the element gets no panel at all — and with no panel, no
		// gate of its own. The close handler below is the gate in both forms.
		introEl.privacy = compact ? null : { accept: true, clauses };
		if (!compact) watchAcceptance();
		hideDeadCloseControl();
		placeDontShow();
	}
	$: if (ready) introEl.toggleAttribute('data-compact', compact);
	$: if (ready && show && !introEl.isOpen) openDialog();

	/*
		The short form's text, assembled the way the element assembles the long
		form's: from the choices, at call time, so a language switch repaints it.
		`$t` is handed in only to make these statements re-run when the language
		changes; the chapter's functions read their own translator.
	*/
	$: summaryLines = compact ? lines(summary, { ...choices, technical }, $t) : [];
	$: clauseGroups = compact ? groupsOf(lines(clauses, { ...choices, technical }, $t)) : [];
	$: changedLines = markChanged(clauseGroups, $locale);

	/**
	 * @param {((state: Record<string, unknown>) => unknown[]) | null} make
	 * @param {Record<string, unknown>} state
	 * @param {unknown} _translator
	 * @returns {unknown[]}
	 */
	function lines(make, state, _translator) {
		try {
			return make?.(state) ?? [];
		} catch {
			// A statement that throws is one nobody can read; an empty list says so
			// less loudly than a dialog that will not open.
			return [];
		}
	}

	/**
	 * The statement in groups. A chapter may hand in plain sentences, as the
	 * element expects, or `{ title, lines }` groups — the short form shows the
	 * headings, which is where "encrypted" and "not encrypted" get to stand
	 * apart instead of in adjacent bullets.
	 *
	 * @param {unknown[]} list
	 * @returns {Array<{ title: string, lines: string[] }>}
	 */
	function groupsOf(list) {
		/** @type {Array<{ title: string, lines: string[] }>} */
		const groups = [];
		/** @type {{ title: string, lines: string[] } | null} */
		let loose = null;
		for (const item of list) {
			if (typeof item === 'string') {
				if (!item) continue;
				if (!loose) groups.push((loose = { title: '', lines: [] }));
				loose.lines.push(item);
			} else if (
				item &&
				typeof item === 'object' &&
				Array.isArray(/** @type {any} */ (item).lines)
			) {
				const group = /** @type {{ title?: string, lines: unknown[] }} */ (item);
				groups.push({
					title: group.title ?? '',
					lines: group.lines.filter((line) => typeof line === 'string' && line.length > 0)
				});
				loose = null;
			}
		}
		return groups.filter((group) => group.lines.length > 0);
	}

	/*
		The lines a choice just rewrote, as the element marks them in the long
		form. A language switch rewrites every line, and that is not news.
	*/
	const painted = {
		lines: /** @type {string[]} */ ([]),
		locale: /** @type {string | null} */ (null)
	};

	/**
	 * @param {Array<{ lines: string[] }>} groups
	 * @param {string | null} currentLocale
	 */
	function markChanged(groups, currentLocale) {
		const now = groups.flatMap((group) => group.lines);
		const before = painted.lines;
		const sameLanguage = painted.locale === currentLocale;
		painted.lines = now;
		painted.locale = currentLocale;
		if (!sameLanguage || before.length === 0) return new Set();
		return new Set(now.filter((line) => !before.includes(line)));
	}

	/**
	 * Open, and put the cursor at the top of the story rather than on the
	 * first control. A modal dialog focuses its first focusable element, and in
	 * this one that is the language switch: a focus ring round the German flag
	 * on an English page read as "German is selected" (2026-11-17).
	 */
	function openDialog() {
		void introEl.open();
		startEl?.focus({ preventScroll: true });
	}

	$: warningBody = $t(
		'consent.warningBody',
		'This is a working demonstration rather than a finished product. It does what it says, and the format may still change - so keep anything you would be sorry to lose somewhere else as well.'
	);
	/*
		One label for two different blockers told people to fill in a field that
		was already filled: the mnemonic is generated and valid on arrival, so
		what actually holds the button is the acceptance tick further down.
		Named in reading order — the mnemonic sits above the tick, so an invalid
		one is what to say first.
	*/
	$: waiting = !accepted || !canProceed;
	// What holds the button, if anything — and, beside it, what the press will
	// do. Both at once: "without a passkey you cannot lock a budget" is worth
	// reading before the tick, not only after it.
	$: hint = !canProceed
		? $t('consent.proceedDisabled', 'Enter three Spanish words to continue')
		: !accepted
			? $t('ui.consent.hintAccept', 'Confirm the notices above first.')
			: '';
	$: proceedLabel = compact
		? $t('ui.consent.start', 'Start')
		: !canProceed
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
		if (compact) {
			if (!canProceed) return revealAdvanced();
			if (!accepted) return pointAtTick();
		} else {
			if (!canProceed) return;
			if (!accepted) return revealAcceptance();
		}
		introEl.close();
	}

	/** Short form: the tick is right above the button, so point at it. */
	function pointAtTick() {
		acceptBox?.focus();
		nudge = false;
		requestAnimationFrame(() => (nudge = true));
	}

	/** Short form: what holds the button lives in the settings, so open them. */
	function revealAdvanced() {
		advancedOpen = true;
		requestAnimationFrame(() => advancedEl?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
	}

	/**
	 * Short form: "do not show this again" leaves the foot, where it sat as a
	 * second checkbox beside the one that matters, and goes into the settings.
	 */
	function placeDontShow() {
		const box = introEl?.shadowRoot?.querySelector('input[part=dont-show]');
		const label = box?.closest('label');
		// A style, not `hidden`: the element's own `.foot label { display: flex }`
		// outranks the browser's rule for the attribute.
		if (label instanceof HTMLElement) label.style.display = compact ? 'none' : '';
	}

	/**
	 * Two corrections to the element's stylesheet, until its own release
	 * carries them.
	 *
	 * Its dialog caps its height at the viewport minus 2rem — on the content
	 * box, so the padding and the border come on top: 42px, and at 800px the
	 * dialog ran 5px past the top and the bottom of the window, foot and button
	 * included (2026-11-17). And the short form is one column, narrower than the
	 * two-column long form, with a title that names the app and gets a line of
	 * its own on a phone.
	 */
	function patchElementStyle() {
		const root = introEl?.shadowRoot;
		if (!root || root.querySelector('style[data-consent-modal]')) return;
		const style = document.createElement('style');
		style.setAttribute('data-consent-modal', '');
		style.textContent = [
			'dialog { box-sizing: border-box; }',
			':host([data-compact]) dialog { max-width: 42rem; }',
			':host([data-compact]) h2 { font-size: 1.2rem; line-height: 1.3; }',
			':host([data-compact]) .foot { margin-top: 0.75rem; }',
			// On a phone the switches take a line of their own, above the title,
			// instead of squeezing the title into four lines beside them.
			'@media (max-width: 34rem) {',
			'  :host([data-compact]) .head { flex-wrap: wrap-reverse; justify-content: flex-end; row-gap: 0.75rem; }',
			'  :host([data-compact]) h2 { flex-basis: 100%; }',
			'}'
		].join('\n');
		root.append(style);
	}

	/**
	 * The element ships a close control and disables it — deliberately, since
	 * this dialog is a decision rather than something to dismiss. A visible
	 * cross that does nothing is worse than no cross, and it sits in the corner
	 * where people reach to get out.
	 *
	 * Found by its class, not by `disabled`: the short form gives the element no
	 * statement to gate, so its cross is never disabled — and a press on it
	 * would only bring the dialog straight back (the close handler's gate).
	 */
	function hideDeadCloseControl() {
		const close = introEl?.shadowRoot?.querySelector('button.close');
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
		patchElementStyle();

		introEl.addEventListener('close', (/** @type {any} */ event) => {
			// A chapter starts when this fires, and the proceed button is not the
			// only way a dialog closes: the browser closes one by itself, on
			// Escape. Only a close with the statement accepted and the chapter's
			// own condition met is a decision; any other brings the dialog back
			// and starts nothing.
			if (!canProceed || (compact ? !accepted : introEl.accepted !== true)) {
				void introEl.open();
				return;
			}
			rememberDecision = compact ? remember : event.detail?.remember === true;
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
		Where the cursor starts (see `openDialog`): the top of what there is to
		read, not the first control.
	-->
	<div bind:this={startEl} tabindex="-1" class="outline-none" data-testid="consent-start">
		<!--
			Long form: first, and quietly. It is a demonstration and saying so is
			fair — but a warning that frightens people off is not a warning, it is a
			door. The short form keeps it, in full, with the rest of the statement;
			its summary carries the gist.
		-->
		{#if !compact}
			<div class="border-border my-4 rounded-md border p-3 text-sm" data-testid="consent-warning">
				<span class="text-heading font-medium">{$t('consent.warningHeading', 'Early days')}</span>
				<span class="text-text">{warningBody}</span>
			</div>
		{/if}

		<!--
			The chapter's own story — and, in the long form, its controls: the
			shared-list words, the identity choice, the storage choice. They stay
			the chapter's markup in the element's story slot, which is the split the
			element is built around: it knows about dialogs, not about this app.
		-->
		<slot name="before-confirmation" />
	</div>

	{#if compact}
		<section class="mt-4" data-testid="consent-summary">
			<h3 class="text-heading text-sm font-semibold">
				{$t('ui.consent.summaryHeading', 'What this means for your data, in short')}
			</h3>
			<ul class="text-text mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm leading-snug">
				{#each summaryLines as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
		</section>

		<details class="consent-fold mt-3" data-testid="consent-notices">
			<summary class="text-heading text-sm font-medium">
				{$t('ui.consent.allNotices', 'All notices')}
			</summary>
			<div class="mt-3 flex flex-col gap-4 text-sm" data-testid="consent-clauses">
				{#each clauseGroups as group, index (index)}
					<section>
						{#if group.title}
							<h4 class="text-faint text-xs font-semibold uppercase tracking-wide">
								{group.title}
							</h4>
						{/if}
						<ul class="text-text mt-1.5 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
							{#each group.lines as line (line)}
								<li class:consent-changed={changedLines.has(line)}>{line}</li>
							{/each}
						</ul>
					</section>
				{/each}
				<section data-testid="consent-warning">
					<h4 class="text-faint text-xs font-semibold uppercase tracking-wide">
						{$t('consent.warningHeading', 'Early days')}
					</h4>
					<p class="text-text mt-1.5 leading-relaxed">{warningBody}</p>
				</section>
			</div>
		</details>

		<details
			class="consent-fold"
			data-testid="consent-advanced"
			bind:open={advancedOpen}
			bind:this={advancedEl}
		>
			<summary class="text-heading text-sm font-medium">
				{$t('ui.consent.advanced', 'Advanced')}
				<span class="text-faint font-normal">
					· {$t('ui.consent.advancedHint', 'where data is kept, the list, your identity')}</span
				>
			</summary>
			<div class="mt-3 flex flex-col gap-3">
				<slot name="advanced" />
				<!-- Set apart from the settings above and from the tick in the foot below:
				     it is about the next visit, not about this one. -->
				<label class="border-border text-text mt-1 flex items-start gap-2 border-t pt-3 text-sm">
					<input
						type="checkbox"
						bind:checked={remember}
						data-testid="consent-remember"
						class="mt-0.5 h-4 w-4 shrink-0"
					/>
					<span>{$t('consent.remember', "Don't show this again on this device")}</span>
				</label>
			</div>
		</details>
	{/if}

	{#if compact}
		<!--
			The tick directly above the button it unlocks, in the foot that never
			scrolls away: it used to close the statement in the right-hand column,
			a screen away from the button that named it.
		-->
		<div slot="footer" class="flex w-full flex-col gap-3">
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
			<label
				class="text-heading flex cursor-pointer items-start gap-2.5 text-sm font-medium"
				class:consent-nudge={nudge}
				on:animationend={() => (nudge = false)}
			>
				<input
					type="checkbox"
					bind:checked={accepted}
					bind:this={acceptBox}
					data-testid="consent-accept"
					class="mt-0.5 h-4 w-4 shrink-0"
				/>
				<span>{$t('consent.accept', 'I have read the notices and accept them')}</span>
			</label>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<!--
					Not `disabled` while it waits: a disabled button swallows the press,
					and the press is how somebody finds what it waits for (onProceed).
					`aria-disabled` keeps it announced as not yet available. Grey while
					it waits rather than a faded version of the colour it will have —
					a pale red button reads as an error.
				-->
				<button
					type="button"
					aria-disabled={waiting}
					aria-describedby={hint || readyHint ? 'consent-hint' : undefined}
					data-waiting={waiting ? 'true' : undefined}
					on:click={onProceed}
					data-testid="consent-proceed"
					class="rounded-md px-8 py-3 font-medium transition-colors {waiting
						? 'border-border bg-surface-2 text-faint cursor-not-allowed border'
						: 'bg-coral-700 hover:bg-coral-800 border border-transparent text-white'}"
				>
					{proceedLabel}
				</button>
				<!-- Under the button on a phone, where beside it is a column of one word per line. -->
				<div class="min-w-0 basis-full sm:flex-1 sm:basis-auto">
					{#if hint || readyHint}
						<p id="consent-hint" class="text-faint text-xs" data-testid="consent-hint">
							{#if hint}<span class="text-text block">{hint}</span>{/if}
							{#if readyHint}<span class="block" data-testid="consent-ready-hint">{readyHint}</span
								>{/if}
						</p>
					{/if}
					<!-- The chapter's way to change what the press does, next to it. -->
					<slot name="beside-start" />
				</div>
			</div>
		</div>
	{:else}
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
					`aria-disabled` keeps it announced as not yet available. Grey while
					it waits: a faded coral read as an error.
				-->
				<button
					type="button"
					aria-disabled={waiting}
					data-waiting={waiting ? 'true' : undefined}
					on:click={onProceed}
					data-testid="consent-proceed"
					class="rounded-md px-6 py-3 font-medium transition-colors {waiting
						? 'border-border bg-surface-2 text-faint cursor-not-allowed border'
						: 'bg-coral-700 hover:bg-coral-800 border border-transparent text-white'}"
				>
					{proceedLabel}
				</button>
			</div>
		</div>
	{/if}
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
		--qr-intro-changed: rgba(217, 119, 6, 0.3);
	}

	:global(html.dark) qr-intro {
		--qr-intro-changed: rgba(250, 204, 21, 0.4);
	}

	/*
		The short form's disclosures: a line with a turning marker, not a box —
		they are a way into more text, not objects of their own.
	*/
	.consent-fold > summary {
		cursor: pointer;
		list-style: none;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding-block: 0.25rem;
	}
	.consent-fold > summary::-webkit-details-marker {
		display: none;
	}
	.consent-fold > summary::before {
		content: '';
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-right: 2px solid currentColor;
		border-bottom: 2px solid currentColor;
		transform: translateY(-0.1rem) rotate(-45deg);
		transition: transform 120ms ease;
	}
	.consent-fold[open] > summary::before {
		transform: translateY(-0.2rem) rotate(45deg);
	}

	/* The lines a choice just rewrote: two pulses, as the element does it. */
	.consent-changed {
		border-radius: 0.2rem;
		animation: consent-changed 900ms ease-in-out 2;
	}
	@keyframes consent-changed {
		0%,
		100% {
			background: transparent;
		}
		50% {
			background: var(--qr-intro-changed, rgba(217, 119, 6, 0.3));
		}
	}

	/* A press on the waiting button points at the tick above it. */
	.consent-nudge {
		animation: consent-nudge 600ms ease-in-out 1;
	}
	@keyframes consent-nudge {
		0%,
		100% {
			transform: none;
		}
		25% {
			transform: translateX(-4px);
		}
		75% {
			transform: translateX(4px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.consent-changed {
			animation: none;
			background: var(--qr-intro-changed, rgba(217, 119, 6, 0.3));
		}
		.consent-nudge {
			animation: none;
		}
	}
</style>
