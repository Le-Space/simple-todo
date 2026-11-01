/**
 * Two passkeys, one set of sealed lists (list-vault.js).
 *
 * The backup key in the drawer is only worth something on the day the first
 * one is gone, so that is the day this test plays: passkey A makes a list of
 * its own and a sealed one, gives passkey B a slot, and is then taken off the
 * authenticator. B, started past the stored passkey, opens the sealed list,
 * finds A's registry through the vault, and reads the list from before
 * anything was sealed.
 *
 * Every touch is counted, because the chapter states them in its copy
 * (docs/vault.md): sealing costs none after registration, adding B costs two
 * on B, and B's start costs one more than a plain restore.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { recordCeremonies, takeCeremonies } from '@simple-todo/e2e-kit/webauthn.mjs';
import { openSection } from './sections.mjs';

const todoInput = (/** @type {import('@playwright/test').Page} */ page) =>
	page.getByPlaceholder('What needs to be done?');

/**
 * The kit's authenticator, keeping its id: the test takes a credential off it.
 *
 * @param {import('@playwright/test').Page} page
 */
async function addAuthenticator(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			hasPrf: true,
			automaticPresenceSimulation: true
		}
	});
	return { cdp, authenticatorId };
}

/** @param {import('@playwright/test').Page} page */
const ceremonies = async (page) =>
	(await takeCeremonies(page)).map((c) => `${c.kind}${c.prf ? '+prf' : ''}`);

/** @param {import('@playwright/test').Page} page @param {string} text */
async function writeTodo(page, text) {
	await openSection(page, 'aufgaben');
	await todoInput(page).fill(text);
	await todoInput(page).press('Enter');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 60000 });
}

/** @param {import('@playwright/test').Page} page @param {string} name @param {boolean} seal */
async function createList(page, name, seal) {
	await openSection(page, 'listen');
	await page.getByTestId('new-list-name').fill(name);
	await page.getByTestId('new-list-seal').setChecked(seal);
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('new-list-created-name')).toHaveText(name, { timeout: 60000 });
	await expect(page.getByTestId('new-list-created-sealed')).toHaveCount(seal ? 1 : 0);
}

/** @param {string} base64url */
const toBase64 = (base64url) => {
	const plain = base64url.replace(/-/g, '+').replace(/_/g, '/');
	return plain + '='.repeat((4 - (plain.length % 4)) % 4);
};

test('a second passkey opens the sealed list when the first one is gone', async ({ page }) => {
	test.setTimeout(300000);
	const { cdp, authenticatorId } = await addAuthenticator(page);
	await recordCeremonies(page);
	const run = Date.now().toString(36);
	const before = `vorher-${run}`;
	const sealedList = `rechnungen-${run}`;
	const openTodo = `open-${run}`;
	const sealedTodo = `sealed-${run}`;

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Key A' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });
	const didA = await page.getByTestId('own-did-value').getAttribute('data-did');
	// As before the vault: the PRF output is read once and handed to the provider.
	expect(await ceremonies(page)).toEqual(['create+prf', 'get+prf', 'get']);

	// A list of A's own, from before anything was sealed.
	await createList(page, before, false);
	await writeTodo(page, openTodo);

	// The sealed one, and the vault with it: no touch, the start's PRF output is held.
	await createList(page, sealedList, true);
	await writeTodo(page, sealedTodo);
	expect(await ceremonies(page)).toEqual([]);
	const log = await page.evaluate(() =>
		/** @type {any} */ (window).__simpleTodoE2E.getActiveLogSealing()
	);
	expect(log.length).toBeGreaterThan(0);
	expect(log.every((/** @type {{ sealed: boolean }} */ e) => e.sealed)).toBe(true);

	// B: made now, asked once.
	await openSection(page, 'listen');
	await page.getByTestId('list-passkey-label').fill('Key B');
	await page.getByTestId('list-passkey-add').click();
	await expect(page.getByTestId('list-passkey-added')).toBeVisible({ timeout: 60000 });
	const didB = (await page.getByTestId('list-passkey-added-did').textContent())?.trim();
	expect(didB).toMatch(/^did:key:/);
	expect(didB).not.toBe(didA);
	expect(await ceremonies(page)).toEqual(['create+prf', 'get+prf']);
	await expect(page.getByTestId('list-passkey')).toHaveCount(2);

	// A is lost.
	const storedA = await page.evaluate(
		() => JSON.parse(localStorage.getItem('simpleTodo.webauthnCredential') ?? '{}').credentialId
	);
	await cdp.send('WebAuthn.removeCredential', { authenticatorId, credentialId: toBase64(storedA) });

	// B, past the stored passkey.
	await page.reload();
	await waitForConsent(page);
	await page.getByTestId('identity-mode-existing').check();
	await page.getByTestId('passkey-ask-authenticator').check();
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120000 });
	expect(await page.getByTestId('own-did-value').getAttribute('data-did')).toBe(didB);
	// Two to restore, one for the vault, one to sign the identity.
	expect(await ceremonies(page)).toEqual(['get+prf', 'get', 'get+prf', 'get']);

	// The sealed list was the open one, and B's slot opens it.
	await openSection(page, 'aufgaben');
	await expect(page.getByText(sealedTodo, { exact: true })).toBeVisible({ timeout: 60000 });

	// A's registry, through the address the vault names: both lists.
	await openSection(page, 'listen');
	const items = page.getByTestId('list-switcher-open');
	await expect(items.filter({ hasText: sealedList })).toHaveCount(1, { timeout: 60000 });
	await expect(
		items.filter({ hasText: sealedList }).getByTestId('list-switcher-sealed')
	).toHaveCount(1);
	await items.filter({ hasText: before }).click();
	await openSection(page, 'aufgaben');
	await expect(page.getByText(openTodo, { exact: true })).toBeVisible({ timeout: 60000 });
	expect(await ceremonies(page)).toEqual([]);
});

test('the vault asks the passkey once more at the start, and only once there is one', async ({
	page
}) => {
	test.setTimeout(300000);
	await addAuthenticator(page);
	await recordCeremonies(page);
	const run = Date.now().toString(36);
	const sealedTodo = `sealed-${run}`;

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Key A' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });
	await takeCeremonies(page);

	// No vault yet: the start asks what it asked before there were vaults.
	await page.reload();
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120000 });
	const plain = await ceremonies(page);

	// A later session: the first sealed list asks for the PRF output, once.
	await createList(page, `rechnungen-${run}`, true);
	expect(await ceremonies(page)).toEqual(['get+prf']);
	await writeTodo(page, sealedTodo);

	// With a vault kept here: one more, before the rest, and the list opens.
	await page.reload();
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120000 });
	expect(await ceremonies(page)).toEqual(['get+prf', ...plain]);
	await openSection(page, 'aufgaben');
	await expect(page.getByText(sealedTodo, { exact: true })).toBeVisible({ timeout: 60000 });
});
