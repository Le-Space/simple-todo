import { expect } from '@playwright/test';

import { openSection } from './sections.mjs';

/**
 * Join the public three-word list (invoice01).
 *
 * The first screen used to ask for these words before anything else, so a spec
 * could hand them to `passConsent`. They live in the lists tab now, where
 * opening a list anybody may write to is a deliberate act — so a spec that
 * wants two browsers on the same public list does what a person would do.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} words three Spanish words, `-` separated
 * @param {{ timeout?: number }} [options]
 */
export async function openPublicList(page, words, { timeout = 90000 } = {}) {
	await openSection(page, 'listen');
	// The picker's own field — the same one the first screen used to carry.
	await page.getByTestId('shared-list-mnemonic-input').fill(words);
	await page.getByTestId('public-list-open').click();
	await expect(page.getByTestId('active-shared-list-name')).toHaveText(words, { timeout });
}
