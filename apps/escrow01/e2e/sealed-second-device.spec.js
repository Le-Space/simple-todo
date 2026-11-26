/**
 * #127: the same passkey on a device that never saw it finds its sealed home
 * list, by its name, with its todos.
 *
 * The story the film and the FAQ tell: nothing of the list is on the new
 * device, and nothing secret travels with the passkey either. The device
 * restores the identity from the authenticator, reads the PRF output, and
 * derives from it the same signing key -- so the same list registry -- and the
 * same X25519 key, which opens the registry's sealed names and the list key
 * the owner wrapped for herself.
 *
 * "A device that never saw it" is this browser with its storage wiped
 * (`forgetThisDevice`), as in passkey-restore.spec.js: the virtual
 * authenticator stays, and with it the PRF secret, which a copied credential
 * would not carry.
 *
 * Timings are logged. On main the home list of a fresh device stayed "to come"
 * for about 45 s and opened only at the first todo (measured by the provider
 * 0.14.0 session, 26.11.2026); this spec says how long it takes here.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator, forgetThisDevice } from '@simple-todo/e2e-kit/webauthn.mjs';
import { openSection } from './sections.mjs';

const timeout = 90_000;

/** @param {import('@playwright/test').Page} page */
const todoInput = (page) => page.getByPlaceholder('What needs to be done?');

/** @param {string} message */
function step(message) {
	console.log(`[second-device ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

/** @param {import('@playwright/test').Page} page */
async function openedAddress(page) {
	const address = page.getByTestId('active-database-address');
	await expect(address).toHaveText(/^\/orbitdb\//, { timeout });
	return ((await address.textContent()) ?? '').trim();
}

test('a device that never saw this passkey finds the sealed home list, by name, with its todos', async ({
	page
}) => {
	test.setTimeout(480_000);
	page.on('console', (message) => {
		if (message.type() === 'error') console.log(`[page:error] ${message.text()}`);
	});
	await addVirtualAuthenticator(page);

	step('first device: a passkey, and the first todo makes the sealed home list');
	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Traveller' });
	await expect(todoInput(page)).toBeEnabled({ timeout });
	const text = `travels-${Date.now().toString(36)}`;
	await todoInput(page).fill(text);
	await page.getByTestId('add-todo-submit').click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
	const home = await openedAddress(page);
	const name = ((await page.getByTestId('active-list-name').textContent()) ?? '').trim();
	expect(name).not.toBe('');
	expect(name).not.toContain('sealed-v1-');
	// The relay has the todo, so a device with nothing finds it there rather
	// than here. The list holds todos only -- its name is in the key store -- so
	// the relay's proof compares this todo, as on a list in the clear.
	await expect(page.getByTestId('todo-relay-status')).toHaveAttribute('data-status', 'pinned', {
		timeout
	});

	step('the device forgets everything; the passkey stays on the authenticator');
	await forgetThisDevice(page);
	await page.goto('/');
	await waitForConsent(page);
	const started = Date.now();
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120_000 });
	step(`started again after ${Date.now() - started} ms`);

	step('the home list opens by itself, by name, with its todo');
	await expect(page.getByTestId('active-database-address')).toHaveText(home, {
		timeout: 180_000
	});
	step(`home list open after ${Date.now() - started} ms`);
	await expect(page.getByTestId('active-list-name')).toHaveText(name, { timeout });
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
	step(`todo readable after ${Date.now() - started} ms`);

	step('the registry names it too: its sealed name opened on this device');
	await openSection(page, 'listen');
	await expect(
		page.locator(`[data-testid="list-switcher-open"][data-address="${home}"]`)
	).toContainText(name, { timeout });
});
