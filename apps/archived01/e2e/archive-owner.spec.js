import { test, expect } from '@playwright/test';
import { acceptNotice, consentModal, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';
import { fakeAleph } from './fake-aleph.mjs';

// Chapter (archived01): who pays. The archive key from the passkey signs the
// STOREs, and an owner account that never enters the browser is checked and
// billed — once the owner has granted the key STORE on this channel.
//
// Aleph is a fake here (fake-aleph.mjs), as strict as the real one about
// signatures, ownership and grants; nothing in this path can run against
// api2.aleph.im without the owner's key and credits. The spec takes the grant
// the page tells the owner to run, applies it to the fake as the owner would,
// and checks that what then happens is what the page promised: STOREs on the
// owner's account, the owner's balance on screen, no deleting without a
// FORGET grant, a restore in a wiped browser from the owner's listing.

const testUrl = '/';
const readyTimeout = 90000;
const sharedMnemonic = 'bosque-coral-brisa';
/** The owner: an account whose key exists only where the owner runs the CLI. */
const owner = '0x1111111111111111111111111111111111111111';
const channel = 'SIMPLE-TODO-ARCHIVED01';

/** The JSON the owner would write, as the page printed it. @param {string} command */
function listFrom(command) {
	const content = /--content '([^']+)'/.exec(command)?.[1];
	expect(content, `a --content in: ${command}`).toBeTruthy();
	const parsed = JSON.parse(/** @type {string} */ (content));
	return Array.isArray(parsed) ? parsed : parsed.authorizations;
}

test.describe('Archive paid by an owner account', () => {
	test('the key signs, the owner is billed, and nothing goes through without the grant', async ({
		browser
	}) => {
		test.setTimeout(readyTimeout * 5);
		// No service worker: it would answer from its cache what the fake must see.
		const context = await browser.newContext({ serviceWorkers: 'block' });
		const page = await context.newPage();
		const aleph = await fakeAleph(page, { credits: { [owner]: 5000 } });
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const todos = [`first-${runId}`, `second-${runId}`, `third-${runId}`];

		try {
			const cdp = await addVirtualAuthenticator(page);
			await openReadyAppWithNewPasskey(page, { label: 'Alice' });
			const panel = page.getByTestId('archive-panel');
			await expect(panel.getByTestId('archive-state')).toHaveAttribute('data-state', 'off', {
				timeout: readyTimeout
			});
			await addTodo(page, todos[0]);
			await addTodo(page, todos[1]);

			// Aleph is the default store; the archive key pays for itself until told otherwise.
			await expect(panel.getByTestId('archive-backend')).toHaveValue('aleph');
			await expect(panel.getByTestId('archive-payer')).toHaveAttribute('data-mode', 'self');
			const signer = String(await panel.getByTestId('archive-address').textContent());
			expect(signer).toMatch(/^0x[0-9a-fA-F]{40}$/);

			// The info box names both sides of both choices.
			await panel.getByTestId('archive-payer-info').click();
			const infobox = panel.getByTestId('archive-payer-infobox');
			await expect(infobox).toBeVisible();
			await expect(infobox.locator('li')).toHaveCount(12);

			// An owner outside the browser.
			await panel.getByTestId('archive-payer-owner').check();
			await panel.getByTestId('archive-owner').fill(owner.toLowerCase());
			await panel.getByTestId('archive-owner-save').click();
			await expect(panel.getByTestId('archive-payer')).toHaveAttribute('data-mode', 'owner');
			// Checksummed, the way Aleph keys accounts.
			await expect(panel.getByTestId('archive-owner-address')).toHaveText(owner);
			await expect(panel.getByTestId('archive-address')).toHaveText(signer);
			// Nothing granted yet, and the page says so after reading the owner's permissions.
			await expect(panel.getByTestId('archive-authorization')).toHaveAttribute(
				'data-store',
				'false'
			);
			// The owner's balance is what counts now.
			await expect(panel.getByTestId('archive-credits')).toContainText(/5[,.]?000/);

			// The command the owner is told to run: this key, STORE only, this channel.
			await panel.getByTestId('archive-owner-commands').locator('summary').click();
			const grant = String(await panel.getByTestId('archive-command-grant').textContent());
			expect(grant).toMatch(/^aleph aggregate create --key security --channel security/);
			const list = listFrom(grant);
			expect(list).toEqual([
				{ address: signer, chain: 'ETH', types: ['STORE'], channels: [channel] }
			]);
			await expect(panel.getByTestId('archive-command-verify')).toHaveText(
				`aleph aggregate get security --address ${owner}`
			);

			// Switched on before the grant: the fake refuses the STORE, and the page says so.
			await panel.getByTestId('archive-enable').click();
			await expect(panel.getByTestId('archive-failures')).not.toHaveText('0', {
				timeout: readyTimeout
			});
			await expect(panel.getByTestId('archive-sequence')).toHaveText('0');
			expect(
				aleph
					.log()
					.filter((e) => e.type === 'STORE')
					.map((e) => e.reason)
			).toEqual(['permission']);

			// The owner runs the command.
			aleph.grant(owner, list);
			await panel.getByTestId('archive-authorization-check').click();
			await expect(panel.getByTestId('archive-authorization')).toHaveAttribute(
				'data-store',
				'true'
			);
			await expect(panel.getByTestId('archive-authorization')).toHaveAttribute(
				'data-forget',
				'false'
			);

			// Now the increment goes through — as the owner's STORE, signed by the key.
			await panel.getByTestId('archive-flush').click();
			await expect(panel.getByTestId('archive-sequence')).toHaveText('1', {
				timeout: readyTimeout
			});
			await expect(panel.getByTestId('archive-pending')).toHaveText('0');
			expect(aleph.stores()).toHaveLength(1);
			expect(aleph.stores()[0].sender).toBe(signer);
			expect(aleph.stores()[0].content.address).toBe(owner);
			expect(aleph.stores()[0].content.payment).toEqual({ type: 'credit' });
			// This list's chain, named by a fingerprint from the passkey (keys.js):
			// opaque to the store, the same on every device with the passkey.
			const chain = aleph.stores()[0].content.ref;
			expect(chain).toMatch(/^[0-9a-f]{32}$/);

			await addTodo(page, todos[2]);
			await expect(panel.getByTestId('archive-sequence')).toHaveText('2', {
				timeout: readyTimeout
			});
			expect(aleph.stores()).toHaveLength(2);

			// Deleting needs FORGET, which the owner did not grant: the page refuses
			// before anything is sent, and hands the owner the command instead.
			await panel.getByTestId('archive-list').click();
			await expect(panel.getByTestId('archive-increments').locator('li')).toHaveCount(2);
			expect(aleph.stores().every((s) => s.content.ref === chain)).toBe(true);
			// The listing asked for this chain, not the whole account.
			expect(
				aleph
					.queries()
					.some((q) => q.startsWith('/api/v0/messages.json') && q.includes(`refs=${chain}`))
			).toBe(true);
			await panel.getByTestId('archive-delete').click();
			await panel.getByTestId('archive-delete-yes').click();
			await expect(panel.getByTestId('archive-forget-not-granted')).toBeVisible();
			const remove = String(await panel.getByTestId('archive-command-remove').textContent());
			expect(remove).toMatch(/^aleph file delete /);
			// The kept files, not the upload the fake refused to keep before the grant.
			expect(aleph.blobs()).toHaveLength(3);
			for (const { content } of aleph.stores()) expect(remove).toContain(content.item_hash);
			expect(remove).toContain(`--channel ${channel}`);
			expect(aleph.log().filter((e) => e.type === 'FORGET')).toHaveLength(0);
			expect(aleph.stores()).toHaveLength(2);

			// A wiped browser, the same passkey: the owner's listing finds the
			// increments, the key opens them.
			await cdp.send('Storage.clearDataForOrigin', {
				origin: new URL(page.url()).origin,
				storageTypes: 'indexeddb'
			});
			await page.reload();
			// The network off: with the relay reachable the list could come back by
			// replication, and nobody would know whether the archive did anything.
			await proceedWithExistingPasskey(page, { p2p: false });
			for (const todo of todos) await expect(page.getByText(todo, { exact: true })).toHaveCount(0);
			await expect(panel.getByTestId('archive-state')).toHaveAttribute('data-state', 'running', {
				timeout: readyTimeout
			});
			await expect(panel.getByTestId('archive-payer')).toHaveAttribute('data-mode', 'owner');
			await expect(panel.getByTestId('archive-owner-address')).toHaveText(owner);
			await panel.getByTestId('archive-restore').click();
			await expect(panel.getByTestId('archive-restored')).toBeVisible({ timeout: readyTimeout });
			for (const todo of todos) {
				await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout: readyTimeout });
			}
			// The numbering went on from the store, nothing shipped twice.
			await expect(panel.getByTestId('archive-sequence')).toHaveText('2');
			expect(aleph.stores()).toHaveLength(2);

			// With FORGET granted too, deleting works from here.
			await panel.getByTestId('archive-owner-forget').check();
			await panel.getByTestId('archive-owner-commands').locator('summary').click();
			const withForget = String(await panel.getByTestId('archive-command-grant').textContent());
			expect(withForget).toMatch(
				/^aleph aggregate edit --key security --channel security --subkey authorizations/
			);
			const second = listFrom(withForget);
			expect(second).toEqual([
				{ address: signer, chain: 'ETH', types: ['STORE', 'FORGET'], channels: [channel] }
			]);
			aleph.grant(owner, second);
			await panel.getByTestId('archive-authorization-check').click();
			await expect(panel.getByTestId('archive-authorization')).toHaveAttribute(
				'data-forget',
				'true'
			);
			await panel.getByTestId('archive-delete').click();
			await panel.getByTestId('archive-delete-yes').click();
			await expect(panel.getByTestId('archive-deleted')).toBeVisible({ timeout: readyTimeout });
			await expect(panel.getByTestId('archive-deleted')).toContainText('2');
			expect(aleph.stores()).toHaveLength(0);
			const forgets = aleph.log().filter((e) => e.type === 'FORGET');
			expect(forgets).toHaveLength(1);
			expect(forgets[0]).toMatchObject({ status: 'processed', sender: signer, address: owner });
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

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ p2p?: boolean }} [choices]
 */
async function proceedWithExistingPasskey(page, { p2p } = {}) {
	await fillConsentModal(page);
	if (p2p === false) await consentModal(page).getByTestId('p2p-mode-off').check();
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
	// Keep things: the credential and the owner setting have to survive the reload.
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
