import { test, expect } from '@playwright/test';
import { acceptNotice, consentModal, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (archived01): the list's changes go out as sealed increments, and
// a wiped browser gets the list back with the same passkey.
//
// Alice registers a passkey, writes two todos, and switches the archive on
// against the browser-local store (no service, no account: the test is about
// the mechanism, and the drivers have their own suites in the storage
// bridge). The first increment goes out by itself. A third todo makes a
// second one. Then everything OrbitDB keeps in IndexedDB is wiped — the
// passkey's metadata, the archive settings and the local store's blobs live
// in localStorage and stay — the page reloads, the passkey comes back with
// one touch, the list is empty, and "Restore" brings all three todos back.

const testUrl = '/';
const readyTimeout = 90000;
const sharedMnemonic = 'bosque-coral-brisa';

test.describe('Archive increments', () => {
	test('changes ship as increments, and a wiped browser restores the list from them', async ({
		browser
	}) => {
		test.setTimeout(readyTimeout * 4);
		const context = await browser.newContext();
		const page = await context.newPage();
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const todos = [`first-${runId}`, `second-${runId}`, `third-${runId}`];

		try {
			const cdp = await addVirtualAuthenticator(page);
			await openReadyAppWithNewPasskey(page, { label: 'Alice' });

			const panel = page.getByTestId('archive-panel');
			// A first start reads the PRF output with the same touch the provider
			// would have asked for, so the archive is unlocked from the start.
			await expect(panel.getByTestId('archive-state')).toHaveAttribute('data-state', 'off', {
				timeout: readyTimeout
			});

			await addTodo(page, todos[0]);
			await addTodo(page, todos[1]);

			// The local store, switched on.
			await panel.getByTestId('archive-backend').selectOption('local');
			const address = await panel.getByTestId('archive-address').textContent();
			expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
			await panel.getByTestId('archive-enable').click();
			await expect(panel.getByTestId('archive-state')).toHaveAttribute('data-state', 'running');

			// Switching on ships what is there; a further write ships by itself.
			await expect(panel.getByTestId('archive-sequence')).toHaveText('1', {
				timeout: readyTimeout
			});
			await addTodo(page, todos[2]);
			await expect(panel.getByTestId('archive-sequence')).toHaveText('2', {
				timeout: readyTimeout
			});
			await expect(panel.getByTestId('archive-pending')).toHaveText('0');

			await panel.getByTestId('archive-list').click();
			await expect(panel.getByTestId('archive-increments').locator('li')).toHaveCount(2);

			// The wipe: OrbitDB and Helia keep everything in IndexedDB.
			await cdp.send('Storage.clearDataForOrigin', {
				origin: new URL(page.url()).origin,
				storageTypes: 'indexeddb'
			});
			await page.reload();
			await proceedWithExistingPasskey(page);
			expect(await getOwnDid(page)).toMatch(/^did:/);
			for (const todo of todos) await expect(page.getByText(todo, { exact: true })).toHaveCount(0);

			// The archive is on, so the start unlocked it with the same touch.
			await expect(panel.getByTestId('archive-state')).toHaveAttribute('data-state', 'running', {
				timeout: readyTimeout
			});
			expect(await panel.getByTestId('archive-address').textContent()).toBe(address);

			await panel.getByTestId('archive-restore').click();
			await expect(panel.getByTestId('archive-restored')).toBeVisible({ timeout: readyTimeout });
			// The restore told its share while it ran (two increments: 50 % then 100 %).
			await expect(panel.getByTestId('archive-progress')).toHaveCount(0);
			for (const todo of todos) {
				await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout: readyTimeout });
			}
			// Nothing that came back is sent out again.
			await expect(panel.getByTestId('archive-pending')).toHaveText('0');
			await panel.getByTestId('archive-flush').click();
			await expect(panel.getByTestId('archive-sequence')).toHaveText('2');
		} finally {
			await context.close();
		}
	});
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ label: string }} identity
 */
async function openReadyAppWithNewPasskey(page, { label }) {
	await page.goto(testUrl);
	await fillConsentModal(page);
	await page.getByTestId('identity-mode-create').check();
	await page.getByTestId('passkey-label').fill(label);
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
	);
	await expectAppReady(page);
}

/** @param {import('@playwright/test').Page} page */
async function proceedWithExistingPasskey(page) {
	await fillConsentModal(page);
	await expect(page.getByTestId('identity-mode-existing')).toBeChecked();
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
	);
	await expectAppReady(page);
}

/** @param {import('@playwright/test').Page} page */
async function fillConsentModal(page) {
	await waitForConsent(page);
	await consentModal(page).getByTestId('shared-list-mnemonic-input').fill(sharedMnemonic);
	// Keep things: the credential, the archive's settings and its numbering
	// have to survive the reload below, which is the case the chapter is about.
	const keep = consentModal(page).getByTestId('storage-mode-indexeddb');
	if ((await keep.count()) > 0 && !(await keep.isChecked())) await keep.check();
	await acceptNotice(page);
	return consentModal(page);
}

/** @param {import('@playwright/test').Page} page */
async function expectAppReady(page) {
	await expect(getTodoInput(page)).toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout: readyTimeout });
}

/** @param {import('@playwright/test').Page} page */
async function getOwnDid(page) {
	const badge = page.getByTestId('own-did-value');
	await expect(badge).toBeVisible({ timeout: readyTimeout });
	return badge.getAttribute('data-did');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: readyTimeout });
}

/** @param {import('@playwright/test').Page} page */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
