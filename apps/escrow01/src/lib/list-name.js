import { isValidSpanishMnemonic } from '@simple-todo/todo/spanish-mnemonic.js';
import { isSealedListName } from './sealed/sealed-list.js';

/**
 * A private list's name, and the database name it is stored under (escrow01).
 *
 * Two lists may share a name, so the database gets a suffix that makes it
 * unique: a base36 timestamp and a few random characters,
 * "Website relaunch-mwunbvow-afwafg". The owner never sees it, because the
 * page keeps the name it was given. Somebody who opens the list by its
 * address has only the database name, and saw the suffix in the list's
 * heading, in the switcher and under "Opened list".
 */

/**
 * The database name for a private list called `name`.
 *
 * @param {string} name
 * @param {{ now?: number, random?: number }} [source] for tests
 * @returns {string}
 */
export function privateListDatabaseName(name, { now = Date.now(), random = Math.random() } = {}) {
	const suffix = `${now.toString(36)}-${random.toString(36).slice(2, 8)}`;
	return `${name.trim() || 'private-todos'}-${suffix}`;
}

// What `privateListDatabaseName` appends: "-" + 7 to 9 base36 digits (a
// millisecond timestamp has 8 from 1973 to 2059) + "-" + up to 6 more.
const SUFFIX = /^(.+)-[0-9a-z]{7,9}-[0-9a-z]{1,6}$/;

/**
 * The name to show for a list that is known only by its database name.
 *
 * A three-word share code is a name of its own and stays as it is: "luna-
 * pantalla-verde" ends in what looks like a suffix, and it is the whole name.
 *
 * @param {string | null | undefined} databaseName
 * @returns {string}
 */
export function listNameFromDatabase(databaseName) {
	const name = String(databaseName ?? '');
	// A sealed list's database name is random (#127): it names nothing, and its
	// readable name comes sealed from the list itself.
	if (isSealedListName(name)) return '';
	if (!name || isValidSpanishMnemonic(name)) return name;
	return name.match(SUFFIX)?.[1] ?? name;
}
