import { test, expect } from '@playwright/test';
import {
	acceptNotice,
	consentModal,
	expectProceedRevealsTick,
	isConsentOpen,
	privacyClauses,
	rememberDecision,
	waitForConsent
} from '@simple-todo/e2e-kit/consent.mjs';

// Chapter (collab01): the shared consent dialog, in this chapter's English.
// Four acknowledgement checkboxes used to gate the way out; one tick does now,
// the element's, against a statement assembled from what was chosen.

const timeout = 30000;

test.describe('Consent screen', () => {
	test('will not let you out until the statement is accepted', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		// The title is the element's own heading, in its shadow tree.
		expect(
			await page.evaluate(
				() =>
					document.querySelector('[data-testid="consent-modal"]')?.shadowRoot?.querySelector('h2')
						?.textContent
			)
		).toContain('Simple-Todo');

		const proceed = page.getByTestId('consent-proceed');
		await expect(proceed).toHaveAttribute('aria-disabled', 'true');
		await expect(proceed).toHaveText('Confirm the notice first');

		await acceptNotice(page);
		await expect(proceed).toHaveAttribute('aria-disabled', 'false');
		await expect(proceed).toHaveText('Open shared list');

		await proceed.click();
		expect(await isConsentOpen(page)).toBe(false);
		await expect(page.locator('main h1').filter({ hasText: 'Simple-Todo' })).toBeVisible();
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
	});

	test('a press on the waiting button opens the statement and puts the cursor on the tick', async ({
		page
	}) => {
		await page.goto('/');
		await waitForConsent(page);
		await expectProceedRevealsTick(page);
		expect(await isConsentOpen(page)).toBe(true);
	});

	test('names the requirement that is actually holding the button', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);
		const proceed = page.getByTestId('consent-proceed');

		// The mnemonic is generated and valid on arrival, so the tick is what holds it.
		await expect(proceed).toHaveText('Confirm the notice first');
		await consentModal(page).getByTestId('shared-list-mnemonic-input').fill('not three words');
		await expect(proceed).toHaveText('Enter three Spanish words to continue');
		await consentModal(page).getByTestId('shared-list-mnemonic-input').fill('bosque-coral-brisa');
		await acceptNotice(page);
		await expect(proceed).toHaveText('Open shared list');
	});

	test('should remember consent decision when the tick is set', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		// Remembering is itself something kept, so it needs the choice that keeps
		// things: in memory mode nothing survives the reload by design (#9).
		await page.getByTestId('storage-mode-indexeddb').check();
		await rememberDecision(page);
		await acceptNotice(page);
		await page.getByTestId('consent-proceed').click();
		await page.waitForFunction(
			() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
		);
		const savedMnemonic = await page.evaluate(() =>
			localStorage.getItem('simpleTodo.sharedListMnemonic.v1')
		);
		expect(savedMnemonic).toMatch(/^.+-.+-.+$/);
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

		await page.reload();
		// The dialog does not come back; the list it remembered opens.
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
		expect(await isConsentOpen(page)).toBe(false);
		const sharedListDetails = page.getByTestId('shared-list-details');
		await expect(sharedListDetails).toBeVisible({ timeout });
		await sharedListDetails.getByText('Shared list', { exact: true }).click();
		await expect(sharedListDetails.getByTestId('active-shared-list-name')).toHaveText(
			savedMnemonic ?? ''
		);

		await page.evaluate(() => localStorage.clear());
	});

	test('says what this chapter does to your data, and follows the storage choice', async ({
		page
	}) => {
		await page.goto('/');
		await waitForConsent(page);
		const clauses = privacyClauses(page);

		for (const claim of [
			'no server',
			'public IPFS gateway',
			'relay and bootstrap nodes',
			'not encrypted',
			'another browser or device',
			'in memory only',
			'No tracking cookies'
		]) {
			await expect(clauses.filter({ hasText: claim })).toHaveCount(1);
		}
		await expect(clauses).toHaveCount(7);
		await expect(clauses.last()).toContainText('No tracking cookies');

		// The storage line follows the choice, and only that line changes.
		await page.getByTestId('storage-mode-indexeddb').check();
		await expect(clauses.filter({ hasText: 'keep them in this browser' })).toHaveCount(1);
		await expect(clauses.filter({ hasText: 'in memory only' })).toHaveCount(0);
		await expect(page.locator('[data-testid=consent-modal] .privacy li.changed')).toHaveCount(1);
	});

	test('offers the technical view beside the plain one', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);
		const isTechnical = () =>
			page.$eval(
				'[data-testid="consent-modal"]',
				(el) => /** @type {any} */ (el).technical === true
			);
		expect(await isTechnical()).toBe(false);
		await expect(page.getByTestId('consent-version')).toHaveCount(0);
		await page.getByTestId('consent-technical').click();
		await expect.poll(isTechnical).toBe(true);
		await expect(page.getByTestId('consent-version')).toBeVisible();
	});

	test('the close control that does nothing is not on screen', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);
		const hidden = await page.$eval('[data-testid="consent-modal"]', (el) => {
			const control = /** @type {any} */ (el).shadowRoot?.querySelector('button[disabled]');
			return !control || control.hidden === true;
		});
		expect(hidden).toBe(true);
	});
});
