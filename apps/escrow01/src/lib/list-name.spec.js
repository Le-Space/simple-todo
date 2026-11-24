import { describe, expect, it } from 'vitest';
import { SPANISH_WORDS_V1 } from '@simple-todo/todo/spanish-mnemonic.js';
import { listNameFromDatabase, privateListDatabaseName } from './list-name.js';

describe('list names', () => {
	it('shows a private list by the name it was given, not its database name', () => {
		const databaseName = privateListDatabaseName('Website relaunch');
		expect(databaseName).toMatch(/^Website relaunch-[0-9a-z]+-[0-9a-z]+$/);
		expect(listNameFromDatabase(databaseName)).toBe('Website relaunch');
		// The two the demo film recorded.
		expect(listNameFromDatabase('Website relaunch-mwunbvow-afwafg')).toBe('Website relaunch');
		expect(listNameFromDatabase('Website-Relaunch-mwunrdj2-is39j7')).toBe('Website-Relaunch');
	});

	it('keeps names that carry no suffix of ours', () => {
		for (const name of ['Prüfbericht', 'Q3-plan', 'private-todos', '2026-11-24', '']) {
			expect(listNameFromDatabase(name)).toBe(name);
		}
		expect(listNameFromDatabase(undefined)).toBe('');
	});

	it('leaves a three-word share code whole, even one that looks suffixed', () => {
		// A share code whose last two words have the suffix's shape.
		const second = SPANISH_WORDS_V1.find((word) => /^[a-z]{7,9}$/.test(word));
		const third = SPANISH_WORDS_V1.find((word) => /^[a-z]{1,6}$/.test(word));
		expect(second && third).toBeTruthy();
		const words = `${SPANISH_WORDS_V1[0]}-${second}-${third}`;
		expect(listNameFromDatabase(words)).toBe(words);
	});

	it('names the default list when none was given', () => {
		const databaseName = privateListDatabaseName('  ', { now: 1_800_000_000_000, random: 0.5 });
		expect(listNameFromDatabase(databaseName)).toBe('private-todos');
	});
});
