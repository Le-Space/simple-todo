/**
 * A budget, from the form to the payout, in the app rather than in a unit test.
 *
 * The budget field had been covered only as a component. What nobody had tried
 * in a browser was the path a person actually takes: make a private list,
 * create a todo with a delegate and an amount in one go, watch it lock, release
 * it. That path is also where the field is easy to miss — it exists only while
 * the todo is being created, because the lock rides in the same operation, and
 * the delegate form on an existing row has no amount to offer. The row's note
 * says so now, and this test holds that sentence in place.
 *
 * Runs against the fake budget service, which is what a build without
 * `VITE_BUDGET_SERVICE=zama` uses: nothing is encrypted and nothing is sent, so
 * the states, the texts and the arithmetic are what is under test here, not
 * Sepolia.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';
import { openSection } from './sections.mjs';

const timeout = 90_000;
const BOB = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';

/** @param {import('@playwright/test').Page} page */
const todoInput = (page) => page.getByPlaceholder('What needs to be done?');

/**
 * A private list, which is where delegation and therefore budgets live.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openPrivateList(page) {
	await openSection(page, 'listen');
	await page.getByTestId('new-list-name').fill(`budget-${Date.now().toString(36)}`);
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('new-list-created')).toBeVisible({ timeout });
	await openSection(page, 'aufgaben');
	await expect(todoInput(page)).toBeEnabled({ timeout });
}

test('a todo is created with a budget, and the budget is released', async ({ page }) => {
	test.setTimeout(300_000);
	await addVirtualAuthenticator(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { identity: 'create', label: 'Payer' });
	await expect(todoInput(page)).toBeEnabled({ timeout });
	await openPrivateList(page);

	const text = `budget-todo-${Date.now().toString(36)}`;
	await todoInput(page).fill(text);

	// The field is not there until the todo is being delegated: a budget is paid
	// to a delegate, so it cannot exist without one.
	await expect(page.getByTestId('add-todo-budget')).toHaveCount(0);
	await page.getByTestId('add-todo-delegate-toggle').check();
	await page.getByTestId('add-todo-delegate-did').fill(BOB);
	await expect(page.getByTestId('add-todo-budget')).toBeVisible();
	await page.getByTestId('add-todo-budget').fill('500,00');

	await page.getByTestId('add-todo-submit').click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });

	// The amount is typed with a comma and shown with whatever separator the
	// locale uses -- English here, so `500.00`. The regexp is the honest way to
	// say "the number came through", without the test deciding the locale.
	const chip = page.getByTestId('todo-budget');
	await expect(chip).toBeVisible({ timeout });
	await expect(chip).toHaveAttribute('data-status', 'funded', { timeout });
	await expect(chip).toContainText(/500[.,]00/);
	await expect(chip).toContainText('cUSDT');

	// Releasing is not a button that simply sits there: the escrow pays for work
	// done, so the todo has to be ticked first. In the demo Bob ticks it and
	// Alice releases; here the creator does both, which is allowed and is the
	// shortest way to reach the state that matters.
	await expect(page.getByTestId('todo-release-budget')).toHaveCount(0);
	await page.getByTestId('todo-complete-checkbox').check();

	// The creator is one of the parties, so the amount stays readable to them
	// after the payout; what a third party sees is the fake's own spec.
	await page.getByTestId('todo-release-budget').click();
	await expect(chip).toHaveAttribute('data-status', 'released', { timeout });
	await expect(chip).toContainText(/500[.,]00/);
	await expect(page.getByTestId('todo-budget-note')).toBeVisible({ timeout });
});

test('the delegate form on a row says where budgets are set', async ({ page }) => {
	test.setTimeout(300_000);
	await addVirtualAuthenticator(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { identity: 'create', label: 'Payer' });
	await expect(todoInput(page)).toBeEnabled({ timeout });
	await openPrivateList(page);

	const text = `plain-todo-${Date.now().toString(36)}`;
	await todoInput(page).fill(text);
	// No delegation, so the form is collapsed and has no button: Enter is the
	// only way in, and the way a person takes.
	await todoInput(page).press('Enter');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });

	// Delegating afterwards is a different act with a different form, and the
	// note is what stops somebody hunting for an amount field that is not there.
	await page.getByTestId('todo-delegate-open').first().click();
	await expect(page.getByTestId('todo-delegate-form')).toBeVisible();
	await expect(page.getByTestId('todo-delegate-budget-note')).toBeVisible();
	await expect(page.getByTestId('add-todo-budget')).toHaveCount(0);
});
