// The lists' vault (invoice01): what every passkey of these lists opens alike.
//
// A sealed list needs a key, and the key has to come from somewhere every
// passkey of its owner reaches. One passkey alone needs no vault: its PRF
// output is the same on every device, so the key derived from it is too (that
// is archived01's list key). A second passkey -- the backup YubiKey in the
// drawer -- has another PRF output, derives another key, and would find
// nothing.
//
// So the root every key here is derived from sits in a vault, sealed under a
// random vault key, and each passkey of the lists gets a slot: the vault key
// sealed under a key only that passkey derives. Any slot opens the vault, and
// the root comes out unchanged. This is Belege's vault (Le-Space/belege#406),
// kept by the provider's `createVaultKeeper` since 0.12.0, in Belege's format.
//
// As in Belege, the root is the PRF output of the passkey that made the vault,
// unchanged. That passkey therefore needs no vault to reach its own lists: on
// a device that has never seen it, a new vault is made with the same root, and
// every key comes out as it was. A passkey added later reaches the root only
// where its slot is -- the vault is kept in this origin's storage, beside the
// lists, and invoice01 has no index elsewhere to find it by (Belege has one on
// Aleph). The chapter README says so.
//
// The vault also names the list registry (list-registry.js). That registry's
// name is derived from a signature of the founding passkey's identity, which a
// second passkey cannot make; its address in the vault is how the second
// passkey finds the lists at all.
//
// Nothing here runs unless it is used: no vault, no extra touch. The start
// opens one only when this browser keeps a vault with this passkey's slot; a
// sealed list or a second passkey makes the first one.

import { writable } from 'svelte/store';
import {
	createVaultKeeper,
	deriveSubkey,
	readPrfOutput,
	rootOf
} from '@le-space/orbitdb-identity-provider-webauthn-did/vault';
import { recall, remember } from '@simple-todo/todo/browser-memory.js';

/** Where the vaults are kept: through `remember`, so the storage choice decides. */
export const VAULTS_STORAGE_KEY = 'simpleTodo.invoice01.vaults.v1';
/** Bumping this gives every passkey a new slot key: no slot would open any more. */
export const VAULT_SLOT_INFO = 'simple-todo/invoice01/vault-slot/v1';
/** Bumping this rotates the list key: lists sealed before become unreadable. */
export const LIST_KEY_INFO = 'simple-todo/invoice01/list-key/v1';

const PAYLOAD_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @typedef {{ kid: string, label: string, addedAt: string, mine: boolean }} VaultSlot
 * @typedef {{ slots: VaultSlot[], registry: string }} VaultView
 */

/** What the panel shows: the open vault's slots, or null while none is open. */
export const listVaultStore = writable(/** @type {VaultView | null} */ (null));

const keeper = createVaultKeeper({
	storage: { getItem: recall, setItem: remember },
	key: VAULTS_STORAGE_KEY,
	slotInfo: VAULT_SLOT_INFO
});

/** @type {any} the passkey this session runs as */
let credential = null;
/** @type {Uint8Array | null} read once at registration, so the first vault costs no touch */
let heldPrfOutput = null;
/** @type {any} from `keeper.open` */
let opened = null;
/** @type {Promise<any> | null} */
let opening = null;
/** @type {Promise<any> | null} */
let encryption = null;

/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The vault's payload: `rootPayload`'s bytes plus the registry's address.
 * `rootOf` reads the root and passes over the rest.
 *
 * @param {Uint8Array} root
 * @param {string} registry
 */
const payloadOf = (root, registry) =>
	encoder.encode(JSON.stringify({ version: PAYLOAD_VERSION, root: toHex(root), registry }));

/** @param {Uint8Array} payload */
function registryIn(payload) {
	try {
		const { registry } = JSON.parse(decoder.decode(payload));
		return typeof registry === 'string' && registry.startsWith('/orbitdb/') ? registry : '';
	} catch {
		return '';
	}
}

function publish() {
	if (!opened) {
		listVaultStore.set(null);
		return;
	}
	listVaultStore.set({
		slots: opened.record.slots.map((/** @type {any} */ slot) => ({
			kid: slot.kid,
			label: slot.label ?? '',
			addedAt: slot.addedAt ?? '',
			mine: slot.kid === opened.kid
		})),
		registry: registryIn(opened.payload)
	});
}

/**
 * The passkey this session runs as. Another one closes the vault: its slot is
 * not this one's.
 *
 * @param {any} next the provider's credential, or null without a passkey
 * @param {{ prfOutput?: Uint8Array | null }} [read] the PRF output the start read anyway
 */
export function setVaultCredential(next, { prfOutput = null } = {}) {
	if (next !== credential) {
		credential = next;
		opened = null;
		opening = null;
		encryption = null;
		publish();
	}
	heldPrfOutput = next && prfOutput instanceof Uint8Array ? Uint8Array.from(prfOutput) : null;
}

/** True when this session runs as a passkey, which is what a vault needs. */
export function canHaveVault() {
	return Boolean(credential?.rawCredentialId);
}

/**
 * What this browser keeps for the session's passkey, without asking it.
 *
 * @returns {Promise<{ here: boolean, removed: boolean }>}
 * @throws {import('@le-space/orbitdb-identity-provider-webauthn-did/vault').VaultError}
 *   `VAULT_STORE_UNREADABLE` when the kept vaults cannot be read
 */
export async function vaultStatus() {
	if (!canHaveVault()) return { here: false, removed: false };
	const { here, removed } = await keeper.status(credential.rawCredentialId);
	return { here, removed };
}

/** True while a vault is open. */
export function isVaultOpen() {
	return Boolean(opened);
}

/** The registry the open vault names, or '' -- then this passkey's own one. */
export function vaultRegistryAddress() {
	return opened ? registryIn(opened.payload) : '';
}

/**
 * Open the vault this passkey has a slot in, or make one.
 *
 * Asks the passkey for its PRF output unless one is given or held, so call it
 * from a click. A new vault holds this passkey's PRF output as the root and
 * `registry` as the lists' registry; without a registry, none is made.
 *
 * @param {{ prfOutput?: Uint8Array | null, registry?: string }} [options]
 * @returns {Promise<any>} the opened vault
 * @throws {import('@le-space/orbitdb-identity-provider-webauthn-did/vault').VaultError}
 *   `VAULT_SLOT_REMOVED` for a passkey removed here, `VAULT_NO_SLOT` when
 *   there is none and nothing to make one with
 */
export async function openListVault({ prfOutput = null, registry = '' } = {}) {
	if (opened) return opened;
	if (opening) return opening;
	if (!canHaveVault()) throw new Error('A vault needs a passkey.');

	opening = (async () => {
		const prf = prfOutput ?? heldPrfOutput ?? (await readPrfOutput(credential));
		const result = await keeper.open({
			prfOutput: prf,
			rawCredentialId: credential.rawCredentialId,
			label: String(credential.displayName ?? credential.userId ?? ''),
			...(registry ? { create: () => payloadOf(prf, registry) } : {})
		});
		opened = result;
		publish();
		return result;
	})().finally(() => {
		opening = null;
	});
	return opening;
}

/**
 * OrbitDB's `encryption` option for a sealed list, from the open vault's root.
 *
 * Every sealed list of these lists shares the one key: a passkey that opens
 * the vault opens all of them, and adding a list adds nothing to hand over.
 *
 * @returns {Promise<{ data: { encrypt: (bytes: Uint8Array) => Promise<Uint8Array>, decrypt: (value: any) => Promise<Uint8Array> } }>}
 */
export function listEncryption() {
	if (!opened) throw new Error('The vault is not open.');
	if (!encryption) {
		const root = rootOf(opened.payload);
		// Loaded here, not at the top: the consent page imports this module, and
		// the sealing pulls in dag-cbor, which nothing there needs.
		encryption = Promise.all([
			deriveSubkey(root, LIST_KEY_INFO, { length: 32 }),
			import('./entry-encryption.js')
		]).then(([key, { payloadEncryption }]) => payloadEncryption(key));
	}
	return encryption;
}

/**
 * Give the lists one more passkey: it is made now and answers once, two
 * touches, and gets its own slot. This browser goes on with its own passkey.
 *
 * @param {(label: string) => Promise<any>} createCredential makes the new passkey
 * @param {string} label shown in the passkey picker and in the panel
 * @param {{ readPrf?: (credential: any) => Promise<Uint8Array> }} [deps]
 * @returns {Promise<any>} the new passkey's credential
 */
export async function addListPasskey(createCredential, label, deps = {}) {
	if (!opened) throw new Error('The vault is not open.');
	const readPrf = deps.readPrf ?? readPrfOutput;
	const added = await createCredential(label);
	// The read names the new passkey and refuses another's answer (provider
	// 0.12.2). Before, any passkey of the site could answer, and the slot was
	// sealed under the wrong passkey's key.
	const prfOutput = await readPrf(added);
	try {
		opened = await keeper.addPasskey(opened, {
			prfOutput,
			rawCredentialId: added.rawCredentialId,
			label
		});
	} finally {
		prfOutput.fill(0);
	}
	publish();
	return added;
}

/**
 * Take a passkey's slot out. It is refused here from then on. It has seen the
 * root, and the root is the founding passkey's PRF output: what it read before
 * stays readable to it, wherever it kept a copy.
 *
 * @param {string} kid
 */
export async function removeListPasskey(kid) {
	if (!opened) throw new Error('The vault is not open.');
	opened = await keeper.removePasskey(opened, kid);
	publish();
}
