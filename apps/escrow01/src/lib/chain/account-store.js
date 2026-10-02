/**
 * What this browser remembers about a passkey's account on Sepolia (escrow01):
 * the account's address and the read key that decrypts amounts for it.
 *
 * The address is public. The read key is not money: the account delegated
 * nothing to it but Zama user decryption for the escrow and the token, until a
 * date. It still decrypts those amounts until then, so it is kept only sealed,
 * under a key the passkey derives (read-key-seal.js), and never as it is. A
 * record from before the seal still holds the key in plain text; it is read
 * once, as `legacyPrivateKey`, and the next save drops it. The setup key that
 * created the account is never stored anywhere: it is discarded as soon as the
 * passkey is registered.
 */

import { getAddress, isAddress } from 'viem';

const PREFIX = 'simpleTodo.chainAccount.v1.';

/**
 * @typedef {{
 *   version: 1
 *   algorithm: 'AES-GCM'
 *   address: `0x${string}`
 *   iv: `0x${string}`
 *   ciphertext: `0x${string}`
 * }} SealedReadKey
 *   The wallet package's `SealedZamaSessionKey`.
 *
 * @typedef {{
 *   chainId: number
 *   address: `0x${string}`
 *   session: { address: `0x${string}`, sealed: SealedReadKey | null } | null
 *   readKeyExpiresAt: number | null
 *   setupTx: string | null
 *   createdAt: string
 *   legacyPrivateKey?: `0x${string}`
 * }} ChainAccountRecord
 *   `readKeyExpiresAt` in unix seconds, as the ACL keeps it. `sealed` is null
 *   when the passkey could not seal the key (no PRF, or the touch was
 *   declined): it then lived in this session's memory only. `legacyPrivateKey`
 *   is never written; it is how a record from before the seal hands its plain
 *   key over once.
 */

/**
 * @param {() => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null} [storage]
 */
export function createAccountStore(storage = browserStorage) {
	return {
		/**
		 * @param {string} did
		 * @param {number} chainId
		 * @returns {ChainAccountRecord | null}
		 */
		load(did, chainId) {
			try {
				const raw = storage()?.getItem(PREFIX + did);
				if (!raw) return null;
				return parseRecord(JSON.parse(raw), chainId);
			} catch {
				return null;
			}
		},

		/** @param {string} did @param {ChainAccountRecord} record */
		save(did, record) {
			try {
				storage()?.setItem(PREFIX + did, JSON.stringify(toStored(record)));
			} catch {
				// Blocked storage: the account still works for this page, and the
				// next page finds it again through the published profile.
			}
		},

		/** @param {string} did */
		forget(did) {
			try {
				storage()?.removeItem(PREFIX + did);
			} catch {
				// Nothing to forget.
			}
		}
	};
}

/**
 * A stored record, or null for anything that is not one for this chain.
 *
 * @param {any} value
 * @param {number} chainId
 * @returns {ChainAccountRecord | null}
 */
export function parseRecord(value, chainId) {
	if (!value || typeof value !== 'object' || value.chainId !== chainId) return null;
	if (typeof value.address !== 'string' || !isAddress(value.address)) return null;
	const sessionAddress =
		value.session && typeof value.session.address === 'string' && isAddress(value.session.address)
			? getAddress(value.session.address)
			: null;
	const sealed = sessionAddress ? parseSealed(value.session.sealed, sessionAddress) : null;
	const legacy =
		sessionAddress && !sealed && /^0x[0-9a-fA-F]{64}$/.test(value.session.privateKey ?? '')
			? /** @type {`0x${string}`} */ (value.session.privateKey)
			: null;
	// A session names a key this device can open, one it held only in memory
	// (`sealed: null`), or one from before the seal.
	const session =
		sessionAddress && (sealed || legacy || value.session.sealed === null)
			? { address: sessionAddress, sealed }
			: null;
	/** @type {ChainAccountRecord} */
	const record = {
		chainId,
		address: getAddress(value.address),
		session,
		readKeyExpiresAt:
			session && Number.isSafeInteger(value.readKeyExpiresAt) ? value.readKeyExpiresAt : null,
		setupTx: typeof value.setupTx === 'string' ? value.setupTx : null,
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString()
	};
	if (legacy) record.legacyPrivateKey = legacy;
	return record;
}

/**
 * A sealed read key for `address`, or null for anything else.
 *
 * @param {any} value
 * @param {`0x${string}`} address
 * @returns {SealedReadKey | null}
 */
function parseSealed(value, address) {
	if (!value || typeof value !== 'object') return null;
	if (value.version !== 1 || value.algorithm !== 'AES-GCM') return null;
	if (typeof value.address !== 'string' || !isAddress(value.address)) return null;
	if (getAddress(value.address) !== address) return null;
	if (!/^0x[0-9a-fA-F]{24}$/.test(value.iv ?? '')) return null;
	if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value.ciphertext ?? '')) return null;
	return {
		version: 1,
		algorithm: 'AES-GCM',
		address,
		iv: value.iv,
		ciphertext: value.ciphertext
	};
}

/**
 * What goes into storage: the record's own fields, so nothing a caller
 * attached — a plain key above all — is written by accident.
 *
 * @param {ChainAccountRecord} record
 */
function toStored(record) {
	return {
		chainId: record.chainId,
		address: record.address,
		session: record.session
			? { address: record.session.address, sealed: record.session.sealed }
			: null,
		readKeyExpiresAt: record.readKeyExpiresAt,
		setupTx: record.setupTx,
		createdAt: record.createdAt
	};
}

function browserStorage() {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}
