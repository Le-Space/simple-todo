<script>
	import { recall, remember } from '@simple-todo/todo/browser-memory.js';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { createListLink } from '@simple-todo/todo/list-link.js';
	import { t } from '@simple-todo/ui/i18n.js';
	import { derived } from 'svelte/store';
	import { _, locale, json } from '$lib/i18n/index.js';
	import { initializationStore, ownDidStore } from '$lib/p2p-stores.js';
	import OnePasskeyIntro from '$lib/OnePasskeyIntro.svelte';
	import StartChoices from '$lib/StartChoices.svelte';
	import KeepInBrowser from '$lib/KeepInBrowser.svelte';
	import JoinSharedList from '$lib/JoinSharedList.svelte';
	import BudgetIcon from '$lib/BudgetIcon.svelte';
	import DemoVideoButton from '$lib/DemoVideoButton.svelte';
	import DemoVideoPlayer from '$lib/DemoVideoPlayer.svelte';
	import PasskeyWelcomeBack from '$lib/PasskeyWelcomeBack.svelte';
	import LanguageSwitcher from '@simple-todo/ui/LanguageSwitcher.svelte';
	import AuditorView from '$lib/AuditorView.svelte';
	import BudgetNotices from '$lib/BudgetNotices.svelte';
	import { technicalView } from '$lib/technical-view.js';
	import { formatAmount } from '$lib/budget.js';
	import {
		addTodoWithBudget,
		budgetInfo,
		readAmount,
		refreshBalance,
		accountStatusStore,
		prepareBudgetAccount,
		releaseTodoBudget,
		watchPayouts
	} from '$lib/budget-store.js';
	import { shortId } from '@simple-todo/todo/utils.js';
	import { createPasskeyCredential, recoverPasskeyCredential } from '$lib/passkey-identity.js';
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
		createPrivateTodoList,
		homeListPendingStore
	} from '$lib/db-actions.js';
	import { openHomeList } from '$lib/home-list.js';
	import { supportsDelegation } from '$lib/delegated-access.js';
	import ConsentModal from '@simple-todo/ui/ConsentModal.svelte';
	import { NETWORK_ADDRESSES, NETWORK_CHECK } from '@simple-todo/ui/qr-intro-network.js';
	import { clauses as consentClauses, summary as consentSummary } from '$lib/consent-clauses.js';
	import AppFooter from '@simple-todo/ui/AppFooter.svelte';
	import ToastNotification from '@simple-todo/ui/ToastNotification.svelte';
	// Between two passkey prompts, what the next one is for (the provider's
	// ./elements). From that entry rather than the root: it is the step module
	// and the element, nothing else.
	import {
		connectPasskeyStepDialog,
		withPasskeySteps,
		PasskeyStepCancelled
	} from '@le-space/orbitdb-identity-provider-webauthn-did/elements';
	import ErrorAlert from '$lib/ErrorAlert.svelte';
	import AddTodoForm from '$lib/AddTodoForm.svelte';
	import TodoList from '$lib/TodoList.svelte';
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
		IDENTITY_MODE_KEY,
		identityTravelWarning,
		lastStartWasAnonymous,
		passkeyPromptsFor,
		returningWithPasskey
	} from '$lib/start/identity.js';
	import {
		cameBackToThisAddress,
		loadOrGenerateMnemonic,
		storedMnemonic
	} from '$lib/start/three-words.js';
	import {
		SPANISH_MNEMONIC_STORAGE_KEY,
		isValidSpanishMnemonic,
		normalizeSpanishMnemonic
	} from '@simple-todo/todo/spanish-mnemonic.js';
	import SectionTabs from '$lib/SectionTabs.svelte';
	import AppHeader from '$lib/sections/AppHeader.svelte';
	import AccountSection from '$lib/sections/AccountSection.svelte';
	import NetworkSection from '$lib/sections/NetworkSection.svelte';
	import ActiveListHeading from '$lib/ActiveListHeading.svelte';
	import { AUDITOR_SECTION, currentSection } from '$lib/sections.js';
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
		escrow01 starts at "Keep in this browser", and it can be unticked: the
		todos and the list survive a reload, and somebody with a passkey comes
		back to one tap instead of the whole dialog.

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
	/*
		Which three-word list the start opens: this browser's own, or -- with
		"Join a shared list" ticked -- the one behind the words typed there or
		brought by a link.
	*/
	let ownMnemonic = '';
	let joinList = false;
	let joinWords = '';
	$: selectedMnemonic = joinList ? joinWords : ownMnemonic;
	let activeMnemonic = '';

	// The open list travels in the URL fragment — `#list=` for the three words,
	// `#db=` for one list by its address — so a link, or the page QR, opens the
	// same list on another device. Words from a link go through the dialog like
	// typed ones: the reader sees which list it is before joining it.
	const listLink = createListLink({
		openWords: (words) => {
			joinWords = words;
			joinList = true;
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
	/**
	 * Whether the dialog stays away on the next visit. Not a box of its own any
	 * more: what "Keep in this browser" keeps includes the decision to start,
	 * and with it unticked nothing is kept, that decision included (`start()`).
	 */
	let rememberDecision = false;
	/**
	 * The list a link brought, named on the dialog's first screen: the share
	 * code sits on the settings screen, and a reader should see which list
	 * they are about to join without going there.
	 *
	 * @type {string | null}
	 */
	let linkedWords = null;
	/** Opens the dialog on its settings, for "change the list". */
	let consentOpensAdvanced = false;

	// The button says what its press does: the press is the consent.
	$: proceedText =
		identityMode === 'create'
			? $_('consent.start.create')
			: identityMode === 'existing'
				? $_('consent.start.existing')
				: $_('consent.start.anonymous');
	// One icon per sentence on the first screen, in `summary()`'s order.
	/** @type {Array<'lock' | 'eye' | 'shield'>} */
	const summaryIcons = ['lock', 'eye', 'shield'];
	// The share code holds the button only where somebody asked to join a list.
	$: canStart = !joinList || mnemonicValid;

	/**
	 * A choice the person made that cannot be carried out — no passkey behind
	 * "use an existing one", an unnamed new one. Separated from a genuine
	 * startup failure because the two need different words: this one is
	 * answered by choosing differently, and prefixing it with "P2P" only hides
	 * that.
	 */
	class IdentityChoiceError extends Error {}

	/**
	 * A passkey without PRF cannot carry its identity to another device; say so
	 * once (`identityTravelWarning` in start/identity.js).
	 *
	 * @param {any} credential
	 */
	function warnIfIdentityCannotTravel(credential) {
		const warning = identityTravelWarning(credential);
		if (warning) showToast($_(warning.key), 'warning', warning.duration);
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
		// escrow01: a shared list only when one was asked for -- "Join a shared
		// list" ticked, words from a link, or the dialog opened again to change
		// the list. Anything else ends in one's own list (`openStartList`).
		const wordsChosen = joinList;
		// Held from before the start, not from when the home list begins to open:
		// in between, the form would be enabled on the shared list for a moment,
		// and a todo written then would vanish with the switch.
		homeListOpening = !wordsChosen && !addressFromLink;
		// Now, not when the dialog appeared: the storage choice is only a choice
		// once somebody starts with it. The box writes nothing, so a preselected
		// "keep it" stayed in memory without this. First, so that every
		// `remember()` below lands where the choice says.
		setPersistentStorageEnabled(storageMode === 'indexeddb');
		// Kept means the decision to start is kept too, so the dialog does not
		// come back; in memory mode it is not, and a reload asks again (#9).
		rememberDecision = storageMode === 'indexeddb';
		// Both describe how the dialog was opened this time, not the next time.
		consentOpensAdvanced = false;
		linkedWords = null;
		const canonicalMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
		// The list started is this browser's list from now on (it is remembered
		// as such just below); a dialog opened again shows what was started.
		ownMnemonic = canonicalMnemonic;
		if (joinList) joinWords = canonicalMnemonic;
		try {
			remember(SPANISH_MNEMONIC_STORAGE_KEY, canonicalMnemonic);
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
			// The name is asked for only in the technical view; an empty one is
			// the default name, not a reason to stop on the way to the passkey.
			const label = passkeyLabel.trim() || $_('consent.identityLabelDefault');
			// The same label goes into both WebAuthn fields on purpose: they are
			// the account name and the display name of one credential, and the
			// picker shows them together. Neither identifies the passkey.
			passkeyCredential = await createPasskeyCredential({
				userId: label,
				displayName: label
			});
		} else if (identityMode === 'existing') {
			passkeyCredential = await recoverPasskeyCredential();
			if (!passkeyCredential) {
				throw new IdentityChoiceError($_('consent.errorNoPasskey'));
			}
		}
		try {
			remember(IDENTITY_MODE_KEY, passkeyCredential ? 'passkey' : 'anon');
			// Only now, with the identity settled: kept from a start that failed
			// at the passkey, it would start the next visit without one, unasked.
			if (rememberDecision) remember(CONSENT_KEY, 'true');
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
			/*
				Words in the address are not always a link somebody followed. After a
				start the app writes the open list into the address itself, so a
				reload, or a return to the same address, carried this browser's own
				words back in -- and the dialog greeted every return with "this
				address opens the shared list …", for a link nobody had followed.
				Own words, and words a reload brings back where nothing is kept, are
				this browser's list; anything else is a link.
			*/
			const stored = storedMnemonic();
			const fromAddress = listLink.initial.words;
			const followed =
				fromAddress !== null &&
				fromAddress !== stored &&
				!(stored === null && cameBackToThisAddress());
			ownMnemonic = fromAddress !== null && !followed ? fromAddress : loadOrGenerateMnemonic();
			if (followed) {
				joinWords = fromAddress;
				joinList = true;
				linkedWords = fromAddress;
			}
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
				// From the values, not `selectedMnemonic`: its reactive update has not
				// run yet inside this handler.
				activeMnemonic = normalizeSpanishMnemonic(joinList ? joinWords : ownMnemonic);
				homeListOpening = !joinList && !addressFromLink;
				await startP2P({ todoDbName: activeMnemonic, passkeyCredential: null });
				void openStartList(joinList);
			}
		} catch {
			// ignore storage errors -- but do not leave the form locked for a home
			// list that is now never going to open
			homeListOpening = false;
		}
	});

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
	 * - "Join a shared list" ticked, or words from a link: that shared list;
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
		// escrow01: the first todo makes the list of one's own the start pointed
		// to, and goes into it.
		if ($homeListPendingStore) {
			try {
				await openHomeList($_('lists.home.name'), { create: true });
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				showToast($_('lists.home.openFailed', { values: { reason } }), 'error', 6000);
				return;
			}
		}
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

	// A budget is paid to the delegate, so it exists only where delegation does,
	// and only for a session the service can sign for.
	$: budgetEnabled =
		formDelegationEnabled && (!budgetInfo.requiresPasskey || Boolean($ownDidStore));
	$: budgetsInList = $todosStore.some((todo) => todo.budget && todo.budget.status !== 'none');
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
	// The form offers delegation and a budget for the list the first todo will
	// make, too; the rows below belong to the list that is open.
	$: formDelegationEnabled = delegationEnabled || $homeListPendingStore;

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
		The short form (`summary`): what this is for, three sentences about the
		data and one button whose press is the consent, the other ways in as
		links under it. The settings and the full statement are the dialog's
		second screen ("Notices and settings"); the settings keep their defaults.
	-->
	<ConsentModal
		bind:show={showModal}
		choices={{ identity: identityMode, storage: storageMode }}
		clauses={consentClauses}
		summary={consentSummary}
		{proceedText}
		advancedOpen={consentOpensAdvanced}
		elementStrings={$json('consent.element')}
		bind:technical={$technicalView}
		hideSections={[NETWORK_CHECK, NETWORK_ADDRESSES]}
		canProceed={canStart}
		{error}
		on:proceed={handleModalClose}
	>
		<!-- The video, when there is one, left in the row of the switches. -->
		<svelte:fragment slot="header">
			<DemoVideoButton variant="teaser" />
			<LanguageSwitcher />
		</svelte:fragment>
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
		<svelte:fragment slot="summary-icon" let:index>
			<BudgetIcon name={summaryIcons[index] ?? 'shield'} size={18} />
		</svelte:fragment>
		<svelte:fragment slot="beside-start">
			<StartChoices bind:mode={identityMode} />
		</svelte:fragment>
		<svelte:fragment slot="advanced">
			<KeepInBrowser bind:mode={storageMode} />
			<JoinSharedList bind:join={joinList} bind:value={joinWords} />
			<!-- Only a label in the passkey picker, so only in the technical view. -->
			{#if $technicalView && identityMode === 'create'}
				<label class="block rounded-lg border border-border p-3 text-sm">
					<span class="block font-medium text-heading">{$_('consent.identityLabelTitle')}</span>
					<input
						type="text"
						bind:value={passkeyLabel}
						placeholder={$_('consent.identityLabelPlaceholder')}
						data-testid="passkey-label"
						class="mt-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
					/>
					<span class="mt-1 block text-xs text-faint" data-testid="passkey-label-hint">
						{$_('consent.identityLabelHint')}
					</span>
				</label>
			{/if}
		</svelte:fragment>
	</ConsentModal>
{/if}

<!-- The demo video, over the dialog or over the page: opened by the teaser or the header link. -->
<DemoVideoPlayer />

<main class="container mx-auto max-w-4xl px-4 pt-4 pb-28 sm:px-6 sm:pt-6 sm:pb-6">
	<AppHeader {auditorOpen} />

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
			<ActiveListHeading
				mnemonic={activeMnemonic}
				pendingName={$homeListPendingStore ? $_('lists.home.name') : null}
			/>
		{/if}

		<AddTodoForm
			on:add={handleAddTodo}
			disabled={!$initializationStore.isInitialized || homeListOpening}
			delegationEnabled={formDelegationEnabled}
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
			todos={$homeListPendingStore ? [] : $todosStore}
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
						joinWords = activeMnemonic;
						joinList = true;
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
		<AccountSection {showBalance} />
	</section>

	<section
		hidden={$currentSection !== 'netzwerk'}
		aria-label={$_('sections.tab.network')}
		data-testid="section-netzwerk"
	>
		<NetworkSection on:connected={handleManualConnect} />
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
