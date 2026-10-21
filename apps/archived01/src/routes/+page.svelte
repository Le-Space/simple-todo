<script>
	import { recall, remember } from '@simple-todo/todo/browser-memory.js';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { createListLink } from '@simple-todo/todo/list-link.js';
	import { t } from '@simple-todo/ui/i18n.js';
	import { _, json } from '$lib/i18n/index.js';
	import { peerIdStore, initializationStore, ownDidStore } from '$lib/p2p-stores.js';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import DidBadge from '@simple-todo/ui/DidBadge.svelte';
	import {
		createPasskeyCredential,
		hasStoredPasskeyCredential,
		recoverPasskeyCredential
	} from '$lib/passkey-identity.js';
	import ArchivePanel from '$lib/ArchivePanel.svelte';
	import { readArchiveSettings, rememberPrfOutput, unlockArchive } from '$lib/archive/archive.js';
	import PasskeyStepDialog from '$lib/PasskeyStepDialog.svelte';
	import { passkeyStepsFor, announce, PasskeyStepCancelled } from '$lib/passkey-steps.js';
	import {
		todosStore,
		todoDBAddressStore,
		lastWriteErrorStore,
		addTodo,
		deleteTodo,
		toggleTodoComplete
	} from '$lib/db-actions.js';
	import { formatVersions } from '@simple-todo/todo/build-info.js';
	import ConsentModal from '@simple-todo/ui/ConsentModal.svelte';
	import { clauses as consentClauses } from '$lib/consent-clauses.js';
	import SocialIcons from '@simple-todo/ui/SocialIcons.svelte';
	import ThemeToggle from '@simple-todo/ui/ThemeToggle.svelte';
	import LanguageSwitcher from '@simple-todo/ui/LanguageSwitcher.svelte';
	import LocalFirstLink from '@simple-todo/ui/LocalFirstLink.svelte';
	import AppFooter from '@simple-todo/ui/AppFooter.svelte';
	import PageQr from '@simple-todo/ui/PageQr.svelte';
	import ToastNotification from '@simple-todo/ui/ToastNotification.svelte';
	import P2PStatusNav from '$lib/P2PStatusNav.svelte';
	import ErrorAlert from '@simple-todo/ui/ErrorAlert.svelte';
	import AddTodoForm from '$lib/AddTodoForm.svelte';
	import TodoList from '$lib/TodoList.svelte';
	import ConnectedPeers from '@simple-todo/ui/ConnectedPeers.svelte';
	import PeerIdCard from '@simple-todo/ui/PeerIdCard.svelte';
	import OwnMultiaddrs from '@simple-todo/ui/OwnMultiaddrs.svelte';
	import StorageModeSelector from '@simple-todo/ui/StorageModeSelector.svelte';
	import P2PModeSelector from '@simple-todo/ui/P2PModeSelector.svelte';
	import SealListSelector from '$lib/SealListSelector.svelte';
	import { getSealListEnabled } from '$lib/list-sealing.js';
	import { getP2PEnabled } from '@simple-todo/todo/p2p-mode.js';
	import { initializeP2PMode } from '@simple-todo/todo/p2p-mode.js';
	import { RELAY_FAB_POSITION_KEY } from '@simple-todo/ui/relay-fab.js';
	import { getPersistentStorageEnabled } from '@simple-todo/todo/storage-mode.js';
	import { honourStorageChoice } from '@simple-todo/todo/browser-memory.js';

	// This chapter offers the choice, so what the app writes follows it. Said
	// once, at module scope, because the first `recall()` happens in `onMount`
	// before anything renders.
	honourStorageChoice();
	initializeP2PMode();
	import SharedListSelector from '$lib/SharedListSelector.svelte';
	import SharedListDetails from '$lib/SharedListDetails.svelte';
	import {
		SPANISH_MNEMONIC_STORAGE_KEY,
		generateSpanishMnemonic,
		isValidSpanishMnemonic,
		normalizeSpanishMnemonic
	} from '@simple-todo/todo/spanish-mnemonic.js';
	import ManualConnectForm from '$lib/ManualConnectForm.svelte';
	import { libp2pStore } from '$lib/p2p-stores.js';

	/** @typedef {'default' | 'success' | 'error' | 'warning'} ToastType */
	/** @typedef {{ detail: { text: string } }} AddTodoEvent */
	/** @typedef {{ detail: { key: string } }} TodoActionEvent */

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;
	const IDENTITY_MODE_KEY = 'simpleTodo.identityMode';

	/** @type {'create' | 'existing' | 'anonymous'} */
	let identityMode = 'anonymous';
	/** The passkey behind the running identity; null for the anonymous one. */
	let activeCredential = /** @type {any} */ (null);
	let passkeyLabel = '';

	/** @type {string | null} */
	let toastMessage = null;
	/** @type {ToastType} */
	let toastType = 'default';
	/** @type {string | null} */
	let error = null;
	/** @type {string | null} */
	let notice = null;
	/** @type {string | null} */
	let myPeerId = null;
	let selectedMnemonic = '';

	// Read before the dialog renders and written by the selector itself, because
	// the choice has to be settled before Helia and OrbitDB are built -- changing
	// it afterwards would mean tearing the node down.
	/** @type {'memory' | 'indexeddb'} As `StorageModeSelector` declares it. */
	let storageMode = getPersistentStorageEnabled() ? 'indexeddb' : 'memory';
	/** Sealing the list with the passkey's key (list-sealing.js); the statement follows it. */
	let sealList = getSealListEnabled();
	let p2pEnabled = getP2PEnabled();
	let archiveSettings = readArchiveSettings();
	// Re-read whenever the dialog comes back: the archive may have been switched on since.
	$: if (showModal) archiveSettings = readArchiveSettings();
	let activeMnemonic = '';

	// The open list travels in the URL fragment as `#list=` and its three words,
	// so a link, or the page QR, opens the same list on another device. Words
	// from a link go through the dialog like typed ones: the reader sees which
	// list it is before joining it.
	const listLink = createListLink({
		openWords: (words) => {
			selectedMnemonic = words;
			showModal = true;
		}
	});
	onMount(() => listLink.listen());

	$: if ($initializationStore.isInitialized && activeMnemonic) {
		listLink.show({ words: activeMnemonic });
	}
	$: mnemonicValid = isValidSpanishMnemonic(selectedMnemonic);

	// Modal state
	let showModal = true;
	let rememberDecision = false;

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
	 * key differs per device — two identity documents under one DID. The
	 * provider tests that fallback as intended behaviour and logs one debug
	 * line, so nothing reaches the person it affects. This does.
	 *
	 * Once per credential: it describes the authenticator, and the answer will
	 * not change on the next start.
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

	const handleModalClose = async () => {
		// The dialog shows this now, so a stale one would accuse the attempt that
		// is only just starting.
		error = null;
		const canonicalMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
		selectedMnemonic = canonicalMnemonic;
		try {
			remember(SPANISH_MNEMONIC_STORAGE_KEY, canonicalMnemonic);
			if (rememberDecision) {
				remember(CONSENT_KEY, 'true');
			}
		} catch {
			// ignore storage errors
		}
		try {
			// Resolve the identity choice first — WebAuthn calls must run inside
			// the user gesture of the proceed click.
			let passkeyCredential = null;
			// What the start will ask the passkey after this click, and what each
			// touch is for (passkey-steps.js). The PRF output is read here when the
			// archive is on, or when a new passkey is made — the provider would ask
			// for it then anyway, and reading it here lets the archive unlock from
			// the start.
			const archiveOn = readArchiveSettings().enabled;
			// Sealing the list needs the same PRF output as the archive.
			const sealOn = getSealListEnabled();
			const wantsPrf = archiveOn || sealOn;
			/** @type {ReturnType<typeof passkeyStepsFor>} */
			let steps = {};
			if (identityMode === 'create') {
				if (!passkeyLabel.trim()) {
					throw new IdentityChoiceError($_('consent.errorNeedsLabel'));
				}
				steps = passkeyStepsFor({ mode: 'create', prf: true });
				// The same label goes into both WebAuthn fields on purpose: they are
				// the account name and the display name of one credential, and the
				// picker shows them together. Neither identifies the passkey.
				passkeyCredential = await createPasskeyCredential({
					userId: passkeyLabel.trim(),
					displayName: passkeyLabel.trim()
				});
			} else if (identityMode === 'existing') {
				const stored = hasStoredPasskeyCredential();
				steps = passkeyStepsFor({ mode: stored ? 'stored' : 'restore', prf: wantsPrf });
				// The authenticator's two touches come right after each other; the
				// second is named as it comes, not gated — a browser with no passkey
				// has to reach its "nothing here" without a dialog in the way.
				const of = 3 + (wantsPrf ? 1 : 0);
				passkeyCredential = await recoverPasskeyCredential({
					onTouch: ({ touch }) => {
						if (touch === 2)
							showToast($_('passkeySteps.restoreTouch', { values: { of } }), 'default', 6000);
					}
				});
				if (!passkeyCredential) {
					throw new IdentityChoiceError($_('consent.errorNoPasskey'));
				}
			}
			try {
				remember(IDENTITY_MODE_KEY, passkeyCredential ? 'passkey' : 'anon');
			} catch {
				// ignore storage errors
			}

			let prfOutput = null;
			if (passkeyCredential && (identityMode === 'create' || wantsPrf)) {
				await announce(steps, 'prf');
				const { readPrfOutput } = await import('@le-space/orbitdb-identity-provider-webauthn-did');
				prfOutput = await readPrfOutput(passkeyCredential).catch(() => null);
				rememberPrfOutput(prfOutput);
				// Chosen, and not possible: say so, rather than seal nothing quietly.
				if (sealOn && !prfOutput) showToast($_('sealList.noPrf'), 'warning', 8000);
			}
			activeCredential = passkeyCredential;
			await announce(steps, 'proof');

			if ($initializationStore.isInitialized) {
				await restartP2PLazy({ todoDbName: canonicalMnemonic });
			} else {
				await startP2P({ todoDbName: canonicalMnemonic, passkeyCredential, prfOutput });
			}
			activeMnemonic = canonicalMnemonic;
			void listLink.openLinked();
			warnIfIdentityCannotTravel(passkeyCredential);
			if (prfOutput) {
				unlockArchive({ credential: passkeyCredential, prfOutput }).catch((e) =>
					console.warn('archive: could not unlock', e)
				);
			}
		} catch (err) {
			showModal = true;
			if (err instanceof PasskeyStepCancelled) return;
			const reason = err instanceof Error ? err.message : String(err);
			error =
				err instanceof IdentityChoiceError
					? reason
					: $_('consent.errorStart', { values: { reason } });
			console.error('P2P initialization failed:', err);
		}
	};

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
		SponsorRelayFab = (await import('@le-space/ui/svelte')).default;
	}

	onMount(async () => {
		try {
			selectedMnemonic = listLink.initial.words ?? loadOrGenerateMnemonic();
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
			const rememberedIdentityMode = recall(IDENTITY_MODE_KEY);
			if (rememberedIdentityMode === 'passkey' || hasStoredPasskeyCredential()) {
				// A WebAuthn prompt needs a user gesture, so a remembered passkey
				// session cannot auto-start: preselect recovery and show the modal.
				// Say so — an unexplained dialog on every start reads as the same
				// failure as a dialog that came back because something broke.
				identityMode = 'existing';
				notice = $_('consent.existingNeedsTap');
			} else if (recall(CONSENT_KEY) === 'true') {
				showModal = false;
				activeMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
				await startP2P({ todoDbName: activeMnemonic, passkeyCredential: null });
				void listLink.openLinked();
			}
		} catch {
			// ignore storage errors
		}
	});

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
		// number — otherwise it disappears after its default three seconds while
		// this one is still counting.
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
		const success = await addTodo(event.detail.text);
		if (success) {
			showToast('✅ Todo added successfully!', 'success');
		} else {
			// The reason, on screen: a phone has no console to read it from.
			const why = get(lastWriteErrorStore);
			showToast(why ? `❌ Failed to add todo: ${why}` : '❌ Failed to add todo', 'error', 10_000);
		}
	};

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			showToast('🗑️ Todo deleted successfully!', 'success');
		} else {
			showToast('❌ Failed to delete todo', 'error');
		}
	};

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleToggleComplete = async (event) => {
		const success = await toggleTodoComplete(event.detail.key);
		if (success) {
			showToast('✅ Todo status updated!', 'success');
		} else {
			showToast('❌ Failed to update todo', 'error');
		}
	};

	/**
	 * @param {{ detail: { status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string } }} event
	 */
	const handleManualConnect = (event) => {
		const peerTarget = event.detail.remotePeer || event.detail.remoteAddr;

		if (event.detail.status === 'stable') {
			showToast(`🔗 Connected to ${peerTarget}`, 'success');
			return;
		}

		showToast(`⚠️ ${peerTarget} closed the connection shortly after connect`, 'warning');
	};

	// Subscribe to the peerIdStore
	$: myPeerId = $peerIdStore;

	let connectedPeersRef;
</script>

<ToastNotification message={toastMessage} type={toastType} duration={toastDuration} />
<PasskeyStepDialog />

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta
		name="description"
		content="A simple local-first peer-to-peer TODO list app using OrbitDB, IPFS and libp2p"
	/>
</svelte:head>

<!-- Only render the modal when needed -->
{#if showModal}
	<ConsentModal
		bind:show={showModal}
		bind:rememberDecision
		choices={{
			identity: identityMode,
			p2p: p2pEnabled,
			persistent: storageMode === 'indexeddb',
			seal: sealList,
			archive: archiveSettings.enabled,
			owner: Boolean(archiveSettings.owner)
		}}
		clauses={consentClauses}
		elementStrings={$json('consent.element')}
		canProceed={mnemonicValid}
		{error}
		{notice}
		on:proceed={handleModalClose}
	>
		<svelte:fragment slot="header"><LanguageSwitcher /></svelte:fragment>
		<svelte:fragment slot="before-confirmation">
			<P2PModeSelector bind:enabled={p2pEnabled} />
			<StorageModeSelector bind:mode={storageMode} />
			<SharedListSelector bind:value={selectedMnemonic} />
			<PasskeyOnboarding bind:mode={identityMode} bind:label={passkeyLabel} />
			<SealListSelector bind:enabled={sealList} passkey={identityMode !== 'anonymous'} />
		</svelte:fragment>
	</ConsentModal>
{/if}

<main class="container mx-auto max-w-4xl p-6">
	<!-- Header with title and social icons -->
	<header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex flex-1 items-center gap-3">
			<LocalFirstLink size={52} />
			<div>
				<h1 class="text-2xl font-bold text-heading sm:text-3xl">Simple-Todo</h1>
				<!--
					Four lines of stack versions and a build timestamp were what the
					header said about this app. They moved into the network details,
					where somebody who needs them already goes.
				-->
				<p class="mt-1 text-sm text-faint">A local-first peer-to-peer PWA</p>
			</div>
		</div>
		<div class="flex min-w-0 flex-wrap items-center justify-end gap-2 self-start sm:self-auto">
			<DidBadge did={$ownDidStore ?? ''} />
			<LanguageSwitcher />
			<ThemeToggle />
			<PageQr />
			<SocialIcons size="w-5 h-5" className="" />
		</div>
	</header>

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
			<p class="text-xs break-words text-faint" data-testid="build-info">
				{formatVersions({ appName: 'Simple-Todo' })} · {typeof __APP_BRANCH__ !== 'undefined'
					? __APP_BRANCH__
					: 'local'}
			</p>
		</div>
		<svelte:fragment slot="shared-list">
			{#if $initializationStore.isInitialized && activeMnemonic}
				<SharedListDetails
					embedded
					mnemonic={activeMnemonic}
					databaseAddress={$todoDBAddressStore}
					on:change={() => {
						selectedMnemonic = activeMnemonic;
						showModal = true;
					}}
				/>
			{/if}
		</svelte:fragment>
	</P2PStatusNav>

	{#if !showModal && (error || $initializationStore.error)}
		<ErrorAlert error={error || $initializationStore.error} dismissible={true} />
	{/if}

	<!-- Add TODO Form -->
	<AddTodoForm on:add={handleAddTodo} disabled={!$initializationStore.isInitialized} />

	<!-- TODO List -->
	<TodoList todos={$todosStore} on:delete={handleDelete} on:toggleComplete={handleToggleComplete} />

	<!-- The archive (archived01): the list's changes, shipped as sealed increments -->
	{#if !showModal}
		<ArchivePanel credential={activeCredential} ready={$initializationStore.isInitialized} />
	{/if}

	<AppFooter />
</main>

<!-- Floating Relay Button FAB -->
{#if SponsorRelayFab}
	<svelte:component
		this={SponsorRelayFab}
		manifestUrl="./rootfs-manifest.json"
		showInstances={true}
		draggable={true}
		positionStorageKey={RELAY_FAB_POSITION_KEY}
	/>
{/if}
