/**
 * The signing keys an earlier build kept, gone (#127).
 *
 * Until 26.11.2026, "Keep in this browser" put a passkey identity's OrbitDB
 * signing key into OrbitDB's default keystore: secp256k1, unencrypted, in this
 * browser's IndexedDB. A later visit signed with it without asking the
 * passkey. Since the user's decision that a reload asks for a touch and that
 * nothing the passkey can derive again is written down, the key is derived
 * from the start's PRF output into a keystore that lives in memory
 * (sealed/start-prf.js), and the old one is only a copy of a secret lying
 * around. This deletes it.
 *
 * The database holds nothing else: only the passkey branch of p2p.js used
 * OrbitDB's default `Identities()` keystore (`./orbitdb/identities`). An
 * anonymous identity keeps its key under `simple-todo/orbitdb/keystore`, which
 * this leaves alone — there is no secret to seal that one with.
 */

/** OrbitDB's default identity keystore, as browser-level names it. */
export const KEPT_SIGNING_KEYS_DATABASE = 'level-js-orbitdb/identities';

/**
 * Delete the old keystore, if this browser has one. Best effort: a browser
 * that cannot list its databases, or another tab holding this one open, leaves
 * it for the next start.
 *
 * @returns {Promise<boolean>} whether it was deleted
 */
export async function dropKeptSigningKeys() {
	if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
	try {
		const databases = await indexedDB.databases();
		if (!databases.some((database) => database.name === KEPT_SIGNING_KEYS_DATABASE)) return false;
		return await new Promise((resolve) => {
			const request = indexedDB.deleteDatabase(KEPT_SIGNING_KEYS_DATABASE);
			request.onsuccess = () => resolve(true);
			request.onerror = () => resolve(false);
			// Another tab of this app still has it open: it goes next time.
			request.onblocked = () => resolve(false);
		});
	} catch {
		return false;
	}
}
