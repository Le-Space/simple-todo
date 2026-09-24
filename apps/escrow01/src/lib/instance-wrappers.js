import { keepLogsWhereTheChoiceSays } from '@simple-todo/todo/keep-logs-in-memory.js';
import { withSyncErrorHandling } from './database-sync-errors.js';

/**
 * What every OrbitDB instance this app creates is wrapped in, whichever
 * identity it was created with.
 *
 * One function for both branches of `createOrbitDBInstance`, because the two
 * drifted: the anonymous branch kept its logs where the storage choice said
 * and the passkey branch did not. Every `open` in the app passed storages of
 * its own except the account directory, which in memory mode with a passkey
 * then left its `_heads/` and `_index/` in IndexedDB.
 *
 * @template T
 * @param {T & { open: (target: string, options?: any) => Promise<any> }} orbitdb
 * @returns {T}
 */
export function wrapInstance(orbitdb) {
	return withSyncErrorHandling(keepLogsWhereTheChoiceSays(orbitdb));
}
