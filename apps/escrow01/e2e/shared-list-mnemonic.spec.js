import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { openSection } from './sections.mjs';
import { pinTechnicalView } from './technical-view.mjs';

const testUrl = '/';
const timeout = 90000;

test.describe('Spanish mnemonic shared todo lists', () => {
	test('two browsers join the copied mnemonic while a different mnemonic stays isolated', async ({
		browser
	}) => {
		test.setTimeout(timeout * 3);
		const aliceContext = await browser.newContext({
			permissions: ['clipboard-read', 'clipboard-write']
		});
		const bobContext = await browser.newContext();
		const isolatedContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();
		const isolated = await isolatedContext.newPage();
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const aliceTodo = `mnemonic-${runId}-from-alice`;
		const bobTodo = `mnemonic-${runId}-from-bob`;

		try {
			// Alice follows foundations.md, "Shared lists by three words", step 3.
			// A start without words ends in a private list of her own, made by her
			// first todo (#140); her browser's three words stay open only
			// underneath, and a todo never reaches them. So the lists tab offers
			// them to copy only once she has put their list on screen.
			await openList(alice);
			await openSection(alice, 'listen');
			const aliceCard = alice.getByTestId('shared-list-details');
			await expect(aliceCard).toHaveAttribute('data-kind', 'pending', { timeout });
			await expect(aliceCard.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
			const aliceWords = (
				(await alice.getByTestId('three-word-list-name').textContent()) ?? ''
			).trim();
			await alice.getByTestId('three-word-list-open').click();
			await expect(aliceCard).toHaveAttribute('data-kind', 'shared', { timeout });
			const aliceMnemonic = (
				await alice.getByTestId('active-shared-list-name').textContent()
			)?.trim();
			expect(aliceMnemonic).toBe(aliceWords);
			await aliceCard.getByRole('button', { name: 'Copy', exact: true }).click();
			const copiedMnemonic = await alice.evaluate(() => navigator.clipboard.readText());
			expect(copiedMnemonic).toBe(aliceMnemonic);

			// Bob joins with her words; another browser joins words of its own.
			const isolatedMnemonic =
				copiedMnemonic === 'agua-aire-alba' ? 'sol-camino-verde' : 'agua-aire-alba';
			await Promise.all([openList(bob, copiedMnemonic), openList(isolated, isolatedMnemonic)]);

			const [aliceDetails, bobDetails, isolatedDetails] = [alice, bob, isolated].map((page) =>
				page.getByTestId('shared-list-details')
			);
			// escrow01: the open list's details are the lists tab's first part,
			// "This list" (#127 PR C); the network details stay folded, in the
			// network tab.
			for (const page of [alice, bob, isolated]) await openSection(page, 'listen');
			for (const details of [aliceDetails, bobDetails, isolatedDetails]) {
				await expect(details).toBeVisible();
				await expect(
					details.locator('xpath=ancestor::section[@data-testid="section-listen"]')
				).toHaveCount(1);
			}
			await expect(alice.getByTestId('network-details')).not.toHaveAttribute('open', '');
			await expect(aliceDetails.getByTestId('active-shared-list-name')).toHaveText(copiedMnemonic);
			await expect(bobDetails.getByTestId('active-shared-list-name')).toHaveText(copiedMnemonic);

			const [aliceDatabase, bobDatabase, isolatedDatabase] = await Promise.all([
				getDatabaseDiagnostics(alice),
				getDatabaseDiagnostics(bob),
				getDatabaseDiagnostics(isolated)
			]);
			expect(aliceDatabase.name).toBe(copiedMnemonic);
			expect(bobDatabase.name).toBe(copiedMnemonic);
			expect(aliceDatabase.address).toBe(bobDatabase.address);
			expect(isolatedDatabase.name).toBe(isolatedMnemonic);
			expect(isolatedDatabase.address).not.toBe(aliceDatabase.address);

			await addTodo(alice, aliceTodo);
			await expectTodo(bob, aliceTodo);
			await addTodo(bob, bobTodo);
			await expectTodo(alice, bobTodo);
			await expect(isolated.getByText(aliceTodo, { exact: true })).toHaveCount(0);
			await expect(isolated.getByText(bobTodo, { exact: true })).toHaveCount(0);
		} finally {
			await Promise.all([isolatedContext.close(), bobContext.close(), aliceContext.close()]);
		}
	});
});

/**
 * Through the start dialog without a passkey: with words, joining the shared
 * list behind them; without, as a first visit does.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [mnemonic]
 */
async function openList(page, mnemonic) {
	// The spec checks that the network details stay closed next to the list
	// details, and the network details are the technical view's.
	await pinTechnicalView(page);
	await page.goto(testUrl);
	await waitForConsent(page);
	await passConsent(page, mnemonic === undefined ? {} : { mnemonic });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function getDatabaseDiagnostics(page) {
	await expect
		.poll(
			() =>
				page.evaluate(() => ({
					name: window.__simpleTodoE2E?.getDatabaseName?.() ?? '',
					address: window.__simpleTodoE2E?.getDatabaseAddress?.() ?? ''
				})),
			{ timeout }
		)
		.toMatchObject({ name: expect.any(String), address: expect.stringContaining('/orbitdb/') });
	return page.evaluate(() => ({
		name: window.__simpleTodoE2E.getDatabaseName(),
		address: window.__simpleTodoE2E.getDatabaseAddress()
	}));
}

/** @param {import('@playwright/test').Page} page @param {string} text */
async function addTodo(page, text) {
	await openSection(page, 'aufgaben');
	await page.getByPlaceholder('What needs to be done?').fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expectTodo(page, text);
}

/** @param {import('@playwright/test').Page} page @param {string} text */
async function expectTodo(page, text) {
	await openSection(page, 'aufgaben');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}
