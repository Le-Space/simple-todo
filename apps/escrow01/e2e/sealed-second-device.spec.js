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
 * The first device is wiped only once the relay holds every record the second
 * one needs: the registry, the list and its key store. Before that, the second
 * device asks for data that existed only on the wiped one -- measured on main
 * e400756 (27.11.2026): the wipe came 2.6 s after the first todo, the relay
 * connected at 4.8 s and held the list at 37 s. The relay's proof is no
 * substitute; it says "unavailable" at once and is not asked again.
 *
 * Timings are logged. Since #173 the home list of a fresh device opens once
 * the registry names it; before, it stayed "to come" until the first todo.
 * Either way this spec writes a todo and asks that it lands in the old list,
 * under its old name, beside its old todo.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator, forgetThisDevice } from '@simple-todo/e2e-kit/webauthn.mjs';
import { openSection } from './sections.mjs';
import { waitUntilRelayHolds } from './relay-holds.mjs';

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

test('a device that never saw this passkey finds its sealed home list, by name, with its todos', async ({
	page,
	request
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

	step('the relay is to hold the registry, the list and its key store before the wipe');
	/** @type {Array<{ role: string, address: string | null, records: Array<{ key: string, hash: string }> }>} */
	let databases = [];
	// The list's name goes into the key store after its key; wait for both.
	await expect
		.poll(
			async () => {
				databases = await page.evaluate(() =>
					/** @type {any} */ (window).__simpleTodoE2E.getRecordsToRestore()
				);
				return databases.every(
					({ role, address, records }) =>
						address &&
						records.length > 0 &&
						(role !== 'keys' || records.some(({ key }) => key === 'meta/name'))
				);
			},
			{ timeout }
		)
		.toBe(true);
	step(databases.map(({ role, records }) => `${role} ${records.length}`).join(', '));
	await waitUntilRelayHolds(request, databases, { timeout: 180_000, log: step });

	step('the device forgets everything; the passkey stays on the authenticator');
	await forgetThisDevice(page);
	await page.goto('/');
	await waitForConsent(page);
	const started = Date.now();
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120_000 });
	step(`started again after ${Date.now() - started} ms`);

	// Since #173 the home list opens once the registry names it; until then
	// the first todo goes into the list the registry names, or into a new one
	// when the registry has not arrived. Logged, not asserted.
	const openedAlone = await page
		.getByTestId('active-database-address')
		.waitFor({ timeout: 60_000 })
		.then(
			() => true,
			() => false
		);
	step(
		openedAlone
			? `home list open by itself after ${Date.now() - started} ms`
			: 'home list still to come after 60 s; the first todo finds it'
	);

	step('the first todo here goes into the same list, which shows its name and old todo');
	const later = `later-${Date.now().toString(36)}`;
	await todoInput(page).fill(later);
	await page.getByTestId('add-todo-submit').click();
	await expect(page.getByText(later, { exact: true })).toBeVisible({ timeout });
	await expect(page.getByTestId('active-database-address')).toHaveText(home, { timeout });
	step(`home list found after ${Date.now() - started} ms`);
	await expect(page.getByTestId('active-list-name')).toHaveText(name, { timeout });
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
	step(`old todo readable after ${Date.now() - started} ms`);

	step('the registry names it too: its sealed name opened on this device');
	await openSection(page, 'listen');
	await expect(
		page.locator(`[data-testid="list-switcher-open"][data-address="${home}"]`)
	).toContainText(name, { timeout });
});
