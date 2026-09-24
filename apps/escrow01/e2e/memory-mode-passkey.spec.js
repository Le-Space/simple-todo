/**
 * Memory mode with a passkey leaves the device as it was found -- after work,
 * not only after sign-in.
 *
 * The passkey branch builds its OrbitDB differently from the anonymous one, so
 * the storage choice has to hold there on its own. passkey-restore.spec.js
 * takes its inventory right after the identity is ready, before any database
 * has written an entry; this one writes a todo and creates an access-controlled
 * list first, which is when a log's `_heads/` and `_index/` would reach
 * IndexedDB if an `open` went past the storage choice.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { takeStorageInventory } from '@simple-todo/e2e-kit/storage-inventory.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';
import { openSection } from './sections.mjs';

const timeout = 90000;

test('memory mode with a passkey writes nothing to this device', async ({ page }) => {
	test.setTimeout(timeout * 4);
	await addVirtualAuthenticator(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: false, identity: 'create', label: 'Forgetful' });

	const input = page.getByPlaceholder('What needs to be done?');
	await expect(input).toBeEnabled({ timeout });
	const todo = `memory-passkey-${Date.now().toString(36)}`;
	await input.fill(todo);
	await input.press('Enter');
	await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });

	await openSection(page, 'listen');
	await page.getByTestId('new-list-name').fill(`memory-${Date.now().toString(36)}`);
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('new-list-created')).toBeVisible({ timeout });

	// Long enough for the registry and the new list's controller to have written
	// if anything still writes them.
	await page.waitForTimeout(3000);

	const left = await takeStorageInventory(page);
	expect(
		{ databases: left.indexedDB, local: left.localStorage, session: left.sessionStorage },
		`caches (the app shell, which may stay): ${JSON.stringify(left.caches)}`
	).toEqual({ databases: [], local: [], session: [] });
});
