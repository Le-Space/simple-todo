/**
 * What this tab is holding instead of the device.
 *
 * Its own module, and deliberately without imports: `browser-memory.js` needs
 * the storage choice to decide where a value goes, and `storage-mode.js` needs
 * to empty this when it wipes. Putting the Map in either one would make them
 * import each other -- the cycle that once broke both modules at load time in
 * this codebase (see the note in `storage-mode.js` about `db-actions.js`).
 */

/** @type {Map<string, string>} */
export const session = new Map();

/** Everything this tab is holding, dropped. */
export function forgetSession() {
	session.clear();
}
