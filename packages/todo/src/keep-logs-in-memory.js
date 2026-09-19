/**
 * Make the storage choice hold for *every* database, including the ones this
 * app never opens itself.
 *
 * `Database` puts a log's heads and index in LevelStorage -- IndexedDB, in a
 * browser -- unless it is handed storages, so each open has to pass them. That
 * worked until the places doing the opening were counted: `OrbitDBAccessController`
 * opens a database of its own inside `@orbitdb/core`
 * (`access-controllers/orbitdb.js`), with options we never see. An in-memory
 * session was therefore still leaving `…/log/_heads/` and `…/log/_index/`
 * behind for every access-controlled list, and no amount of care at our own
 * call sites could reach it.
 *
 * Wrapping the instance we get back does not help: OrbitDB hands the controller
 * a fresh `{ open, identity, ipfs }` built from its *internal* `open`
 * (`orbitdb.js:131`), so a controller never sees our object at all. The
 * controller factory is therefore where the storages have to be folded in --
 * `accessControllerKeepingLogsInMemory()` below, applied where the controller
 * is constructed.
 *
 * In persistent mode `createLogStorages()` returns nothing and this changes
 * neither the options nor the behaviour.
 */
import { createLogStorages } from './storage-mode.js';

/**
 * The same instance, with its own `open` honouring the storage choice.
 *
 * Covers what this app opens directly. An access controller opens through the
 * object OrbitDB builds for it, so it needs the wrapper below as well.
 *
 * @template {{ open: (target: string, options?: any) => Promise<any> }} T
 * @param {T} orbitdb
 * @returns {T}
 */
export function keepLogsWhereTheChoiceSays(orbitdb) {
	const open = orbitdb.open.bind(orbitdb);

	orbitdb.open = async (/** @type {string} */ target, /** @type {any} */ options = {}) =>
		open(target, { ...options, ...(await createLogStorages()) });

	return orbitdb;
}

/**
 * An access controller whose own database follows the storage choice.
 *
 * `OrbitDBAccessController` keeps its write set in a database it opens itself,
 * and so do the controllers built on it. Wrap the controller function -- the
 * one OrbitDB calls with `{ orbitdb, identities, address }` -- and the `open`
 * it is handed folds the storages in.
 *
 * @template {(args: any) => Promise<any>} T
 * @param {T} controller
 * @returns {T}
 */
export function accessControllerKeepingLogsInMemory(controller) {
	const wrapped = async (/** @type {any} */ args) =>
		controller({
			...args,
			orbitdb: {
				...args.orbitdb,
				open: async (/** @type {string} */ target, /** @type {any} */ options = {}) =>
					args.orbitdb.open(target, { ...options, ...(await createLogStorages()) })
			}
		});

	// `type` and anything else OrbitDB reads off the function itself.
	return /** @type {T} */ (Object.assign(wrapped, controller));
}
