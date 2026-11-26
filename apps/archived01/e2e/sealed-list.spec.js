import { test, expect } from '@playwright/test';
import {
	chooseIdentity,
	consentModal,
	openAdvanced,
	privacyClauses,
	waitForConsent
} from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (archived01): the list sealed with a key from the passkey.
//
// Alice creates a passkey with "Seal the list" ticked and writes a todo. Her
// own log says what left the browser: every entry's payload is sealed bytes
// (OrbitDB keeps the sealed form beside the opened one). The archive takes
// the list away and brings it back — the increments carry sealed entries, and
// the same passkey derives the same key. Then she unticks the box: the next
// todo goes out in the clear, the old one stays sealed, and both read.
//
// What this does not prove, on purpose: that a browser *without* the passkey
// cannot read the list. In this chapter nobody but the passkey can reach the
// list at all — the three words name a list per DID, and a link by address is
// refused (page-qr.spec.js) — so the proof lives where a stranger can open a
// list: privacy01 (encrypted-list.spec.js), and in list-sealing.spec.js, which
// refuses a sealed payload under another key. Reopening in the same session
// proves nothing either: `orbitdb.open` returns the open database and ignores
// the options.

const readyTimeout = 90000;
const mnemonic = 'bosque-coral-brisa';

/** @param {import('@playwright/test').Page} page @returns {Promise<{ sealed: boolean }[]>} */
const logOf = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__simpleTodoLog());

test.describe('A sealed list', () => {
	test('seals what the passkey writes, restores it from the archive, and writes in the clear when unticked', async ({
		browser
	}) => {
		test.setTimeout(readyTimeout * 5);
		const context = await browser.newContext();
		const page = await context.newPage();
		const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const secret = `secret-${run}`;
		const open = `open-${run}`;
		try {
			const cdp = await addVirtualAuthenticator(page);
			await page.goto('/');
			await fillConsent(page);
			// The way in is a link under the button; the passkey's name is a setting.
			await chooseIdentity(page, 'create');
			await openAdvanced(page);
			await page.getByTestId('passkey-label').fill('Alice');
			// On by default once a passkey is chosen, and the statement says so.
			await expect(page.getByTestId('seal-list')).toBeChecked();
			await expect(
				privacyClauses(page).filter({
					hasText: 'The entries are sealed with a key from your passkey'
				})
			).toHaveCount(1);
			await proceed(page);
			await addTodo(page, secret);
			// Sealed on the way out: every entry of the log.
			const sealedLog = await logOf(page);
			expect(sealedLog.length).toBeGreaterThan(0);
			expect(sealedLog.every((e) => e.sealed)).toBe(true);

			// The archive (browser-local store) takes it and gives it back.
			const panel = page.getByTestId('archive-panel');
			await expect(panel.getByTestId('archive-state')).toHaveAttribute('data-state', 'off', {
				timeout: readyTimeout
			});
			await panel.getByTestId('archive-backend').selectOption('local');
			await panel.getByTestId('archive-enable').click();
			await expect(panel.getByTestId('archive-sequence')).toHaveText('1', {
				timeout: readyTimeout
			});
			await cdp.send('Storage.clearDataForOrigin', {
				origin: new URL(page.url()).origin,
				storageTypes: 'indexeddb'
			});
			await page.reload();
			await fillConsent(page);
			await consentModal(page).getByTestId('p2p-mode-off').check();
			await expect(page.getByTestId('consent-proceed')).toHaveText(
				'Sign in with your passkey and start'
			);
			await expect(page.getByTestId('seal-list')).toBeChecked();
			await proceed(page);
			await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
			await expect(panel.getByTestId('archive-state')).toHaveAttribute('data-state', 'running', {
				timeout: readyTimeout
			});
			await panel.getByTestId('archive-restore').click();
			await expect(panel.getByTestId('archive-restored')).toBeVisible({ timeout: readyTimeout });
			await expect(page.getByText(secret, { exact: true })).toBeVisible({ timeout: readyTimeout });
			expect((await logOf(page)).every((e) => e.sealed)).toBe(true);

			// Unticked: the next entry goes out in the clear, the old one stays
			// sealed, and both read — sealing is not part of the address.
			await page.reload();
			await fillConsent(page);
			await consentModal(page).getByTestId('p2p-mode-off').check();
			await page.getByTestId('seal-list').uncheck();
			await expect(
				privacyClauses(page).filter({ hasText: 'New entries are not encrypted' })
			).toHaveCount(1);
			await proceed(page);
			await expect(page.getByText(secret, { exact: true })).toBeVisible({ timeout: readyTimeout });
			await addTodo(page, open);
			const mixed = await logOf(page);
			expect(mixed.filter((e) => e.sealed).length).toBeGreaterThan(0);
			expect(mixed.filter((e) => !e.sealed).length).toBe(1);
		} finally {
			await context.close();
		}
	});
});

/** @param {import('@playwright/test').Page} page */
async function fillConsent(page) {
	await waitForConsent(page);
	// The settings are the dialog's second screen; there is no tick to set.
	await openAdvanced(page);
	await consentModal(page).getByTestId('shared-list-mnemonic-input').fill(mnemonic);
	const keep = consentModal(page).getByTestId('storage-mode-indexeddb');
	if (!(await keep.isChecked())) await keep.check();
}

/** @param {import('@playwright/test').Page} page */
async function proceed(page) {
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
	);
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({
		timeout: readyTimeout
	});
}

/** @param {import('@playwright/test').Page} page @param {string} text */
async function addTodo(page, text) {
	await page.getByPlaceholder('What needs to be done?').fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: readyTimeout });
}
