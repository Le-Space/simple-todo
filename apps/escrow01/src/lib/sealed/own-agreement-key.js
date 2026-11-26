/**
 * Where this session's personal X25519 key comes from (#127).
 *
 * - **With PRF:** from the passkey's PRF output (./key-agreement.js). The
 *   caller hands in an output it already read; nothing here asks the passkey.
 * - **Without PRF** — GrapheneOS, Android without Play services, a copied
 *   credential: there is nothing to derive from. Then the key is 32 random
 *   bytes kept **in clear** in this browser, per DID, and the app says so,
 *   recommending a browser without extensions or a profile of its own (user
 *   decision, 25.11.2026). Whoever reads this browser's storage reads every
 *   list sealed for that key.
 *
 * The device key follows the storage choice like everything else the app
 * keeps (`@simple-todo/todo/browser-memory.js`): with "Keep in this browser"
 * it is in `localStorage`; with "In memory only" it dies with the tab, and
 * lists sealed for it cannot be opened again after a reload. That matches the
 * identity itself, which without PRF is per device and, in memory mode, per
 * tab.
 */
import { forget, recall, remember } from '@simple-todo/todo/browser-memory.js';
import { agreementKeyFromPrf, agreementKeyFromSeed } from './key-agreement.js';
import { base64OrNull, toBase64 } from './bytes.js';

const DEVICE_KEY_PREFIX = 'simpleTodo.escrow01.deviceAgreementKey.';
const SEED_BYTES = 32;

/** @param {string} did */
const storageKeyFor = (did) => `${DEVICE_KEY_PREFIX}${did}`;

/**
 * This session's key: from the PRF output when there is one, else the device
 * key.
 *
 * @param {{ did: string, prfOutput?: Uint8Array | null }} options
 * @returns {Promise<import('./key-agreement.js').AgreementKey>}
 */
export async function ownAgreementKey({ did, prfOutput }) {
	if (prfOutput) return agreementKeyFromPrf(prfOutput);
	return deviceAgreementKey(did);
}

/**
 * The random key this browser keeps for `did`, made on first use.
 *
 * @param {string} did
 * @returns {Promise<import('./key-agreement.js').AgreementKey>}
 */
export async function deviceAgreementKey(did) {
	if (typeof did !== 'string' || did.length === 0) {
		throw new TypeError('A device key belongs to one identity.');
	}
	const stored = base64OrNull(recall(storageKeyFor(did)));
	if (stored?.length === SEED_BYTES) return agreementKeyFromSeed(stored, 'device');

	const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
	remember(storageKeyFor(did), toBase64(seed));
	return agreementKeyFromSeed(seed, 'device');
}

/**
 * Whether this browser holds a device key for `did`, without making one.
 *
 * @param {string} did
 */
export function hasDeviceAgreementKey(did) {
	return base64OrNull(recall(storageKeyFor(did)))?.length === SEED_BYTES;
}

/**
 * Drop the device key. Lists sealed only for it cannot be opened again.
 *
 * @param {string} did
 */
export function forgetDeviceAgreementKey(did) {
	forget(storageKeyFor(did));
}
