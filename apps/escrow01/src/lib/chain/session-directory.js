/**
 * One account directory per OrbitDB instance (#127).
 *
 * Two callers need the directory now: the Sepolia budget looks up accounts,
 * and sealed lists publish and look up the X25519 key in every build. Each
 * directory answers newcomers on the database's topic (`serve` in
 * account-directory.js), so two of them on one instance would answer twice and
 * keep two sets of listeners. Both take this one instead.
 *
 * Loaded on first use, as the budget did: the directory brings viem, which a
 * build without Sepolia never needs at start.
 */

/** @typedef {ReturnType<typeof import('./account-directory.js').createAccountDirectory>} AccountDirectory */

/** @type {WeakMap<object, Promise<AccountDirectory>>} */
const byInstance = new WeakMap();

/**
 * The directory of this OrbitDB instance.
 *
 * @param {any} orbitdb
 * @returns {Promise<AccountDirectory>}
 */
export function directoryFor(orbitdb) {
	if (!orbitdb) return Promise.reject(new Error('OrbitDB is not running.'));
	let directory = byInstance.get(orbitdb);
	if (!directory) {
		directory = import('./account-directory.js').then(({ createAccountDirectory }) =>
			createAccountDirectory(() => orbitdb)
		);
		directory.catch(() => byInstance.delete(orbitdb));
		byInstance.set(orbitdb, directory);
	}
	return directory;
}

/**
 * A directory that follows the session's instance: each call goes to the
 * directory of the instance `getOrbitdb` returns then, so a restart does not
 * leave a caller with the stopped one.
 *
 * @param {() => any} getOrbitdb
 * @returns {Pick<AccountDirectory, 'publish' | 'lookup' | 'publishAgreementKey' | 'lookupAgreementKey'>}
 */
export function sessionDirectory(getOrbitdb) {
	const current = () => directoryFor(getOrbitdb());
	return {
		publish: async (did, account) => (await current()).publish(did, account),
		lookup: async (did, options) => (await current()).lookup(did, options),
		publishAgreementKey: async (did, publicKey) =>
			(await current()).publishAgreementKey(did, publicKey),
		lookupAgreementKey: async (did, options) => (await current()).lookupAgreementKey(did, options)
	};
}
