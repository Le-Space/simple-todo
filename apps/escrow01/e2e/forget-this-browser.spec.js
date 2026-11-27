/**
 * "Keep in this browser" can be undone from inside the app.
 *
 * With the box ticked, this browser keeps the passkey's credential, the
 * identity proof, the lists' logs, the account record and, depending on the
 * passkey, keys -- what a return needs. "Forget me on this browser" -- in the
 * footer, and on the welcome step -- takes all of it away, and the next start
 * is the one a new device gets: the full dialog, and
 * the identity back from the authenticator in four prompts
 * (`passkeyPromptsFor('existing')`; three once provider #107 hands out the
 * restore's PRF output, #127), the same DID as before.
 *
 * The inventory before the forgetting is what makes the empty one after it
 * mean something: a session that had kept nothing would pass the second half
 * for the wrong reason.
 */
import { test, expect } from '@playwright/test';
import {
	isConsentOpen,
	isWelcomeOpen,
	passConsent,
	waitForConsent
} from '@simple-todo/e2e-kit/consent.mjs';
import { takeStorageInventory } from '@simple-todo/e2e-kit/storage-inventory.mjs';
import {
	addVirtualAuthenticator,
	recordCeremonies,
	takeCeremonies
} from '@simple-todo/e2e-kit/webauthn.mjs';

/** @param {import('@playwright/test').Page} page */
const todoInput = (page) => page.getByPlaceholder('What needs to be done?');

/** @param {import('@playwright/test').Page} page @param {string} text */
async function writeTodo(page, text) {
	await todoInput(page).fill(text);
	await todoInput(page).press('Enter');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 60000 });
}

/** @param {import('@playwright/test').Page} page */
const ownDid = (page) => page.getByTestId('own-did-value').getAttribute('data-did');

/**
 * What this browser kept for the passkey session, as the inventory names it.
 *
 * Not the signing key by name: where it lives is the chapter's to change
 * (#127 derives it into memory for a passkey with PRF). The credential, the
 * identity proof and the lists' logs are kept in either case.
 *
 * @param {Awaited<ReturnType<typeof takeStorageInventory>>} inventory
 */
function keptForTheIdentity(inventory) {
	return {
		credential: inventory.localStorage.includes('simpleTodo.webauthnCredential'),
		proof: inventory.localStorage.some((key) => key.startsWith('webauthn-identity-proof:')),
		logs: inventory.indexedDB.some(
			(database) => database.name.startsWith('level-js-orbitdb/') && database.records > 0
		)
	};
}

/**
 * Press "Forget and restart" and wait for the page that follows.
 *
 * @param {import('@playwright/test').Page} page
 */
async function confirmForgetting(page) {
	const loaded = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
	await page.getByTestId('forget-browser').getByTestId('forget-browser-confirm').click();
	await loaded;
	await waitForConsent(page);
}

/**
 * Nothing left: no database, no key in either storage. The app shell a cache
 * may hold is the app, not anything about its reader.
 *
 * @param {import('@playwright/test').Page} page
 */
async function expectNothingLeft(page) {
	const left = await takeStorageInventory(page);
	expect(
		{ databases: left.indexedDB, local: left.localStorage, session: left.sessionStorage },
		`caches (the app shell, which may stay): ${JSON.stringify(left.caches)}`
	).toEqual({ databases: [], local: [], session: [] });
}

test('forgotten from the footer: nothing is left, and the passkey is asked as on a new device', async ({
	page
}) => {
	test.setTimeout(300000);
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Forgetter' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });
	const before = await ownDid(page);
	expect(before).toMatch(/^did:key:/);
	await writeTodo(page, `kept-${Date.now().toString(36)}`);
	await takeCeremonies(page);

	expect(keptForTheIdentity(await takeStorageInventory(page))).toEqual({
		credential: true,
		proof: true,
		logs: true
	});

	const footer = page.getByTestId('app-footer');
	await footer.getByTestId('forget-browser-open').click();
	const dialog = page.getByTestId('forget-browser');
	await expect(dialog).toBeVisible();
	// What goes and what stays, before the button that cannot be undone.
	await expect(dialog.getByTestId('forget-browser-stays')).toContainText('Your passkey');
	await expect(dialog.getByTestId('forget-browser-stays')).toContainText('Your lists');
	await expect(dialog.getByTestId('forget-browser-stays')).toContainText('Sepolia');
	await expect(dialog.getByTestId('forget-browser-cancel')).toBeFocused();
	await confirmForgetting(page);

	// A new device: the full dialog, not the welcome step, and no list in the address.
	expect(await isConsentOpen(page)).toBe(true);
	expect(await isWelcomeOpen(page)).toBe(false);
	expect(new URL(page.url()).hash).toBe('');
	await expectNothingLeft(page);

	// The start asks the authenticator again, as passkey-restore.spec.js counts
	// it: two to restore -- the first with PRF -- then the PRF output once
	// more, for the key of sealed lists (#127), and one to sign the identity.
	// Same passkey, same DID.
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120000 });
	expect(await ownDid(page)).toBe(before);
	const restore = await takeCeremonies(page);
	expect(restore.map((c) => `${c.kind}${c.prf ? '+prf' : ''}`)).toEqual([
		'get+prf',
		'get',
		'get+prf',
		'get'
	]);
	expect(restore.every((c) => c.ok)).toBe(true);
});

test('forgotten from the welcome step: no passkey asked, Cancel changes nothing, the language stays', async ({
	page
}) => {
	test.setTimeout(300000);
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Leaver' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });

	await page.reload();
	await waitForConsent(page);
	expect(await isWelcomeOpen(page)).toBe(true);
	const welcome = page.getByTestId('passkey-welcome');
	// In German, to see that the language survives a forgetting that empties
	// the storage it was kept in.
	await welcome.getByTestId('language-de').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');

	const link = welcome.getByTestId('forget-browser-open');
	const dialog = page.getByTestId('forget-browser');
	await link.click();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('forget-browser-cancel')).toBeFocused();
	await dialog.getByTestId('forget-browser-cancel').click();
	await expect(dialog).toBeHidden();
	await expect(link).toBeFocused();
	expect(keptForTheIdentity(await takeStorageInventory(page))).toEqual({
		credential: true,
		proof: true,
		logs: true
	});

	await link.click();
	await expect(dialog).toContainText('Soll dieser Browser Sie vergessen?');
	// Forgetting needs no passkey: somebody at a shared computer may not have it.
	expect(await takeCeremonies(page)).toEqual([]);
	await confirmForgetting(page);

	expect(await isWelcomeOpen(page)).toBe(false);
	expect(await isConsentOpen(page)).toBe(true);
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await expectNothingLeft(page);
});

test('in memory only, there is nothing to forget and the footer offers nothing', async ({
	page
}) => {
	test.setTimeout(180000);
	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: false });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });

	await expect(page.getByTestId('app-footer')).toBeAttached();
	await expect(page.getByTestId('forget-browser-open')).toHaveCount(0);
});
