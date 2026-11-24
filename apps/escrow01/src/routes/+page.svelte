<script>
	import { recall, remember } from '@simple-todo/todo/browser-memory.js';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { createListLink } from '@simple-todo/todo/list-link.js';
	import { t } from '@simple-todo/ui/i18n.js';
	import { derived } from 'svelte/store';
	import { _, locale, json } from '$lib/i18n/index.js';
	import { peerIdStore, initializationStore, ownDidStore } from '$lib/p2p-stores.js';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import OnePasskeyIntro from '$lib/OnePasskeyIntro.svelte';
	import PasskeyWelcomeBack from '$lib/PasskeyWelcomeBack.svelte';
	import LanguageSwitcher from '@simple-todo/ui/LanguageSwitcher.svelte';
	import DidBadge from '$lib/DidBadge.svelte';
	import AuditorView from '$lib/AuditorView.svelte';
	import BalanceCard from '$lib/BalanceCard.svelte';
	import BudgetNotices from '$lib/BudgetNotices.svelte';
	import TechnicalExplanation from '$lib/TechnicalExplanation.svelte';
	import TechnicalToggle from '$lib/TechnicalToggle.svelte';
	import { technicalView } from '$lib/technical-view.js';
	import { formatAmount } from '$lib/budget.js';
	import {
		addTodoWithBudget,
		balanceStore,
		budgetInfo,
		readAmount,
		refreshBalance,
		accountStatusStore,
		prepareBudgetAccount,
		releaseTodoBudget,
		watchPayouts
	} from '$lib/budget-store.js';
	import { shortId } from '@simple-todo/todo/utils.js';
	import {
		createPasskeyCredential,
		hasStoredPasskeyCredential,
		recoverPasskeyCredential
	} from '$lib/passkey-identity.js';
	import {
		todosStore,
		todoDBStore,
		todoDBAddressStore,
		activeListStore,
		ownIdentityIdStore,
		addTodo,
		deleteTodo,
		toggleTodoComplete,
		updateTodoText,
		delegateTodo,
		revokeTodoDelegation,
		loadTodoDatabase,
		openHomeList,
		createPrivateTodoList
	} from '$lib/db-actions.js';
	import { supportsDelegation } from '$lib/delegated-access.js';
	import DelegatedAuthBadge from '$lib/DelegatedAuthBadge.svelte';
	import { formatVersions } from '@simple-todo/todo/build-info.js';
	import ConsentModal from '@simple-todo/ui/ConsentModal.svelte';
	import { NETWORK_ADDRESSES, NETWORK_CHECK } from '@simple-todo/ui/qr-intro-network.js';
	import { clauses as consentClauses, summary as consentSummary } from '$lib/consent-clauses.js';
	import SocialIcons from '@simple-todo/ui/SocialIcons.svelte';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import LocalFirstLink from '@simple-todo/ui/LocalFirstLink.svelte';
	import AppFooter from '@simple-todo/ui/AppFooter.svelte';
	import PageQr from '@simple-todo/ui/PageQr.svelte';
	import ToastNotification from '@simple-todo/ui/ToastNotification.svelte';
	// Between two passkey prompts, what the next one is for (the provider's
	// ./elements). From that entry rather than the root: it is the step module
	// and the element, nothing else.
	import {
		connectPasskeyStepDialog,
		withPasskeySteps,
		PasskeyStepCancelled
	} from '@le-space/orbitdb-identity-provider-webauthn-did/elements';
	import P2PStatusNav from '$lib/P2PStatusNav.svelte';
	import ErrorAlert from '$lib/ErrorAlert.svelte';
	import AddTodoForm from '$lib/AddTodoForm.svelte';
	import TodoList from '$lib/TodoList.svelte';
	import ConnectedPeers from '$lib/ConnectedPeers.svelte';
	import PeerIdCard from '$lib/PeerIdCard.svelte';
	import OwnMultiaddrs from '$lib/OwnMultiaddrs.svelte';
	import SharedListSelector from '$lib/SharedListSelector.svelte';
	import StorageModeSelector from '@simple-todo/ui/StorageModeSelector.svelte';
	import {
		getPersistentStorageEnabled,
		setPersistentStorageEnabled
	} from '@simple-todo/todo/storage-mode.js';
	import { honourStorageChoice } from '@simple-todo/todo/browser-memory.js';

	// This chapter offers the choice, so what the app writes follows it. Said
	// once, at module scope, because the first `recall()` happens in `onMount`
	// before anything renders.
	honourStorageChoice();
	import SharedListDetails from '$lib/SharedListDetails.svelte';
	import PermissionsPanel from '$lib/PermissionsPanel.svelte';
	import OpenDatabaseForm from '$lib/OpenDatabaseForm.svelte';
	import NewPrivateListButton from '$lib/NewPrivateListButton.svelte';
	import ListSwitcher from '$lib/ListSwitcher.svelte';
	import {
		SPANISH_MNEMONIC_STORAGE_KEY,
		generateSpanishMnemonic,
		isValidSpanishMnemonic,
		normalizeSpanishMnemonic
	} from '@simple-todo/todo/spanish-mnemonic.js';
	import ManualConnectForm from '$lib/ManualConnectForm.svelte';
	import { libp2pStore } from '$lib/p2p-stores.js';
	import SectionTabs from '$lib/SectionTabs.svelte';
	import NetworkStatusDot from '$lib/NetworkStatusDot.svelte';
	import ActiveListHeading from '$lib/ActiveListHeading.svelte';
	import { AUDITOR_SECTION, currentSection } from '$lib/sections.js';
	import { etherscanAddress } from '$lib/chain/config.js';
	import {
		RELAY_FAB_POSITION_KEY,
		placeRelayButtonForThisScreen
	} from '$lib/relay-fab-position.js';

	/** @typedef {'default' | 'success' | 'error' | 'warning'} ToastType */
	/** @typedef {{ detail: { text: string, delegateDid?: string | null, delegationExpiresAt?: string | null, budgetAmount?: bigint | null } }} AddTodoEvent */
	/** @typedef {{ detail: { key: string } }} TodoActionEvent */
	/** @typedef {{ detail: { key: string, text: string } }} UpdateTextEvent */
	/** @typedef {{ detail: { key: string, delegateDid: string, expiresAt: string | null } }} DelegateEvent */

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;
	const IDENTITY_MODE_KEY = 'simpleTodo.identityMode';

	/**
	 * Whether somebody comes back with a passkey already linked to this device.
	 * A passkey is linked only after the consent dialog was accepted, so this is
	 * also the one trace of that acceptance that "in memory only" leaves behind.
	 * Those people get the short passkey step instead of the dialog.
	 */
	function returningWithPasskey() {
		try {
			return recall(IDENTITY_MODE_KEY) === 'passkey' || hasStoredPasskeyCredential();
		} catch {
			return false;
		}
	}

	/** Whether the last start on this device was deliberately without a passkey. */
	function lastStartWasAnonymous() {
		try {
			return recall(IDENTITY_MODE_KEY) === 'anon';
		} catch {
			return false;
		}
	}

	const welcomeBack = returningWithPasskey();

	/*
		A first start creates a passkey: paying is what this demo shows, and only a
		passkey session can lock a budget. Somebody who chose to go without one
		last time keeps that choice; somebody with a linked passkey is asked for it.
	*/
	/** @type {'create' | 'existing' | 'anonymous'} */
	let identityMode = welcomeBack ? 'existing' : lastStartWasAnonymous() ? 'anonymous' : 'create';
	// Only a label in the passkey picker, so a sensible one is filled in rather
	// than a required field nobody expected on the way to "Start".
	let passkeyLabel = get(_)('consent.identityLabelDefault');

	/** @type {any} The <passkey-step-dialog> on this page. */
	let passkeyStepDialog;

	onMount(() => {
		// E2E builds: the virtual authenticator needs no word in between, and
		// every spec that creates a passkey would have to click through it. The
		// spec for the dialog asks for it (e2e/passkey-steps.spec.js).
		if (
			import.meta.env.VITE_E2E === 'true' &&
			!(/** @type {any} */ (globalThis).__simpleTodoPasskeySteps)
		) {
			return;
		}
		return connectPasskeyStepDialog(passkeyStepDialog);
	});

	/**
	 * How many passkey prompts a start takes, counted in
	 * e2e/passkey-restore.spec.js: a new passkey three (the passkey, the PRF
	 * output its signing key comes from, the identity signature), one found
	 * on the authenticator three (two touches, then the signature), one this
	 * device keeps one (the signature). Every prompt after the first gets a
	 * word on what it is for.
	 *
	 * @param {'create' | 'existing' | 'anonymous'} mode
	 * @returns {number | null} null without a passkey
	 */
	function passkeyPromptsFor(mode) {
		if (mode === 'create') return 3;
		if (mode === 'existing') return hasStoredPasskeyCredential() ? 1 : 3;
		return null;
	}

	// The short passkey step, and what it shows while and after it asks.
	let showWelcome = welcomeBack;
	let welcomeBusy = false;
	/** @type {string | null} */
	let welcomeError = null;

	/** @type {string | null} */
	let toastMessage = null;
	/** @type {ToastType} */
	let toastType = 'default';
	/** @type {string | null} */
	let error = null;
	/*
		Seeded from the stored preference, not from a literal. With `bind:mode`
		the parent's initial value wins, so a hard-coded 'memory' here overwrote
		what the person chose last time — and the selector's reactive write then
		persisted that overwrite. A reload silently moved everyone back to
		in-memory, which is exactly the failure the storage choice exists to fix.
	*/
	/*
		escrow01 starts at "keep it in this browser", and it can be unticked.
		The start opens a list of one's own; kept only in memory, a new tab would
		not find it again and a person without a passkey would get a new identity
		and a new list on every reload.

		A choice made earlier still wins. "In memory only" is stored as *nothing*
		(see `storage-mode.js`), so it cannot be told apart from never having
		been asked -- except where this browser also carries a remembered
		consent, the one case where the dialog does not come back to ask. There
		the earlier answer stands. Same rule as invoice01.
	*/
	/** @type {'memory' | 'indexeddb'} As `StorageModeSelector` declares it. */
	let storageMode = getPersistentStorageEnabled()
		? 'indexeddb'
		: recall(CONSENT_KEY) === 'true'
			? 'memory'
			: 'indexeddb';
	/** @type {string | null} */
	let myPeerId = null;
	let selectedMnemonic = '';
	let activeMnemonic = '';

	// The open list travels in the URL fragment — `#list=` for the three words,
	// `#db=` for one list by its address — so a link, or the page QR, opens the
	// same list on another device. Words from a link go through the dialog like
	// typed ones: the reader sees which list it is before joining it.
	const listLink = createListLink({
		openWords: (words) => {
			selectedMnemonic = words;
			linkedWords = words;
			showWelcome = false;
			showModal = true;
		},
		openAddress: openLinkedList
	});
	onMount(() => listLink.listen());

	/** @param {string} address */
	async function openLinkedList(address) {
		try {
			await loadTodoDatabase(address);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			showToast(
				get(t)('ui.listLink.openFailed', 'The list from the link could not be opened: {reason}', {
					reason
				}),
				'error'
			);
		}
	}

	$: if ($initializationStore.isInitialized && activeMnemonic) {
		listLink.show(
			$activeListStore.kind === 'shared'
				? { words: activeMnemonic }
				: { address: $activeListStore.address || $todoDBAddressStore }
		);
	}
	$: mnemonicValid = isValidSpanishMnemonic(selectedMnemonic);

	// Modal state
	let showModal = !welcomeBack;
	let rememberDecision = false;
	/**
	 * The list a link brought, named on the dialog's first screen: the short
	 * form keeps the share code under "Advanced", and a reader should see which
	 * list they are about to join without opening it.
	 *
	 * @type {string | null}
	 */
	let linkedWords = null;
	/** Opens the dialog on its settings, for "change the list". */
	let consentOpensAdvanced = false;

	$: readyHint =
		identityMode === 'create'
			? $_('consent.readyCreate')
			: identityMode === 'existing'
				? $_('consent.readyExisting')
				: $_('consent.readyAnonymous');

	/**
	 * A choice the person made that cannot be carried out — no passkey behind
	 * "use an existing one", an unnamed new one. Separated from a genuine
	 * startup failure because the two need different words: this one is
	 * answered by choosing differently, and prefixing it with "P2P" only hides
	 * that.
	 */
	class IdentityChoiceError extends Error {}

	/**
	 * The passkey binds the identity only as far as the authenticator lets it.
	 *
	 * `ensureDerivedSigningKey` derives the OrbitDB signing key from the
	 * credential's PRF output, which is what makes the same passkey produce the
	 * same identity document everywhere. Without PRF it is never fatal: the
	 * keystore generates its own key, the DID stays the same, and the public
	 * key differs per device. The provider logs one debug line, so nothing
	 * reaches the person it affects. This does.
	 *
	 * @param {any} credential
	 */
	function warnIfIdentityCannotTravel(credential) {
		if (!credential || credential.extensionSupport?.prf !== false) return;
		const seen = `simpleTodo.prfWarned.${credential.credentialId ?? 'unknown'}`;
		try {
			if (recall(seen) === 'true') return;
			remember(seen, 'true');
		} catch {
			// No storage: warn every time rather than not at all.
		}
		// A page cannot see GrapheneOS, nor whether Play Services exist. It can
		// see Android, and on Android a passkey without PRF is exactly that case:
		// no CTAP2 over NFC without a credential provider, or a provider
		// (Passchain) that answers no PRF. The hint names the fix;
		// docs/grapheneos.md has the rest.
		if (onAndroid()) {
			showToast($_('consent.prfMissingAndroid'), 'warning', 20_000);
			return;
		}
		showToast($_('consent.prfMissing'), 'warning', 12_000);
	}

	/** Android as the browser reports it — Vanadium presents as Chrome on Android. */
	function onAndroid() {
		const data = /** @type {any} */ (navigator).userAgentData;
		return data?.platform === 'Android' || /\bAndroid\b/.test(navigator.userAgent);
	}

	const handleModalClose = () => start('dialog');

	/** The short passkey step's button: the same start, with the passkey linked here. */
	async function continueWithPasskey() {
		if (welcomeBusy) return;
		welcomeBusy = true;
		welcomeError = null;
		identityMode = 'existing';
		await start('welcome');
		welcomeBusy = false;
	}

	/** From the short passkey step to the full dialog. */
	function openFullConsent() {
		showWelcome = false;
		showModal = true;
	}

	/**
	 * Start with what was chosen. `from` says where the press came from, so a
	 * failure is shown there: the short passkey step keeps its own error rather
	 * than turning into the full dialog it was meant to spare.
	 *
	 * @param {'dialog' | 'welcome'} from
	 */
	async function start(from) {
		// The dialog shows this now, so a stale one would accuse the attempt that
		// is only just starting.
		error = null;
		const canonicalMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
		// escrow01: words somebody *chose* mean that shared list -- a link brought
		// them, the dialog was opened to open a shared list, or other words were
		// typed under "Advanced". Asked before the words are remembered below,
		// which would make every choice look like this browser's own.
		const wordsChosen =
			linkedWords !== null || consentOpensAdvanced || canonicalMnemonic !== storedMnemonic();
		// Held from before the start, not from when the home list begins to open:
		// in between, the form would be enabled on the shared list for a moment,
		// and a todo written then would vanish with the switch.
		homeListOpening = !wordsChosen && !addressFromLink;
		// Now, not when the dialog appeared: the storage choice is only a choice
		// once somebody proceeds with it. The selector writes it only when it is
		// clicked, so a preselected "keep it" stayed in memory without this.
		// After `storedMnemonic()` above, which has to read where the words were
		// kept *before* the choice moves them.
		setPersistentStorageEnabled(storageMode === 'indexeddb');
		// Both describe how the dialog was opened this time, not the next time.
		consentOpensAdvanced = false;
		linkedWords = null;
		selectedMnemonic = canonicalMnemonic;
		try {
			remember(SPANISH_MNEMONIC_STORAGE_KEY, canonicalMnemonic);
			if (rememberDecision) {
				remember(CONSENT_KEY, 'true');
			}
		} catch {
			// ignore storage errors
		}
		const startedAs = identityMode;
		const prompts = passkeyPromptsFor(identityMode);
		try {
			// Numbered when there is a passkey: its later prompts each get a word
			// on what they are for, and start from the click that answers it.
			const begin = () => beginWith(from, canonicalMnemonic, wordsChosen);
			await (prompts === null ? begin() : withPasskeySteps(prompts, begin));
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			let message =
				err instanceof IdentityChoiceError
					? reason
					: $_('consent.errorStart', { values: { reason } });
			if (err instanceof PasskeyStepCancelled) {
				// Stopped between two prompts. A passkey created before the stop
				// exists now: going on with it, not making a second one.
				message =
					startedAs === 'create'
						? $_('consent.errorStepCancelledCreated')
						: $_('consent.errorStepCancelled');
				if (startedAs === 'create') identityMode = 'existing';
			}
			if (from === 'welcome' && showWelcome) {
				welcomeError = message;
			} else {
				showModal = true;
				error = message;
			}
			homeListOpening = false;
			console.error('P2P initialization failed:', err);
		}
	}

	/**
	 * The start itself: the identity, then the network.
	 *
	 * @param {'dialog' | 'welcome'} from
	 * @param {string} canonicalMnemonic
	 * @param {boolean} wordsChosen escrow01: open that shared list, not one's own
	 */
	async function beginWith(from, canonicalMnemonic, wordsChosen) {
		// Resolve the identity choice first — WebAuthn calls must run inside
		// the user gesture of the proceed click.
		let passkeyCredential = null;
		if (identityMode === 'create') {
			if (!passkeyLabel.trim()) {
				throw new IdentityChoiceError($_('consent.errorNeedsLabel'));
			}
			// The same label goes into both WebAuthn fields on purpose: they are
			// the account name and the display name of one credential, and the
			// picker shows them together. Neither identifies the passkey.
			passkeyCredential = await createPasskeyCredential({
				userId: passkeyLabel.trim(),
				displayName: passkeyLabel.trim()
			});
		} else if (identityMode === 'existing') {
			passkeyCredential = await recoverPasskeyCredential();
			if (!passkeyCredential) {
				throw new IdentityChoiceError($_('consent.errorNoPasskey'));
			}
		}
		try {
			remember(IDENTITY_MODE_KEY, passkeyCredential ? 'passkey' : 'anon');
		} catch {
			// ignore storage errors
		}
		// The passkey answered; what follows is the app starting, which the
		// page behind shows better than a step that says "waiting for passkey".
		if (from === 'welcome') showWelcome = false;

		if ($initializationStore.isInitialized) {
			await restartP2PLazy({ todoDbName: canonicalMnemonic });
		} else {
			await startP2P({ todoDbName: canonicalMnemonic, passkeyCredential });
		}
		activeMnemonic = canonicalMnemonic;
		void openStartList(wordsChosen);
		warnIfIdentityCannotTravel(passkeyCredential);
	}

	// Loaded on demand, not at page load. `p2p.js` pulls libp2p, Helia, OrbitDB
	// and gossipsub, and none of it is needed to render the consent dialog —
	// the only thing on screen until the user agrees.
	async function startP2P(/** @type {any} */ options) {
		void loadSponsorFab();
		const { initializeP2P } = await import('$lib/p2p.js');
		await initializeP2P(options);
	}

	async function restartP2PLazy(/** @type {any} */ options) {
		const { restartP2P } = await import('$lib/p2p.js');
		await restartP2P(options);
	}

	// The largest single thing this app ships, and the whole Aleph deployment
	// machinery rides with it. It lives inside the network panel behind the
	// consent dialog, so a static import made every visitor download a relay
	// deployer before they could read the dialog.
	/** @type {any} */
	let SponsorRelayFab = null;
	async function loadSponsorFab() {
		if (SponsorRelayFab) return;
		const component = (await import('@le-space/ui/svelte')).default;
		// Read once, when the launcher mounts: on a phone it starts above the tab
		// bar rather than on top of it.
		placeRelayButtonForThisScreen();
		SponsorRelayFab = component;
	}

	onMount(async () => {
		try {
			selectedMnemonic = listLink.initial.words ?? loadOrGenerateMnemonic();
			linkedWords = listLink.initial.words ?? null;
			if (listLink.initial.rejected.length > 0) {
				showToast(
					get(t)(
						'ui.listLink.rejected',
						'The link names a list this page cannot open, so it starts with its own.'
					),
					'warning'
				);
			}
			// Asked of the credential rather than of a remembered flag: the flag is
			// something kept, and memory mode keeps nothing -- while the passkey
			// link is what actually decides whether there is an identity to come
			// back to (#9).
			// A WebAuthn prompt needs a user gesture, so a remembered passkey session
			// cannot auto-start: it gets the short passkey step (`welcomeBack`).
			if (!welcomeBack && recall(CONSENT_KEY) === 'true') {
				showModal = false;
				activeMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
				homeListOpening = linkedWords === null && !addressFromLink;
				await startP2P({ todoDbName: activeMnemonic, passkeyCredential: null });
				void openStartList(linkedWords !== null);
			}
		} catch {
			// ignore storage errors -- but do not leave the form locked for a home
			// list that is now never going to open
			homeListOpening = false;
		}
	});

	/** This browser's own three words, as last kept -- or null. */
	function storedMnemonic() {
		try {
			const saved = recall(SPANISH_MNEMONIC_STORAGE_KEY);
			return saved && isValidSpanishMnemonic(saved) ? normalizeSpanishMnemonic(saved) : null;
		} catch {
			return null;
		}
	}

	/**
	 * An address the page was opened with is followed once, on the first start.
	 * A later restart -- another identity, another storage choice -- goes back
	 * to one's own list instead of to a link that has already been followed.
	 */
	let addressFromLink = listLink.initial.address;
	let homeListOpening = false;
	let privateListBusy = false;

	/**
	 * escrow01: which list the start ends in.
	 *
	 * The shared list named by the three words is open by now -- `initializeP2P`
	 * opens it, as before, and it stays open for whoever arrives with the same
	 * words. What changes is the list on screen:
	 *
	 * - words from a link, or typed under "Advanced": that shared list;
	 * - an address from a link: that list;
	 * - otherwise one's own private list, because delegation and budgets --
	 *   what this chapter is about -- exist only there.
	 *
	 * @param {boolean} wordsChosen
	 */
	async function openStartList(wordsChosen) {
		if (wordsChosen || addressFromLink) {
			homeListOpening = false;
			addressFromLink = null;
			await listLink.openLinked();
			return;
		}
		homeListOpening = true;
		try {
			await openHomeList($_('lists.home.name'));
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			showToast($_('lists.home.openFailed', { values: { reason } }), 'error', 6000);
		} finally {
			homeListOpening = false;
		}
	}

	/** From the hint on a shared list: a private list, opened right away. */
	async function handleCreatePrivateList() {
		privateListBusy = true;
		try {
			await createPrivateTodoList($_('lists.home.name'));
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			showToast($_('lists.home.openFailed', { values: { reason } }), 'error', 6000);
		} finally {
			privateListBusy = false;
		}
	}

	function loadOrGenerateMnemonic() {
		try {
			const saved = recall(SPANISH_MNEMONIC_STORAGE_KEY);
			if (saved && isValidSpanishMnemonic(saved)) return normalizeSpanishMnemonic(saved);
		} catch {
			// Continue with an in-memory mnemonic when browser storage is unavailable.
		}
		const generated = generateSpanishMnemonic();
		try {
			remember(SPANISH_MNEMONIC_STORAGE_KEY, generated);
		} catch {
			// The generated value remains usable for this session.
		}
		return generated;
	}

	/**
	 * @param {string} message
	 * @param {ToastType} [type='default']
	 */
	/** @type {ReturnType<typeof setTimeout> | null} */
	let toastTimer = null;
	let toastDuration = 3000;

	/**
	 * Three seconds fits "Todo added". It does not fit two sentences about what
	 * an authenticator cannot do, so the duration is the caller's to say.
	 *
	 * @param {string} message
	 * @param {ToastType} [type]
	 * @param {number} [duration] milliseconds on screen
	 */
	function showToast(message, type = 'default', duration = 3000) {
		toastMessage = message;
		toastType = type;
		// The component auto-hides on its own timer, so it has to hear the same
		// number — otherwise it disappears after its default three seconds.
		toastDuration = duration;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toastMessage = null;
			toastTimer = null;
		}, duration);
	}

	/**
	 * @param {AddTodoEvent} event
	 */
	const handleAddTodo = async (event) => {
		const { text, delegateDid, delegationExpiresAt, budgetAmount } = event.detail;
		// escrow01: with a budget, the todo is written "being locked" and the lock
		// follows; how it went shows on the row and in the notices, not here.
		const result =
			delegateDid && budgetAmount
				? await addTodoWithBudget({
						text,
						delegateDid,
						expiresAt: delegationExpiresAt ?? null,
						amount: budgetAmount
					})
				: await addTodo(text, null, {
						delegateDid: delegateDid ?? null,
						expiresAt: delegationExpiresAt ?? null
					});
		if (result.ok) {
			showToast(delegateDid ? $_('todo.toast.addedDelegated') : $_('todo.toast.added'), 'success');
		} else {
			showToast(`❌ ${result.error ?? $_('todo.toast.addFailed')}`, 'error');
		}
	};

	/** @param {TodoActionEvent} event */
	const handleReleaseBudget = async (event) => {
		await releaseTodoBudget(event.detail.key);
	};

	/**
	 * A budget paid out to this session while it was watching (escrow01).
	 *
	 * @param {import('$lib/db-actions.js').TodoItem} todo
	 */
	async function announcePayout(todo) {
		const from = shortId(todo.createdByIdentity ?? '');
		const todoRef = todo.budget?.todoRef;
		const amount =
			todoRef && todo.createdByIdentity ? await readAmount(todo.createdByIdentity, todoRef) : null;
		showToast(
			amount?.state === 'ready' && amount.units !== null
				? $_('budget.toast.received', {
						values: {
							amount: formatAmount(amount.units, {
								decimals: budgetInfo.token.decimals,
								locale: $locale ?? 'en'
							}),
							token: budgetInfo.token.symbol,
							from
						}
					})
				: $_('budget.toast.receivedHidden', { values: { from } }),
			'success',
			6000
		);
		void refreshBalance();
		// On Sepolia the public node that answers can still be a block behind the
		// payout and hand back the old balance; a block later it has caught up.
		if (budgetInfo.kind === 'zama') setTimeout(() => void refreshBalance(), 15_000);
	}

	onMount(() => watchPayouts((todo) => void announcePayout(todo)));

	// On Sepolia a passkey session gets its account in the background, once per
	// DID: one sponsored user operation, no prompt.
	onMount(() => {
		if (budgetInfo.kind !== 'zama') return;
		/** @type {string | null} */
		let preparedFor = null;
		return derived([initializationStore, ownDidStore], ([$initialization, $did]) =>
			$initialization.isInitialized ? $did : null
		).subscribe((did) => {
			if (!did || did === preparedFor) return;
			preparedFor = did;
			void prepareBudgetAccount();
		});
	});

	/*
		escrow01's sections: the todos first, the lists, the account and the
		network behind tabs, and the auditor view without a tab of its own. Like
		the auditor view before them, sections of this page rather than routes:
		this page owns the consent dialog and the P2P start, and a navigation away
		and back would mount it again and start both over. The fragment says which
		one is open, so `#pruefstelle` still opens the page on the auditor view.
	*/
	$: auditorOpen = $currentSection === AUDITOR_SECTION;

	// A section opens at its top. Otherwise it opens wherever the last one was
	// scrolled to, which on a phone is often below everything the new one holds.
	onMount(() => {
		let first = true;
		return currentSection.subscribe(() => {
			if (!first) window.scrollTo({ top: 0 });
			first = false;
		});
	});

	// What this build is made of — versions and branch — in the technical view.
	// When it was built, and from which commit, the footer says on every tab.
	const buildStamp = `${formatVersions({ appName: 'Simple-Todo' })} · ${
		typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'local'
	}`;

	// A budget is paid to the delegate, so it exists only where delegation does,
	// and only for a session the service can sign for.
	$: budgetEnabled = delegationEnabled && (!budgetInfo.requiresPasskey || Boolean($ownDidStore));
	$: budgetsInList = $todosStore.some((todo) => todo.budget && todo.budget.status !== 'none');
	// The starting funds are a sentence about *this* account, so it stops being
	// true the moment the account holds anything -- a recipient's balance comes
	// from a payout, and telling them the first lock will mint them 1,000.00
	// reads as an explanation of the number above it. Unknown counts as empty:
	// before the first read there is nothing to contradict.
	$: showFundingHint = !($balanceStore.state === 'ready' && ($balanceStore.units ?? 0n) > 0n);
	// The balance appears where the storyboard has it: once a budget was paid
	// out to this session. On Sepolia the account holds real test money from its
	// first lock, so it shows as soon as the account is there.
	$: showBalance =
		budgetInfo.kind === 'zama'
			? $accountStatusStore.phase === 'ready'
			: Boolean($ownIdentityIdStore) &&
				$todosStore.some(
					(todo) =>
						todo.budget?.status === 'released' &&
						todo.delegation?.delegateDid === $ownIdentityIdStore
				);

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			showToast($_('todo.toast.deleted'), 'success');
		} else {
			showToast($_('todo.toast.deleteFailed'), 'error');
		}
	};

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleToggleComplete = async (event) => {
		const result = await toggleTodoComplete(event.detail.key);
		if (result.ok) {
			showToast($_('todo.toast.statusUpdated'), 'success');
		} else {
			showToast(`❌ ${result.error ?? $_('todo.toast.updateFailed')}`, 'error');
		}
	};

	/** @param {UpdateTextEvent} event */
	const handleUpdateText = async (event) => {
		const result = await updateTodoText(event.detail.key, event.detail.text);
		showToast(
			result.ok ? $_('todo.toast.renamed') : `❌ ${result.error ?? $_('todo.toast.renameFailed')}`,
			result.ok ? 'success' : 'error'
		);
	};

	/** @param {DelegateEvent} event */
	const handleDelegate = async (event) => {
		const { key, delegateDid, expiresAt } = event.detail;
		const result = await delegateTodo(key, { delegateDid, expiresAt });
		showToast(
			result.ok
				? $_('todo.toast.delegated')
				: `❌ ${result.error ?? $_('todo.toast.delegateFailed')}`,
			result.ok ? 'success' : 'error'
		);
	};

	/** @param {TodoActionEvent} event */
	const handleRevokeDelegation = async (event) => {
		const result = await revokeTodoDelegation(event.detail.key);
		showToast(
			result.ok ? $_('todo.toast.revoked') : `❌ ${result.error ?? $_('todo.toast.revokeFailed')}`,
			result.ok ? 'success' : 'error'
		);
	};

	// delegation01: the shared mnemonic list (IPFS controller) cannot take
	// delegations; private lists and lists opened by address can.
	$: delegationEnabled = supportsDelegation($todoDBStore);

	/**
	 * @param {{ detail: { status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string } }} event
	 */
	const handleManualConnect = (event) => {
		const peerTarget = event.detail.remotePeer || event.detail.remoteAddr;

		if (event.detail.status === 'stable') {
			showToast($_('network.connect.toastConnected', { values: { peer: peerTarget } }), 'success');
			return;
		}

		showToast($_('network.connect.toastDropped', { values: { peer: peerTarget } }), 'warning');
	};

	// Subscribe to the peerIdStore
	$: myPeerId = $peerIdStore;

	let connectedPeersRef;
</script>

<ToastNotification message={toastMessage} type={toastType} duration={toastDuration} />

<!-- Between two passkey prompts: which one comes, what for, and "Continue". -->
<passkey-step-dialog bind:this={passkeyStepDialog} lang={$locale ?? 'en'}></passkey-step-dialog>

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta
		name="description"
		content="A simple local-first peer-to-peer TODO list app using OrbitDB, IPFS and libp2p"
	/>
</svelte:head>

<!--
	The way in. Somebody back with a passkey linked to this device gets the
	short step that asks for it; everybody else, and anybody who asks for more
	from that step, gets the dialog.
-->
{#if showWelcome}
	<PasskeyWelcomeBack
		busy={welcomeBusy}
		error={welcomeError}
		on:continue={continueWithPasskey}
		on:more={openFullConsent}
	/>
{/if}

{#if showModal}
	<!--
		The short form (`summary`): what this is for, four sentences about the
		data, the full statement and the settings each one click away, and the
		acceptance directly above "Start". The settings keep their defaults.
	-->
	<ConsentModal
		bind:show={showModal}
		bind:rememberDecision
		choices={{ identity: identityMode, storage: storageMode }}
		clauses={consentClauses}
		summary={consentSummary}
		{readyHint}
		advancedOpen={consentOpensAdvanced}
		elementStrings={$json('consent.element')}
		bind:technical={$technicalView}
		hideSections={[NETWORK_CHECK, NETWORK_ADDRESSES]}
		canProceed={mnemonicValid}
		{error}
		on:proceed={handleModalClose}
	>
		<svelte:fragment slot="header"><LanguageSwitcher /></svelte:fragment>
		<svelte:fragment slot="before-confirmation">
			<OnePasskeyIntro confidential={budgetInfo.confidential} />
			{#if linkedWords}
				<p
					class="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text"
					data-testid="consent-linked-list"
				>
					{$_('consent.linkedList', { values: { words: linkedWords } })}
				</p>
			{/if}
		</svelte:fragment>
		<!--
			"Create a passkey" is the default, and in memory mode the page cannot
			tell a first visit from a return: nothing is kept. Somebody who already
			has a passkey for this demo must not create a second identity by
			pressing "Start", so the other way is right beside it.
		-->
		<svelte:fragment slot="beside-start">
			{#if identityMode === 'create' || identityMode === 'existing'}
				<button
					type="button"
					on:click={() => (identityMode = identityMode === 'create' ? 'existing' : 'create')}
					data-testid="consent-switch-passkey"
					class="mt-1 text-left text-xs text-text underline underline-offset-2 hover:text-heading"
				>
					{identityMode === 'create' ? $_('consent.useExisting') : $_('consent.useNew')}
				</button>
			{/if}
		</svelte:fragment>
		<svelte:fragment slot="advanced">
			<StorageModeSelector bind:mode={storageMode} />
			<SharedListSelector bind:value={selectedMnemonic} />
			<PasskeyOnboarding bind:mode={identityMode} bind:label={passkeyLabel} />
		</svelte:fragment>
	</ConsentModal>
{/if}

<main class="container mx-auto max-w-4xl px-4 pt-4 pb-28 sm:px-6 sm:pt-6 sm:pb-6">
	<!--
		What stays on screen on every tab: the app, the network's state as a dot
		(a link to the network tab), the language and the technical view — the
		switches somebody presenting reaches for while they talk.

		A grid, so a phone gets two short rows instead of three wrapped ones: the
		title and the switches on the first, the state on the second. From `sm` on,
		all three share one row.
	-->
	<header
		class="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:mb-6 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
	>
		<div class="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
			<LocalFirstLink size={44} />
			<div class="min-w-0">
				{#if auditorOpen}
					<h1 class="truncate text-xl font-bold text-heading sm:text-3xl">
						{$_('budget.auditor.title')}
					</h1>
					<p class="mt-1 text-sm text-faint">
						{$_('budget.auditor.escrow')}
						<code class="font-mono text-xs" title={budgetInfo.escrow}
							>{shortId(budgetInfo.escrow)}</code
						>
					</p>
				{:else}
					<!-- The full name everywhere but on a phone, where the switches beside it
					     leave room for one word; the heading's name stays the full one. -->
					<h1
						class="truncate text-xl font-bold text-heading sm:text-3xl"
						aria-label={$_('header.title')}
					>
						<span class="sm:hidden" aria-hidden="true">{$_('header.titleShort')}</span>
						<span class="hidden sm:inline" aria-hidden="true">{$_('header.title')}</span>
					</h1>
					<!-- On a phone the list's name is the better use of the line. -->
					<p class="mt-0.5 hidden text-sm text-faint sm:block" data-testid="app-tagline">
						{$_('header.tagline')}
					</p>
				{/if}
			</div>
		</div>
		<div
			class="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end"
		>
			<DelegatedAuthBadge />
			{#if auditorOpen}
				<DidBadge did={budgetInfo.auditor} label={$_('budget.auditor.role')} />
				<a
					href="#aufgaben"
					data-testid="auditor-view-close"
					class="rounded-md px-2 py-1 text-xs font-medium text-cyan-800 no-underline hover:underline dark:text-cyan"
					>{$_('header.backToTodos')}</a
				>
			{/if}
			<NetworkStatusDot />
		</div>
		<div class="col-start-2 row-start-1 flex items-center gap-1 sm:col-start-3 sm:gap-2">
			<LanguageSwitcher />
			<PageQr />
			<TechnicalToggle />
		</div>
	</header>

	<SectionTabs />

	{#if !showModal && (error || $initializationStore.error)}
		<!-- `error` is already a sentence; the store holds the stack's bare reason. -->
		<ErrorAlert
			error={error ||
				$_('consent.errorStart', { values: { reason: $initializationStore.error ?? '' } })}
			dismissible={true}
		/>
	{/if}

	{#if auditorOpen}
		<AuditorView />
	{/if}

	<!--
		Every section stays mounted and is only hidden: the network panel and the
		forms hold state that a remount would throw away, and the status panel
		publishes what the header's dot and every todo row's replication proof read.
	-->
	<section
		hidden={$currentSection !== 'aufgaben'}
		aria-label={$_('sections.tab.tasks')}
		data-testid="section-aufgaben"
	>
		{#if $initializationStore.isInitialized}
			<ActiveListHeading mnemonic={activeMnemonic} />
		{/if}

		<AddTodoForm
			on:add={handleAddTodo}
			disabled={!$initializationStore.isInitialized || homeListOpening}
			{delegationEnabled}
			{budgetEnabled}
			budgetToken={budgetInfo.token.symbol}
			budgetDecimals={budgetInfo.token.decimals}
			budgetConfidential={budgetInfo.confidential}
			offerPrivateList={$initializationStore.isInitialized && !homeListOpening}
			{privateListBusy}
			on:createPrivateList={handleCreatePrivateList}
		/>

		<BudgetNotices active={budgetsInList || showBalance} />

		<TodoList
			todos={$todosStore}
			currentIdentityId={$ownIdentityIdStore}
			{delegationEnabled}
			on:delete={handleDelete}
			on:toggleComplete={handleToggleComplete}
			on:updateText={handleUpdateText}
			on:delegate={handleDelegate}
			on:revokeDelegation={handleRevokeDelegation}
			on:releaseBudget={handleReleaseBudget}
		/>
	</section>

	<section
		hidden={$currentSection !== 'listen'}
		aria-label={$_('sections.tab.lists')}
		data-testid="section-listen"
	>
		{#if $initializationStore.isInitialized}
			<!-- The open list first: its address, and who may write to it. -->
			{#if activeMnemonic}
				<SharedListDetails
					open
					mnemonic={activeMnemonic}
					databaseAddress={$todoDBAddressStore}
					activeList={$activeListStore}
					on:change={() => {
						selectedMnemonic = activeMnemonic;
						consentOpensAdvanced = true;
						showModal = true;
					}}
				/>
			{/if}
			<PermissionsPanel />
			<ListSwitcher />
			<NewPrivateListButton />
			<OpenDatabaseForm />
		{:else}
			<p class="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text shadow-sm">
				{$_('sections.lists.waiting')}
			</p>
		{/if}
	</section>

	<section
		hidden={$currentSection !== 'konto'}
		aria-label={$_('sections.tab.account')}
		data-testid="section-konto"
	>
		<div
			class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
			data-testid="account-passkey"
		>
			<h2 class="text-sm font-medium text-faint">{$_('sections.account.passkey')}</h2>
			{#if $ownDidStore}
				<div class="mt-2 flex flex-wrap">
					<DidBadge did={$ownDidStore} />
				</div>
				<p class="mt-2 text-xs text-faint">{$_('sections.account.passkeyHint')}</p>
			{:else}
				<p class="mt-1 text-sm text-text">{$_('sections.account.noPasskey')}</p>
			{/if}
		</div>

		{#if budgetInfo.kind === 'zama' && $ownDidStore}
			<div
				class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
				data-testid="account-chain-account"
				data-phase={$accountStatusStore.phase}
			>
				<h2 class="text-sm font-medium text-faint">{$_('sections.account.chainAccount')}</h2>
				{#if $accountStatusStore.phase === 'ready' && $accountStatusStore.address}
					<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
						<code
							class="font-mono text-xs break-all text-heading"
							data-testid="chain-account-address">{$accountStatusStore.address}</code
						>
						<a
							href={etherscanAddress($accountStatusStore.address)}
							target="_blank"
							rel="noopener noreferrer"
							class="text-xs font-medium text-cyan-800 underline-offset-2 hover:underline dark:text-cyan"
							>{$_('sections.account.viewOnEtherscan')}</a
						>
					</p>
					<p class="mt-2 text-xs text-faint">
						{$_('sections.account.accountHint')}
						{#if showFundingHint}
							<span data-testid="account-funding-hint">{$_('sections.account.accountFunding')}</span
							>
						{/if}
					</p>
					<p class="mt-1 text-xs text-faint" data-testid="account-etherscan-hint">
						{$_('sections.account.etherscanHint')}
					</p>
				{:else if $accountStatusStore.phase === 'not-found'}
					<!-- An earlier passkey whose published profile did not arrive in
					     time: an account may exist, so the app asks rather than
					     creating a second one (budget-service-zama.js, ensureAccount). -->
					<p class="mt-1 text-sm text-text" data-testid="chain-account-not-found">
						{$_('sections.account.accountNotFound')}
					</p>
					{#if $technicalView}
						<p class="mt-2 text-xs text-faint">{$_('sections.account.accountNotFoundTechnical')}</p>
					{/if}
					<div class="mt-3 flex flex-wrap gap-2">
						<button
							type="button"
							on:click={() => void prepareBudgetAccount({ intent: 'search' })}
							class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:text-heading"
							data-testid="chain-account-search">{$_('sections.account.accountSearch')}</button
						>
						<button
							type="button"
							on:click={() => void prepareBudgetAccount({ intent: 'create' })}
							class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:text-heading"
							data-testid="chain-account-create">{$_('sections.account.accountCreate')}</button
						>
					</div>
					<p class="mt-2 text-xs text-faint">{$_('sections.account.accountCreateHint')}</p>
				{:else if $accountStatusStore.phase === 'failed'}
					<p class="mt-1 text-sm text-danger-700 dark:text-danger" role="alert">
						{$_('sections.account.accountFailed', {
							values: { reason: $accountStatusStore.error ?? '' }
						})}
					</p>
					<button
						type="button"
						on:click={() => void prepareBudgetAccount()}
						class="mt-3 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:text-heading"
						data-testid="chain-account-retry">{$_('sections.account.accountRetry')}</button
					>
				{:else}
					<p class="mt-1 flex items-center gap-2 text-sm text-text">
						<span
							class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border border-t-cyan-700 dark:border-t-cyan"
							aria-hidden="true"
						></span>
						{$_('sections.account.accountCreating')}
					</p>
				{/if}
			</div>
		{/if}

		<!-- The balance appears where the storyboard has it: once a budget was paid
		     out to this session. -->
		{#if showBalance}
			<BalanceCard />
		{:else}
			<div
				class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
				data-testid="account-balance-waiting"
			>
				<h2 class="text-sm font-medium text-faint">{$_('budget.balance.heading')}</h2>
				<p class="mt-1 text-sm text-text">
					{$_(
						budgetInfo.kind === 'zama'
							? 'sections.account.balanceAfterAccount'
							: 'sections.account.balanceWaiting'
					)}
				</p>
			</div>
		{/if}

		<div
			class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
			data-testid="account-chain"
		>
			<h2 class="text-sm font-medium text-faint">{$_('sections.account.chain')}</h2>
			<span
				class="mt-2 inline-block rounded-md border px-2 py-1 text-xs font-medium {budgetInfo.network ===
				'demo'
					? 'border-data-400 bg-data-100 text-data-800 dark:border-data/40 dark:bg-data/10 dark:text-data'
					: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan/40 dark:bg-cyan/10 dark:text-cyan'}"
				data-testid="budget-network"
				data-network={budgetInfo.network}
				>{budgetInfo.network === 'demo'
					? $_('budget.network.demo')
					: $_('budget.network.sepolia')}</span
			>
			<!-- What "Demo ohne Chain" means, and the real run it stands in for. -->
			{#if budgetInfo.network === 'demo'}
				<p class="mt-2 text-sm text-text">{$_('budget.network.demoTitle')}</p>
				<TechnicalExplanation step="demo" collapsible className="mt-3" />
			{/if}
		</div>

		<div
			class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
			data-testid="account-auditor"
		>
			<h2 class="text-sm font-medium text-faint">{$_('sections.account.auditor')}</h2>
			<p class="mt-1 text-sm text-text">{$_('sections.account.auditorHint')}</p>
			<a
				href="#pruefstelle"
				data-testid="auditor-view-open"
				class="mt-3 inline-block rounded-md border border-cyan-200 px-3 py-1.5 text-sm font-medium text-cyan-800 no-underline hover:bg-cyan-50 dark:border-cyan/40 dark:text-cyan dark:hover:bg-cyan/10"
				>{$_('sections.account.auditorOpen')}</a
			>
		</div>
	</section>

	<section
		hidden={$currentSection !== 'netzwerk'}
		aria-label={$_('sections.tab.network')}
		data-testid="section-netzwerk"
	>
		<P2PStatusNav initialization={$initializationStore} libp2p={$libp2pStore} peerId={myPeerId}>
			<ManualConnectForm
				compact
				disabled={!$initializationStore.isInitialized}
				on:connected={handleManualConnect}
			/>
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
	</section>

	<AppFooter />
</main>

<!--
	Floating Relay Button FAB.

	Draggable, because it floats over the bottom-right corner, and on a phone
	the todo rows scroll underneath it. The key is passed explicitly: the
	component stores nothing unless asked, and the key keeps this chapter's
	`simpleTodo.` prefix. On a phone it starts above the tab bar
	(relay-fab-position.js).

	Shown in both views, as in the other chapters: the Relay Button belongs to
	the app, not to the plumbing the simple view leaves out. The widget has no
	way to take this page's language, so its label stays English.
-->
{#if SponsorRelayFab}
	<svelte:component
		this={SponsorRelayFab}
		manifestUrl="./rootfs-manifest.json"
		showInstances={true}
		draggable={true}
		positionStorageKey={RELAY_FAB_POSITION_KEY}
	/>
{/if}
