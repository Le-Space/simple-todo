import { describe, expect, it } from 'vitest';
import { uiMessages } from './messages.js';

/**
 * @param {any} node
 * @param {string} [prefix]
 * @returns {string[]}
 */
function paths(node, prefix = '') {
	if (typeof node !== 'object' || node === null) return [prefix];
	return Object.entries(node).flatMap(([key, value]) =>
		paths(value, prefix ? `${prefix}.${key}` : key)
	);
}

describe('the shared components’ wording', () => {
	it('exists in both languages, key for key', () => {
		const english = paths(uiMessages.en);
		const german = paths(uiMessages.de);
		expect(german.filter((key) => !english.includes(key))).toEqual([]);
		expect(english.filter((key) => !german.includes(key))).toEqual([]);
	});

	it('stays under `ui.`, where no chapter key can collide with it', () => {
		expect(Object.keys(uiMessages.en)).toEqual(['ui']);
		expect(Object.keys(uiMessages.de)).toEqual(['ui']);
	});

	it('has no empty message', () => {
		for (const language of [uiMessages.en, uiMessages.de]) {
			for (const key of paths(language)) {
				const value = key.split('.').reduce((node, part) => node[part], /** @type {any} */ (language));
				expect(typeof value === 'string' && value.trim().length > 0, key).toBe(true);
			}
		}
	});
});
