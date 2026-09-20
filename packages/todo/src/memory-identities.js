/**
 * Identities whose key material never reaches the device.
 *
 * `createOrbitDB` builds its own keystore when it is handed none:
 * `KeyStore({ path: pathJoin(directory, './keystore') })`, and `browser-level`
 * puts that in IndexedDB. So a reader who asked for nothing to be kept still
 * left behind the key that identifies this peer — the one thing a storage
 * choice most obviously covers.
 *
 * With a passkey this costs nothing at all: the provider derives the signing
 * key from the passkey's PRF output, so the same passkey yields the same
 * identity on every device and in every session, and a closed tab leaves no
 * key behind. Without PRF the keystore generates one for this session only,
 * which is why the chapters warn when an identity cannot travel.
 *
 * For an anonymous identity there is nothing to derive from, so a session-only
 * key means a new peer id after a reload. That is the honest price of the
 * promise, and it is only paid in memory mode — a reader who chose to keep
 * things keeps this too.
 */
import { Identities, KeyStore, MemoryStorage } from '@orbitdb/core';

/**
 * @param {any} ipfs a Helia instance
 * @returns {Promise<any>} Identities backed by a keystore that lives in memory
 */
export async function createMemoryIdentities(ipfs) {
	const keystore = await KeyStore({ storage: await MemoryStorage() });

	// The same thing the passkey provider's own `createSessionKeystore()` builds,
	// and marked the way it marks it: `isSessionKeystore()` reads `sessionOnly`
	// to tell a keystore that forgets from one that writes to disk. Built here
	// rather than imported so that `@simple-todo/todo` -- which `main` and
	// `collab01` use without ever touching a passkey -- does not have to depend
	// on the provider.
	keystore.sessionOnly = true;

	return Identities({ ipfs, keystore });
}
