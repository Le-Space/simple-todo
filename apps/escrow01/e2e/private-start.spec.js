/**
 * escrow01 starts in a list of one's own.
 *
 * Delegation and budgets exist only on a list with the delegation controller,
 * and the shared three-word list cannot have one: everybody may write there.
 * A first visit used to open exactly that list, so the form had no delegate
 * and no budget, and nothing said why. Now the start lands in a private list
 * unless a link brings another one, and a shared list says where delegation is.
 *
 * Anonymous and kept in this browser, so the decision can be remembered and a
 * new tab starts by itself -- which is where "the same list again" is asked.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';

const timeout = 90_000;

/** @param {import('@playwright/test').Page} page */
const todoInput = (page) => page.getByPlaceholder('What needs to be done?');

/** @param {import('@playwright/test').Page} page */
const listKind = (page) => page.getByTestId('active-list-heading');

/** @param {import('@playwright/test').Page} page */
async function openedAddress(page) {
	const address = page.getByTestId('active-database-address');
	await expect(address).toHaveText(/^\/orbitdb\//, { timeout });
	return ((await address.textContent()) ?? '').trim();
}

test('a first visit starts in a private list, and a new tab comes back to it', async ({
	context
}) => {
	test.setTimeout(180_000);
	const first = await context.newPage();
	await first.goto('/');
	await waitForConsent(first);
	await passConsent(first, { identity: 'anonymous', persistent: true, remember: true });
	await expect(todoInput(first)).toBeEnabled({ timeout });

	await expect(listKind(first)).toHaveAttribute('data-kind', 'private', { timeout });
	await expect(first.getByTestId('add-todo-delegate-toggle')).toBeVisible();
	await expect(first.getByTestId('add-todo-private-list-hint')).toHaveCount(0);
	const home = await openedAddress(first);
	// The address bar names it, so the link and the page QR are this list.
	await expect.poll(() => decodeURIComponent(new URL(first.url()).hash)).toContain('db=');
	await first.close();

	// No link this time: the start has to find the list it made, not make one.
	const second = await context.newPage();
	await second.goto('/');
	await expect(todoInput(second)).toBeEnabled({ timeout });
	await expect(listKind(second)).toHaveAttribute('data-kind', 'private', { timeout });
	expect(await openedAddress(second)).toBe(home);
});

test('three words from a link open the shared list, and it points to a private one', async ({
	page
}) => {
	test.setTimeout(180_000);
	await page.goto('/#list=agua-aire-alba');
	await waitForConsent(page);
	await passConsent(page);
	await expect(todoInput(page)).toBeEnabled({ timeout });

	await expect(listKind(page)).toHaveAttribute('data-kind', 'shared');
	await expect(page.getByTestId('active-list-name')).toHaveText('agua-aire-alba');
	await expect(page.getByTestId('add-todo-delegate-toggle')).toHaveCount(0);
	const hint = page.getByTestId('add-todo-private-list-hint');
	await expect(hint).toBeVisible({ timeout });

	await page.getByTestId('add-todo-private-list-create').click();
	await expect(listKind(page)).toHaveAttribute('data-kind', 'private', { timeout });
	await expect(page.getByTestId('add-todo-delegate-toggle')).toBeVisible();
	await expect(hint).toHaveCount(0);
});
