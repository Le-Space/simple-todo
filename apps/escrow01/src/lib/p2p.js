import { get } from 'svelte/store';
import {
	libp2pStore,
	peerIdStore,
	ownDidStore,
	passkeyCredentialStore,
	initializationStore
} from './p2p-stores.js';

import { createLibp2p } from 'libp2p';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { createOrbitDB, IPFSAccessController, useIdentityProvider } from '@orbitdb/core';
import {
	configureWebAuthn,
	OrbitDBWebAuthnIdentityProviderFunction,
	withoutStaleIdentityCache
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { registerDelegatedAccessController } from './delegated-access.js';
import { wrapInstance } from './instance-wrappers.js';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import * as json from 'multiformats/codecs/json';
import { sha512 } from 'multiformats/hashes/sha2';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2pConfig } from '@simple-todo/net/libp2p-config.js';
import { createMemoryIdentities } from '@simple-todo/todo/memory-identities.js';
import { seedRestoredSigningKey } from '@simple-todo/todo/restored-signing-key.js';
import { prfForStart } from './sealed/start-prf.js';
import { ownAgreementKey } from './sealed/own-agreement-key.js';
import { sealedReaderStore } from './sealed/session-reader.js';
import { closeSealedLists } from './sealed/list-session.js';
import { directoryFor } from './chain/session-directory.js';
import { dropKeptSigningKeys } from './kept-signing-keys.js';
import { receiveIdentityBlocks } from './identity-blocks.js';
import { forgetByPrefix, recall, remember } from '@simple-todo/todo/browser-memory.js';
import {
	createLogStorages,
	getPersistentStorageEnabled,
	PERSISTENT_STORAGE_PATHS
} from '@simple-todo/todo/storage-mode.js';
import {
	activeKeyStore,
	initializeDatabase,
	todoDBAddressStore,
	todoDBStore,
	todosStore
} from './db-actions.js';
import { openedListRegistry, resetListRegistry } from './list-registry.js';
import {
	getWebRTCEnabled,
	initializeWebRTCSetting,
	setWebRTCEnabled,
	webrtcEnabledStore
} from '@simple-todo/net/webrtc-settings.js';
import { getTodoDatabaseName } from '@simple-todo/todo/default-todo-database.js';
import { normalizeDiscoveredMultiaddrs } from '@simple-todo/net/multiaddr-utils.js';
import { translate } from './i18n/index.js';

export { setWebRTCEnabled, webrtcEnabledStore };

// The stores live in `p2p-stores.js` so a page can read them without
// pulling libp2p/Helia/OrbitDB into its eager bundle. Re-exported here
// because plenty of callers legitimately want both from one import.
export { libp2pStore, peerIdStore, ownDidStore, initializationStore } from './p2p-stores.js';

/*
	The start's steps, in order. Only keys: what each step is called and what it
	does is the status panel's to say, in the language on screen
	(`network.step.<key>` in the catalogues).
*/
const INITIALIZATION_STEP_DEFINITIONS = [
	{ key: 'networkConfig' },
	{ key: 'libp2p' },
	{ key: 'helia' },
	{ key: 'orbitdb' },
	{ key: 'databaseSync' },
	{ key: 'localTodos' }
];

/**
 * @typedef {'pending' | 'active' | 'complete' | 'error'} InitializationStepStatus
 * @typedef {{ key: string, status: InitializationStepStatus }} InitializationStep
 */

/** @param {number} [activeIndex=-1] */
function createInitializationSteps(activeIndex = -1) {
	return INITIALIZATION_STEP_DEFINITIONS.map(({ key }, index) => ({
		key,
		status: /** @type {InitializationStepStatus} */ (
			index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending'
		)
	}));
}

/** @param {number} activeIndex */
function setInitializationProgress(activeIndex) {
	initializationStore.set({
		isInitializing: true,
		isInitialized: false,
		error: null,
		steps: createInitializationSteps(activeIndex)
	});
}

let libp2p = /** @type {any} */ (null);
let helia = /** @type {any} */ (null);
let orbitdb = /** @type {any} */ (null);

let peerId = /** @type {string | null} */ (null);
/** Stops filing the identity documents answers carry (#127). @type {(() => void) | null} */
let stopReceivingIdentityBlocks = null;
/**
 * The WebAuthn credential backing the current session identity. Kept at
 * module level so restartP2P (e.g. when switching the shared list) reuses
 * the same passkey identity without another WebAuthn prompt.
 * @type {any | null}
 */
let activePasskeyCredential = null;
/**
 * The PRF output of this start, from `createOrbitDBInstance` to
 * `setUpSealedReader`, which derives the list key from it and zeroes it.
 * @type {Uint8Array | null}
 */
let startPrfOutput = null;
let todoDB = /** @type {any} */ (null);
let defaultTodoDbAddress = '';
let activeTodoDatabaseName = '';
const ORBITDB_IDENTITY_STORAGE_KEY = 'simpleTodo.orbitdbIdentityId';
const MANUAL_CONNECT_STABILIZATION_MS = 3_000;
const RELAY_PING_TIMEOUT_MS = 10_000;
const DISCOVERY_DIAL_PERIODIC_RETRY_MS = 2_000;
const DISCOVERY_DIAL_RETRY_COOLDOWN_MS = 5_000;
const DISCOVERY_DIAL_TIMEOUT_MS = 10_000;
const CIRCUIT_RELAY_HOP_PROTOCOL = '/libp2p/circuit/relay/0.2.0/hop';
const CIRCUIT_RELAY_PROTOCOL_WAIT_MS = 5_000;
/** @type {Map<string, Promise<boolean>>} */
const relayReservationAttempts = new Map();
/** @type {Map<string, { peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }>} */
const discoveredPeers = new Map();
/** @type {ReturnType<typeof setInterval> | null} */
let discoveryDialRetryInterval = null;
/** @type {ReturnType<typeof setInterval> | null} */

/**
 * The stores for a session that asked to keep its todos.
 *
 * Imported dynamically so a browser that chose "in memory only" never loads
 * `blockstore-level` and `datastore-level` at all — the choice is made on the
 * consent screen, before this runs, and in-memory is the default.
 *
 * @returns {Promise<{ blockstore?: any, datastore?: any }>}
 */
async function createPersistentStores() {
	if (!getPersistentStorageEnabled()) return {};

	const [{ LevelBlockstore }, { LevelDatastore }] = await Promise.all([
		import('blockstore-level'),
		import('datastore-level')
	]);

	return {
		blockstore: new LevelBlockstore(PERSISTENT_STORAGE_PATHS.blockstore),
		datastore: new LevelDatastore(PERSISTENT_STORAGE_PATHS.datastore)
	};
}

/**
 * @param {any} libp2pNode
 * @param {{ blockstore?: any, datastore?: any }} [stores]
 * @returns {any}
 */
function createHeliaWithLibp2p(libp2pNode, stores = {}) {
	return withBitswap(
		// Typed against @libp2p/interface 3.4.0, which bitswap 4.0.20 brings,
		// where this libp2p is 3.2.5: the same interface at runtime, a newer
		// stream type in the declarations.
		/** @type {any} */ (
			withLibp2p(
				// Bitswap only, deliberately. `withHTTP` used to wrap this: it ships
				// three public gateways and Helia asks them for any block bitswap does
				// not produce. Nothing here can be there — todos are OrbitDB entries
				// written in a browser, so the request can only fail while announcing
				// the CID to three strangers.
				createHeliaLight({
					codecs: [dagCbor, dagJson, json],
					hashers: [sha512],
					// Omitted when the user chose in-memory: helia then falls back to
					// MemoryBlockstore/MemoryDatastore, which is what this chapter did
					// unconditionally until now.
					...stores
				}),
				libp2pNode
			)
		),
		// Over the relay's circuit as well. Two browsers often have nothing else,
		// and OrbitDB fetches by CID through bitswap what a gossipsub update does
		// not carry: the signer's identity document, older entries of a log.
		// Without it a delegate's account entry crossed the circuit and was refused
		// for want of its signer (chain/account-directory.js). The option has
		// reached the dial and the topology only since 4.0.17 (ipfs/helia#1129).
		{ runOnLimitedConnections: true }
	);
}

/**
 * Initialize the P2P network after user consent
 * This function should be called only after the user has accepted the consent modal
 */
export async function initializeP2P(
	options = /** @type {{ todoDbAddress?: string, todoDbName?: string, passkeyCredential?: any }} */ ({})
) {
	if (Object.prototype.hasOwnProperty.call(options, 'passkeyCredential')) {
		activePasskeyCredential = options.passkeyCredential ?? null;
	}
	console.log('🚀 Starting P2P initialization after user consent...');

	try {
		// Set initialization state
		setInitializationProgress(0);

		// Read the stored WebRTC choice before the transports are decided, as
		// main does since it found the same gap: escrow01 never called
		// `initializeWebRTCSetting`, so `simpleTodo.webrtcEnabled` was never read
		// and every spec that switched WebRTC off (delegation, list-peer-led) ran
		// with WebRTC on. Nothing user-facing changes; no screen offers the switch.
		initializeWebRTCSetting();

		// Create libp2p configuration and node
		const config = await createLibp2pConfig();
		setInitializationProgress(1);
		libp2p = await createLibp2p(config);
		libp2pStore.set(libp2p); // Make available to plugins
		console.log(`✅ libp2p node created`);

		// Get and set peer ID
		peerId = libp2p.peerId.toString();
		console.log(`✅ peerId is ${peerId}`);
		peerIdStore.set(peerId);
		discoveredPeers.clear();
		setupPubsubDiscoveryAutoDial();
		setupAutomaticRelayReservations();

		// Create Helia (IPFS) instance
		setInitializationProgress(2);
		helia = await createHeliaWithLibp2p(libp2p, await createPersistentStores()).start();
		console.log(`✅ Helia created`);

		// Create OrbitDB instance
		setInitializationProgress(3);
		console.log('🛬 Creating OrbitDB instance...');
		orbitdb = await createOrbitDBInstance(helia);
		// Before any database opens: an answer may bring its writers' identity
		// documents first (identity-blocks.js, #127).
		stopReceivingIdentityBlocks = receiveIdentityBlocks({
			pubsub: libp2p.services.pubsub,
			blockstore: helia.blockstore
		});
		await setUpSealedReader(orbitdb);
		setInitializationProgress(4);
		todoDB = await openInitialTodoDatabase(options.todoDbAddress, options.todoDbName);

		console.log('✅ Database opened successfully with OrbitDBAccessController:', {
			address: todoDB.address,
			type: todoDB.type,
			accessController: todoDB.access
		});

		// Initialize database stores and actions
		setInitializationProgress(5);
		await initializeDatabase(orbitdb, todoDB);

		// Mark initialization as complete
		initializationStore.set({
			isInitializing: false,
			isInitialized: true,
			error: null,
			steps: createInitializationSteps(INITIALIZATION_STEP_DEFINITIONS.length)
		});
		installPublicDiagnostics();
		installE2ETestHooks();
		console.log('🎉 P2P initialization completed successfully!');
	} catch (error) {
		console.error('❌ Failed to initialize P2P:', error);
		initializationStore.set({
			isInitializing: false,
			isInitialized: false,
			error: error instanceof Error ? error.message : String(error),
			steps: []
		});
		throw error;
	}
}

/**
 * Restart libp2p, Helia and OrbitDB with the current transport settings.
 * The active Todo DB address is preserved when one is available.
 */
export async function restartP2P(options = /** @type {{ todoDbName?: string }} */ ({})) {
	const activeTodoDbAddress = get(todoDBAddressStore);
	const currentDatabaseName = activeTodoDatabaseName;
	const shouldPreserveActiveTodoDb =
		!options.todoDbName &&
		Boolean(activeTodoDbAddress) &&
		activeTodoDbAddress !== defaultTodoDbAddress;

	await stopP2P();
	await initializeP2P({
		todoDbAddress: shouldPreserveActiveTodoDb ? activeTodoDbAddress : '',
		todoDbName: options.todoDbName || currentDatabaseName
	});
}

async function stopP2P() {
	setInitializationProgress(0);
	libp2pStore.set(null);
	peerIdStore.set(null);
	ownDidStore.set(null);
	passkeyCredentialStore.set(null);
	sealedReaderStore.set(null);
	peerId = null;
	activeTodoDatabaseName = '';
	stopDiscoveryDialRetryInterval();
	discoveredPeers.clear();
	relayReservationAttempts.clear();

	// The key stores of sealed lists belong to this OrbitDB instance too.
	await closeSealedLists().catch((error) => console.warn('Closing sealed lists:', error));
	stopReceivingIdentityBlocks?.();
	stopReceivingIdentityBlocks = null;
	const resources = [todoDB, orbitdb, helia, libp2p];
	todoDB = null;
	orbitdb = null;
	helia = null;
	libp2p = null;

	await Promise.allSettled(resources.map((resource) => resource?.stop?.() ?? resource?.close?.()));

	todosStore.set([]);
	// The registry belongs to the OrbitDB instance that just stopped, and maybe
	// to another identity. Kept, it handed the next start a closed database and
	// the previous identity's lists -- and the start now opens one of those as
	// the home list (`openHomeList`), so it has to go with the rest.
	resetListRegistry();
}

/**
 * @param {string | undefined} address
 * @param {string | undefined} databaseName
 */
async function openInitialTodoDatabase(address, databaseName) {
	const normalizedAddress = address?.trim() ?? '';

	if (normalizedAddress.startsWith('/orbitdb/')) {
		activeTodoDatabaseName = '';
		return orbitdb.open(normalizedAddress, {
			type: 'keyvalue',
			sync: true,
			...(await createLogStorages())
		});
	}

	const canonicalDatabaseName = getTodoDatabaseName(databaseName || '');
	activeTodoDatabaseName = canonicalDatabaseName;
	const defaultTodoDB = await orbitdb.open(canonicalDatabaseName, {
		type: 'keyvalue', //Stores data as key-value pairs supports basic operations: put(), get(), delete()
		create: true, // Allows the database to be created if it doesn't exist
		sync: true, // Enables automatic synchronization with other peers
		// The mnemonic default list stays public (write: ['*']) so the shared-list
		// collaboration from collab01 keeps working. Access-controlled lists are
		// created explicitly as *private lists* (see createPrivateTodoList).
		AccessController: IPFSAccessController({ write: ['*'] }),
		// Memory-only when that is what was chosen. Without this an in-memory
		// session still left `orbitdb/<address>/log/_heads/` and `.../_index/`
		// in IndexedDB, because `Database` defaults both to LevelStorage.
		...(await createLogStorages())
	});

	defaultTodoDbAddress = defaultTodoDB.address?.toString?.() ?? '';
	return defaultTodoDB;
}

/**
 * Create the OrbitDB instance with either the passkey-backed WebAuthn DID
 * identity (this chapter) or the anonymous browser-profile identity from the
 * previous chapters — the onboarding screen makes it a user choice.
 * @param {any} heliaNode
 */
async function createOrbitDBInstance(heliaNode) {
	// delegation01: every `/orbitdb/…` controller this app opens checks the
	// delegation rules — see delegated-access.js for why it is the base type.
	registerDelegatedAccessController();
	passkeyCredentialStore.set(activePasskeyCredential);
	// Identity proofs in the first format are refused (provider 0.14.0,
	// GHSA-7j39-c465-x35x). Their challenge was a bare 32-byte hash, so one
	// signature this passkey made for anything else that signs 32 bytes could
	// stand in for an identity of its DID, for good. A device that kept such a
	// proof makes a new one on its next start: one more passkey prompt, a new
	// identity document, the same DID.
	//
	// What that costs a list with history: OrbitDB checks every entry on the
	// path from a new head back to what a device already has, so one entry
	// under a first-format document anywhere in it stops the whole head. A
	// device that does not hold the list yet sees none of it, not even what was
	// written after the switch; a device that does hold it refuses new entries
	// from others that build on that history. Its own copy stays readable. The
	// relays keep the provider's default and still accept such proofs.
	configureWebAuthn({ acceptLegacyProofs: false });

	// Register the provider type first, on every path. It used to sit behind
	// the passkey branch below, so a browser *without* a passkey never
	// registered it — and OrbitDB cannot verify an identity whose provider it
	// does not know: an anonymous peer silently kept none of the entries a
	// passkey wrote, while the open list promised collaboration across both
	// kinds of identity (#78).
	try {
		useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);
	} catch {
		// Already registered — fine.
	}

	if (!activePasskeyCredential) {
		ownDidStore.set(null);
		return wrapInstance(
			await createOrbitDB({
				ipfs: heliaNode,
				id: getOrCreateOrbitDBIdentityId(),
				// Without identities of our own, `createOrbitDB` builds a keystore
				// under `./orbitdb/keystore`, which browser-level writes to
				// IndexedDB -- the signing key, on a device that was promised
				// nothing would be kept.
				...(getPersistentStorageEnabled()
					? { directory: PERSISTENT_STORAGE_PATHS.orbitdb }
					: { identities: await createMemoryIdentities(heliaNode) })
			})
		);
	}

	// The DID is the passkey's own P-256 key. OrbitDB signs entries with a
	// separate secp256k1 key (the provider's default `signingKeyType`), derived
	// from the passkey's PRF output, so one passkey yields one identity document
	// on every device.
	//
	// That key is never written down (user decision, 26.11.2026: as much as
	// possible sealed, and a reload asks for a touch). The keystore lives in
	// memory in both storage modes, and every start reads the PRF output once,
	// behind its click (sealed/start-prf.js); the provider derives the signing
	// key from that answer, and setUpSealedReader the key for sealed lists. With
	// "Keep in this browser" a reload therefore costs one touch, the PRF read:
	// the identity proof the provider keeps (`webauthn-identity-proof:…`) is
	// public, and it keeps the document the same, so it is not signed again.
	// Until then the key sat unencrypted in OrbitDB's default keystore in
	// IndexedDB; `dropKeptSigningKeys` deletes what an earlier visit left there.
	//
	// Without PRF there is nothing to derive from: the keystore makes a key for
	// this start, the document is new each time, and its signature is the touch
	// (`warnIfIdentityCannotTravel` in +page.svelte says what that costs).
	// Wrapped by the provider (0.11.0): OrbitDB's identity cache refuses another
	// session of the same passkey — entries of an earlier session arrive, and
	// this session can no longer write (orbitdb/orbitdb#1258).
	const identities = withoutStaleIdentityCache(await createMemoryIdentities(heliaNode));
	await dropKeptSigningKeys();
	// The provider reads `prfOutput` and leaves the bytes alone; the copy is
	// so that setUpSealedReader's derivation, which zeroes its seed, cannot
	// reach the provider's.
	const prfOutput = await prfForStart(activePasskeyCredential);
	startPrfOutput = prfOutput ? Uint8Array.from(prfOutput) : null;
	// A passkey restored on this device brought its signing key along. With
	// the PRF output at hand it is the same key; without one it spares the
	// touch a second derivation would cost.
	await seedRestoredSigningKey(identities.keystore, activePasskeyCredential);
	const identity = await identities.createIdentity({
		provider: OrbitDBWebAuthnIdentityProviderFunction({
			webauthnCredential: activePasskeyCredential,
			...(prfOutput ? { prfOutput } : { deriveSigningKeyFromPrf: false })
		})
	});
	prfOutput?.fill(0);
	// The provider files a proof under `webauthn-identity-proof:…` in
	// localStorage as well as in its own Map, with no way to hand it another
	// store. In memory mode that is a trace the reader asked us not to leave,
	// and without PRF it is never used again -- the next start signs a new
	// document -- so it goes in both cases; the Map still answers for this
	// session (#9). This also drops the proofs of another passkey on this
	// browser, which then signs once more.
	if (!getPersistentStorageEnabled() || !startPrfOutput) forgetByPrefix('webauthn-identity-proof:');

	ownDidStore.set(identity.id);
	console.log(`✅ Passkey identity ready: ${identity.id}`);
	// `identities` is a documented OrbitDB option — see its own
	// `@param {module:Identities} [params.identities]` and the destructuring in
	// `@orbitdb/core/src/orbitdb.js`. Only the bundled declaration omits it.
	// @ts-expect-error incomplete upstream types, not a wrong call
	return wrapInstance(await createOrbitDB({ ipfs: heliaNode, identities, identity }));
}

/**
 * This session's reader for sealed lists (#127): its DID and X25519 key, set
 * for the list code (sealed/session-reader.js), and the key's public half in
 * the account directory, where an owner finds it to share a list.
 *
 * A passkey with PRF derives the key from this start's PRF output, and holds
 * it for the tab only. A passkey without PRF, and an anonymous identity, have
 * nothing to derive from: they get a device key, which "Keep in this browser"
 * keeps as one that cannot be exported (sealed/own-agreement-key.js).
 *
 * Never fatal: without a reader the app runs, and sealed lists say they
 * cannot be opened.
 *
 * @param {any} instance the OrbitDB instance just created
 */
async function setUpSealedReader(instance) {
	const seed = startPrfOutput;
	startPrfOutput = null;
	try {
		const did = instance.identity.id;
		const agreementKey = await ownAgreementKey({
			did,
			prfOutput: seed,
			readPrfOutput: seed ? null : async () => null
		});
		if (!agreementKey) return;
		sealedReaderStore.set({ did, agreementKey });
		void directoryFor(instance)
			.then((directory) => directory.publishAgreementKey(did, agreementKey.publicKey))
			.catch((error) => console.warn('Could not publish the key for sealed lists:', error));
	} catch (error) {
		console.warn('No key for sealed lists in this session:', error);
	} finally {
		seed?.fill(0);
	}
}

/**
 * Keep a browser-profile identity id so entries from separate peers retain
 * distinct authors, while every peer opens the shared default database.
 */
function getOrCreateOrbitDBIdentityId() {
	if (typeof localStorage === 'undefined') {
		return createOrbitDBIdentityId();
	}

	const existingIdentityId = recall(ORBITDB_IDENTITY_STORAGE_KEY);
	if (existingIdentityId) {
		return existingIdentityId;
	}

	const identityId = createOrbitDBIdentityId();
	// Through the facade: in memory mode this stays in the tab, so a reload
	// starts a new identity rather than leaving the old one on the device.
	remember(ORBITDB_IDENTITY_STORAGE_KEY, identityId);
	return identityId;
}

function createOrbitDBIdentityId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `simple-todo-${crypto.randomUUID()}`;
	}

	return `simple-todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getReadOnlyDiagnostics() {
	return {
		getPeerId: () => peerId,
		getDatabaseName: () => activeTodoDatabaseName,
		getDatabaseAddress: () => get(todoDBAddressStore),
		getDatabasePeers: () => Array.from(todoDB?.peers ?? [], String),
		getMultiaddrs: () => {
			const ownAddrs =
				libp2p?.getMultiaddrs?.().map((/** @type {any} */ addr) => addr.toString()) ?? [];
			const peerStoreAddrs =
				libp2p?.peerStore?.addressBook
					?.get?.(libp2p?.peerId)
					?.multiaddrs?.map((/** @type {any} */ addr) => addr.toString()) ?? [];
			return Array.from(new Set([...ownAddrs, ...peerStoreAddrs]));
		},
		getConnections: () =>
			libp2p?.getConnections?.().map((/** @type {any} */ connection) => ({
				remotePeer: connection.remotePeer?.toString() ?? null,
				remoteAddr: connection.remoteAddr?.toString() ?? null,
				// Relayed or direct is the connection's limits, not its address
				// (AGENTS.md); `/noise` + `/yamux` is relayed, `native` + `/webrtc`
				// is not.
				limited: connection.limits != null,
				direction: connection.direction ?? null,
				encryption: connection.encryption ?? null,
				multiplexer: connection.multiplexer ?? null
			})) ?? [],
		// Read-only gossipsub introspection for the remote-replication E2E: live
		// head propagation runs over pubsub on the database topic, and a run has
		// shown both browsers fully synced and relay-joined while the freshly
		// created entry still never arrived. These getters make the topic
		// subscriptions and the gossipsub mesh observable from the test so that
		// failure mode is attributable instead of an opaque timeout.
		getPubsubState: () => {
			const pubsub = /** @type {any} */ (libp2p?.services?.pubsub);
			if (!pubsub) return null;
			const topics = pubsub.getTopics?.() ?? [];
			return {
				topics,
				peers: (pubsub.getPeers?.() ?? []).map(String),
				subscribers: Object.fromEntries(
					topics.map((/** @type {string} */ topic) => [
						topic,
						(pubsub.getSubscribers?.(topic) ?? []).map(String)
					])
				),
				mesh: Object.fromEntries(
					Array.from(pubsub.mesh?.entries?.() ?? [], ([topic, peers]) => [
						topic,
						Array.from(peers ?? [], String)
					])
				)
			};
		}
	};
}

function installPublicDiagnostics() {
	if (typeof window === 'undefined') return;

	/** @type {Window & typeof globalThis & { __simpleTodoDiagnostics?: Record<string, unknown> }} */ (
		window
	).__simpleTodoDiagnostics = Object.freeze(getReadOnlyDiagnostics());
}

function installE2ETestHooks() {
	if (typeof window === 'undefined' || import.meta.env.VITE_E2E !== 'true') return;

	const diagnostics = getReadOnlyDiagnostics();

	/** @type {Window & typeof globalThis & { __simpleTodoE2E?: Record<string, unknown> }} */ (
		window
	).__simpleTodoE2E = {
		...diagnostics,
		getConnectionCount: () => libp2p?.getConnections?.().length ?? 0,
		getConnectedPeerIds: () =>
			libp2p
				?.getConnections?.()
				.map((/** @type {any} */ connection) => connection.remotePeer?.toString())
				.filter(Boolean) ?? [],
		getDiscoveredPeerIds: () => Array.from(discoveredPeers.keys()),
		getDiscoveredPeers: () =>
			Array.from(discoveredPeers.entries()).map(([peerId, peer]) => ({
				peerId,
				multiaddrs: peer.multiaddrs.map((/** @type {any} */ addr) => addr.toString())
			})),
		getOrbitDBIdentity: () =>
			orbitdb?.identity
				? {
						id: orbitdb.identity.id ?? null,
						publicKey: orbitdb.identity.publicKey ?? null,
						hash: orbitdb.identity.hash ?? null,
						type: orbitdb.identity.type ?? null
					}
				: null,
		hasOrbitDBIdentity: async (/** @type {unknown} */ hash) =>
			typeof hash === 'string' && Boolean(await orbitdb?.identities?.getIdentity?.(hash)),
		getWebRTCEnabled,
		// #127: what the open list's log holds, as any peer with its address
		// receives it -- for the specs that prove a stranger reads nothing.
		getOpenListEntries: async () => {
			const db = get(todoDBStore);
			const entries = (await db?.log?.values?.()) ?? [];
			return entries.map((/** @type {any} */ entry) => ({
				key: entry?.payload?.key ?? null,
				op: entry?.payload?.op ?? null,
				value: entry?.payload?.value ?? null
			}));
		},
		// #127: the records a fresh device with this passkey needs -- the
		// registry, the open list and its key store -- by address and hash, so a
		// spec can wait until the relay holds each one before it wipes the device.
		getRecordsToRestore: async () => {
			const databases = [
				['registry', openedListRegistry()],
				['list', get(todoDBStore)],
				['keys', activeKeyStore()]
			];
			return Promise.all(
				databases.map(async ([role, db]) => ({
					role,
					address: db?.address ? String(db.address) : null,
					records: db
						? ((await db.all?.()) ?? [])
								.filter((/** @type {any} */ record) => record?.hash)
								.map((/** @type {any} */ record) => ({
									key: String(record.key),
									hash: String(record.hash)
								}))
						: []
				}))
			);
		},
		setWebRTCEnabled,
		connectToMultiaddr,
		accountDirectory: accountDirectoryForTests()
	};
}

/**
 * The account directory (chain/account-directory.js), for the spec that checks
 * a delegate's published account reaches the payer (account-directory.spec.js).
 * Budgets run against the fake in E2E builds, and the fake never opens the
 * directory, so the hook drives it with the same code the Sepolia service uses,
 * loaded on first use as there. `inspect` also tells which peer delivered what:
 * the spec has to tell the owner's answer from the relay's.
 */
function accountDirectoryForTests() {
	/** @type {Promise<ReturnType<typeof import('./chain/account-directory.js').createAccountDirectory>> | null} */
	let loading = null;
	const directory = () =>
		(loading ??= import('./chain/account-directory.js').then(({ createAccountDirectory }) =>
			createAccountDirectory(() => orbitdb)
		));
	/** @type {Array<{ at: number, did: string, event: string, peer?: string, detail?: string }>} */
	const events = [];
	/** @type {Map<string, Promise<any>>} */
	const watched = new Map();

	/** @param {string} did */
	function watch(did) {
		const known = watched.get(did);
		if (known) return known;
		const watching = (async () => {
			// The directory's own database: a second open of the address would
			// register OrbitDB's heads protocol twice.
			const database = await (await directory()).database(did);
			const topic = String(database.address);
			/** @param {string} event @param {any} [peer] @param {any} [detail] */
			const note = (event, peer, detail) =>
				events.push({
					at: Date.now(),
					did,
					event,
					...(peer ? { peer: String(peer) } : {}),
					...(detail
						? { detail: String(detail?.name ?? '') + ': ' + String(detail?.message ?? detail) }
						: {})
				});
			database.events.on('join', (/** @type {any} */ peer) => note('join', peer));
			database.events.on('leave', (/** @type {any} */ peer) => note('leave', peer));
			database.events.on('update', () => note('update'));
			database.events.on('error', (/** @type {any} */ error) => note('error', null, error));
			libp2p?.services?.pubsub?.addEventListener('message', (/** @type {any} */ event) => {
				if (event.detail?.topic === topic) note('pubsub-message', event.detail?.from);
			});
			return database;
		})();
		watched.set(did, watching);
		return watching;
	}

	return {
		/** @param {{ address: `0x${string}`, chainId: number }} account */
		publish: async (account) => {
			const did = orbitdb.identity.id;
			await (await directory()).publish(did, account);
			await watch(did);
		},
		/** @param {string} did @param {{ chainId: number, timeoutMs?: number }} options */
		lookup: async (did, options) => {
			// The directory's own order first (identity topic, then the database);
			// the watch then finds the database it opened.
			const pending = (await directory()).lookup(did, options);
			await watch(did);
			return pending;
		},
		/** @param {string} did */
		inspect: async (did) => {
			const database = await watch(did);
			return {
				address: String(database.address),
				peers: Array.from(database.peers ?? [], String),
				value: (await database.get('account')) ?? null,
				events: events.filter((entry) => entry.did === did)
			};
		}
	};
}

function setupPubsubDiscoveryAutoDial() {
	if (!libp2p) return;

	/** @param {Event} event */
	const handlePeerDiscovery = async (event) => {
		const detail = /** @type {CustomEvent<{ id?: { toString(): string }, multiaddrs?: any[] }>} */ (
			event
		).detail;
		const discoveredPeer = detail?.id;
		const discoveredPeerId = discoveredPeer?.toString();

		if (!discoveredPeer || !discoveredPeerId || discoveredPeerId === peerId) {
			return;
		}

		const peerInfo = updateDiscoveredPeer(discoveredPeer, detail?.multiaddrs ?? []);

		await dialDiscoveredPeer(discoveredPeerId, peerInfo, 'peer:discovery');
	};

	const handleConnectivityChanged = async () => {
		await retryDiscoveredPeerDials('connectivity:update');
	};

	libp2p.addEventListener('peer:discovery', handlePeerDiscovery);
	libp2p.addEventListener('self:peer:update', handleConnectivityChanged);
	libp2p.addEventListener('peer:update', handleConnectivityChanged);
	libp2p.addEventListener('connection:close', handleConnectivityChanged);
	startDiscoveryDialRetryInterval();
}

/**
 * Circuit Relay discovery and bootstrap dialing are independent libp2p
 * subsystems. If Identify learns that an already-connected bootstrap peer is a
 * HOP relay after the generic `/p2p-circuit` listener searched for one, no
 * reservation may be created. Explicitly reserve one connected HOP relay so
 * AddressManager can advertise a browser-dialable circuit/WebRTC address.
 */
function setupAutomaticRelayReservations() {
	if (!libp2p) return;

	const reserveFromConnections = () => {
		if (!libp2p || hasCircuitRelayAddress()) return;

		for (const connection of libp2p.getConnections()) {
			const remotePeerId = connection.remotePeer?.toString?.();
			const remoteAddr = connection.remoteAddr;
			if (!remotePeerId || !remoteAddr || remoteAddr.toString().includes('/p2p-circuit/')) continue;
			void reserveConnectedRelayOnce(remoteAddr, connection.remotePeer).then((reserved) => {
				if (reserved) {
					console.info(`Reserved Circuit Relay v2 peer ${remotePeerId}`);
				}
			});
		}
	};

	libp2p.addEventListener('connection:open', reserveFromConnections);
	libp2p.addEventListener('peer:update', reserveFromConnections);
	reserveFromConnections();
}

function hasCircuitRelayAddress() {
	return (
		libp2p
			?.getMultiaddrs?.()
			.some((/** @type {any} */ addr) => addr.toString().includes('/p2p-circuit')) ?? false
	);
}

function startDiscoveryDialRetryInterval() {
	stopDiscoveryDialRetryInterval();
	discoveryDialRetryInterval = setInterval(() => {
		void retryDiscoveredPeerDials('periodic:discovery-retry').catch((error) => {
			console.warn(
				'Failed to retry discovered peer dials:',
				error instanceof Error ? error.message : String(error)
			);
		});
	}, DISCOVERY_DIAL_PERIODIC_RETRY_MS);
}

function stopDiscoveryDialRetryInterval() {
	if (!discoveryDialRetryInterval) return;

	clearInterval(discoveryDialRetryInterval);
	discoveryDialRetryInterval = null;
}

/**
 * @param {any} discoveredPeer
 * @param {any[]} multiaddrs
 */
function updateDiscoveredPeer(discoveredPeer, multiaddrs) {
	const discoveredPeerId = discoveredPeer.toString();
	const existingPeerInfo = discoveredPeers.get(discoveredPeerId);
	const normalizedMultiaddrs = normalizeDiscoveredMultiaddrs(discoveredPeerId, multiaddrs);
	const mergedMultiaddrs = dedupeMultiaddrs([
		...(existingPeerInfo?.multiaddrs ?? []),
		...normalizedMultiaddrs
	]);

	const peerInfo = {
		peer: discoveredPeer,
		multiaddrs: mergedMultiaddrs,
		isDialing: existingPeerInfo?.isDialing ?? false,
		lastDialAttemptAt: existingPeerInfo?.lastDialAttemptAt ?? 0
	};

	discoveredPeers.set(discoveredPeerId, peerInfo);
	return peerInfo;
}

/**
 * @param {string} discoveredPeerId
 * @param {any[]} multiaddrs
 * @returns {any[]}
 */
/**
 * @param {any[]} multiaddrs
 * @returns {any[]}
 */
function dedupeMultiaddrs(multiaddrs) {
	return Array.from(new Map(multiaddrs.map((addr) => [addr.toString(), addr])).values());
}

/**
 * @param {string} discoveredPeerId
 * @param {{ peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }} peerInfo
 * @param {string} reason
 */
async function dialDiscoveredPeer(discoveredPeerId, peerInfo, reason) {
	return dialDiscoveredPeerWithOptions(discoveredPeerId, peerInfo, reason, {});
}

/**
 * @param {string} discoveredPeerId
 * @param {{ peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }} peerInfo
 * @param {string} reason
 * @param {{ force?: boolean }} options
 */
async function dialDiscoveredPeerWithOptions(
	discoveredPeerId,
	peerInfo,
	reason,
	{ force = false } = {}
) {
	if (!libp2p) return;

	if (peerInfo.isDialing) {
		return;
	}

	if (!force && !shouldDialDiscoveredPeer(peerInfo)) {
		return;
	}

	const dialCandidates = selectDiscoveredDialCandidates(peerInfo.multiaddrs);
	const existingConnections = libp2p.getConnections(peerInfo.peer) ?? [];
	const shouldAttemptWebRTCUpgrade =
		getWebRTCEnabled() &&
		existingConnections.length > 0 &&
		!hasWebRTCConnection(existingConnections) &&
		dialCandidates.some(isWebRTCDialCandidate);

	if (existingConnections.length > 0 && !shouldAttemptWebRTCUpgrade) {
		return;
	}

	peerInfo.isDialing = true;
	peerInfo.lastDialAttemptAt = Date.now();

	try {
		await mergeDiscoveredPeerMultiaddrs(peerInfo.peer, dialCandidates);

		console.log('🔍 Pubsub discovered peer, dialing:', {
			peerId: discoveredPeerId,
			reason,
			candidates: dialCandidates.map((addr) => addr.toString())
		});

		await dialDiscoveredPeerCandidates(peerInfo.peer, dialCandidates);
	} catch (error) {
		console.warn(
			'Failed to dial pubsub-discovered peer:',
			discoveredPeerId,
			error instanceof Error ? error.message : String(error)
		);
	} finally {
		peerInfo.isDialing = false;
	}
}

/**
 * @param {any[]} connections
 * @returns {boolean}
 */
function hasWebRTCConnection(connections) {
	return connections.some(isWebRTCConnection);
}

/**
 * @param {any} connection
 * @returns {boolean}
 */
function isWebRTCConnection(connection) {
	return connection.remoteAddr?.toString().toLowerCase().includes('/webrtc') ?? false;
}

/**
 * @param {any} peer
 * @param {any[]} multiaddrs
 */
async function mergeDiscoveredPeerMultiaddrs(peer, multiaddrs) {
	if (!libp2p?.peerStore?.merge || multiaddrs.length === 0) return;

	await libp2p.peerStore.merge(peer, { multiaddrs });
}

/**
 * @param {any} peer
 * @param {any[]} dialCandidates
 */
async function dialDiscoveredPeerCandidates(peer, dialCandidates) {
	const errors = [];

	for (const candidate of dialCandidates) {
		try {
			return await libp2p.dial(candidate, { signal: createDialTimeoutSignal() });
		} catch (error) {
			errors.push({
				target: candidate.toString(),
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	if (!getWebRTCEnabled()) {
		throw new Error(JSON.stringify(errors));
	}

	try {
		return await libp2p.dial(peer, { signal: createDialTimeoutSignal() });
	} catch (error) {
		errors.push({
			target: peer.toString(),
			error: error instanceof Error ? error.message : String(error)
		});
	}

	throw new Error(JSON.stringify(errors));
}

/**
 * @returns {AbortSignal | undefined}
 */
function createDialTimeoutSignal() {
	return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
		? AbortSignal.timeout(DISCOVERY_DIAL_TIMEOUT_MS)
		: undefined;
}

/**
 * @param {any[]} multiaddrs
 * @returns {any[]}
 */
function selectDiscoveredDialCandidates(multiaddrs) {
	const candidates = multiaddrs.filter(isBrowserDialableDiscoveredAddress);

	if (!getWebRTCEnabled()) {
		return candidates
			.filter((addr) => !isWebRTCDialCandidate(addr))
			.sort(rankDiscoveredDialCandidate);
	}

	return candidates.sort(rankDiscoveredDialCandidate);
}

/**
 * @param {any} addr
 * @returns {boolean}
 */
function isBrowserDialableDiscoveredAddress(addr) {
	const normalized = addr.toString().toLowerCase();
	const usesBrowserReachableTransport =
		normalized.includes('/ws') ||
		normalized.includes('/wss') ||
		normalized.includes('/webrtc') ||
		normalized.includes('/webrtc-direct');

	return normalized.includes('/p2p/') && usesBrowserReachableTransport;
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
function rankDiscoveredDialCandidate(a, b) {
	return rankDiscoveredDialCandidateAddress(a) - rankDiscoveredDialCandidateAddress(b);
}

/**
 * @param {any} addr
 * @returns {number}
 */
function rankDiscoveredDialCandidateAddress(addr) {
	const normalized = addr.toString().toLowerCase();
	const usesRelayCircuit = normalized.includes('/p2p-circuit');
	const usesWebSocket = normalized.includes('/ws') || normalized.includes('/wss');
	const usesWebRTC = normalized.includes('/webrtc');

	if (usesRelayCircuit && usesWebSocket && usesWebRTC) return 0;
	if (usesRelayCircuit && usesWebSocket && !usesWebRTC) return 1;
	if (normalized.includes('/webrtc-direct')) return 2;
	if (usesWebRTC) return 3;
	if (usesWebSocket) return 4;
	return 10;
}

/**
 * @param {any} addr
 * @returns {boolean}
 */
function isWebRTCDialCandidate(addr) {
	return addr.toString().toLowerCase().includes('/webrtc');
}

/**
 * @param {string} reason
 */
async function retryDiscoveredPeerDials(reason, { force = false } = {}) {
	for (const [discoveredPeerId, peerInfo] of discoveredPeers) {
		await dialDiscoveredPeerWithOptions(discoveredPeerId, peerInfo, reason, { force });
	}
}

/**
 * @param {{ lastDialAttemptAt: number }} peerInfo
 * @returns {boolean}
 */
function shouldDialDiscoveredPeer(peerInfo) {
	if (!peerInfo.lastDialAttemptAt) return true;

	return Date.now() - peerInfo.lastDialAttemptAt >= DISCOVERY_DIAL_RETRY_COOLDOWN_MS;
}

/**
 * Attempt to connect to a remote peer via a multiaddress.
 *
 * @param {string} address
 * @returns {Promise<{ status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string }>}
 */
export async function connectToMultiaddr(address) {
	const normalizedAddress = address.trim();

	if (!normalizedAddress) {
		throw new Error(translate('network.connect.enterAddress'));
	}

	if (!normalizedAddress.startsWith('/')) {
		throw new Error(translate('network.connect.mustStartWithSlash'));
	}

	if (!libp2p) {
		throw new Error(translate('network.connect.notInitialized'));
	}

	let target;

	try {
		target = multiaddr(normalizedAddress);
	} catch (error) {
		throw new Error(
			translate('network.connect.invalid', {
				reason: error instanceof Error ? error.message : String(error)
			})
		);
	}

	if (extractPeerIdFromMultiaddr(normalizedAddress) == null) {
		throw new Error(translate('network.connect.needsPeerId'));
	}

	if (!getWebRTCEnabled() && normalizedAddress.toLowerCase().includes('/webrtc')) {
		throw new Error(translate('network.connect.webrtcDisabled'));
	}

	const connection = await libp2p.dial(target);
	const outcome = await waitForManualConnectionOutcome(connection);
	await reserveConnectedRelayOnce(target, connection.remotePeer);

	return {
		status: outcome.status,
		detail: outcome.detail,
		remotePeer: connection.remotePeer?.toString() ?? null,
		remoteAddr: connection.remoteAddr?.toString() ?? normalizedAddress
	};
}

/**
 * Reserve a connected Circuit Relay v2 peer so this browser advertises a
 * dialable circuit address through an automatic bootstrap or manually selected
 * relay.
 *
 * @param {any} target
 * @param {any} remotePeer
 */
async function reserveConnectedRelay(target, remotePeer) {
	if (!libp2p || target.toString().includes('/p2p-circuit/')) return false;

	const relaySegment = `/p2p/${remotePeer.toString()}/p2p-circuit`;
	if (
		libp2p.getMultiaddrs().some((/** @type {any} */ addr) => addr.toString().includes(relaySegment))
	)
		return true;

	const deadline = Date.now() + CIRCUIT_RELAY_PROTOCOL_WAIT_MS;
	let supportsCircuitRelay = false;
	while (Date.now() < deadline) {
		const peer = await libp2p.peerStore.get(remotePeer).catch(() => null);
		supportsCircuitRelay = peer?.protocols?.includes(CIRCUIT_RELAY_HOP_PROTOCOL) ?? false;
		if (supportsCircuitRelay) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	if (!supportsCircuitRelay) return false;

	try {
		await libp2p.components.transportManager.listen([target.encapsulate('/p2p-circuit')]);
		return true;
	} catch (error) {
		console.warn(
			'Connected to relay but could not create a circuit reservation:',
			error instanceof Error ? error.message : String(error)
		);
		return false;
	}
}

/**
 * Share one reservation attempt between automatic connection events and the
 * manual custom-multiaddress flow. Calling TransportManager.listen twice for
 * the same relay creates competing listeners and can stall relay setup.
 *
 * @param {any} target
 * @param {any} remotePeer
 * @returns {Promise<boolean>}
 */
function reserveConnectedRelayOnce(target, remotePeer) {
	const remotePeerId = remotePeer.toString();
	const existingAttempt = relayReservationAttempts.get(remotePeerId);
	if (existingAttempt) return existingAttempt;

	const attempt = reserveConnectedRelay(target, remotePeer).finally(() => {
		if (relayReservationAttempts.get(remotePeerId) === attempt) {
			relayReservationAttempts.delete(remotePeerId);
		}
	});
	relayReservationAttempts.set(remotePeerId, attempt);
	return attempt;
}

/**
 * Verify that a specific relay multiaddress accepts the libp2p ping protocol.
 * `force` is important here: without it libp2p may reuse another open connection
 * to the same peer and incorrectly mark this particular address as reachable.
 *
 * @param {string} address
 * @returns {Promise<number>} round-trip time in milliseconds
 */
export async function pingMultiaddr(address) {
	if (!libp2p?.services?.ping) {
		throw new Error('P2P ping service is not initialized yet.');
	}

	const target = multiaddr(address.trim());
	return libp2p.services.ping.ping(target, {
		force: true,
		signal: AbortSignal.timeout(RELAY_PING_TIMEOUT_MS)
	});
}

/**
 * @param {string} addr
 * @returns {string | null}
 */
function extractPeerIdFromMultiaddr(addr) {
	const parts = addr.split('/').filter(Boolean);
	const peerIndex = parts.findIndex((part) => part === 'p2p' || part === 'ipfs');
	return peerIndex >= 0 ? parts[peerIndex + 1] || null : null;
}

/**
 * Watch a freshly-opened manual connection long enough to distinguish
 * a stable handshake from a remote peer that drops during follow-up setup.
 *
 * @param {any} connection
 * @returns {Promise<{ status: 'stable' | 'dropped', detail: string }>}
 */
function waitForManualConnectionOutcome(connection) {
	return new Promise((resolve) => {
		if (!libp2p) {
			resolve({
				status: 'dropped',
				detail: translate('network.connect.nodeGone')
			});
			return;
		}

		let settled = false;

		/**
		 * @param {{ status: 'stable' | 'dropped', detail: string }} outcome
		 */
		const finish = (outcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			libp2p.removeEventListener('connection:close', handleConnectionClose);
			resolve(outcome);
		};

		/** @type {EventListener} */
		const handleConnectionClose = (event) => {
			const closedConnection = /** @type {CustomEvent<any>} */ (event).detail;

			if (closedConnection?.id !== connection.id) {
				return;
			}

			finish({
				status: 'dropped',
				detail: translate('network.connect.droppedDetail')
			});
		};

		const timeoutId = setTimeout(() => {
			finish({
				status: 'stable',
				detail: translate('network.connect.stableDetail', {
					seconds: MANUAL_CONNECT_STABILIZATION_MS / 1000
				})
			});
		}, MANUAL_CONNECT_STABILIZATION_MS);

		libp2p.addEventListener('connection:close', handleConnectionClose);
	});
}
