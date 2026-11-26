/**
 * escrow01 starts towards a list of one's own.
 *
 * Delegation and budgets exist only on a list with the delegation controller,
 * and the shared three-word list cannot have one: everybody may write there.
 * A first visit used to open exactly that list, so the form had no delegate
 * and no budget, and nothing said why. Now the start shows the private list the
 * first todo will make, unless a link brings another one, and a shared list
 * says where delegation is.
 *
 * The list is made with the first todo, not at start: a database for every
 * visitor who only looks cost the relay one manifest each, and measured, that
 * load kept it from holding the lists people did write to.
 *
 * Anonymous and kept in this browser, so the decision can be remembered and a
 * new tab starts by itself -- which is where "the same list again" is asked.
 */
import { test, expect } from '@playwright/test';
import { isConsentOpen, passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { expectPageQr, readListLink } from '@simple-todo/e2e-kit/page-qr.mjs';
import { openSection } from './sections.mjs';

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

test('a first visit shows a private list to come, the first todo makes it, a new tab finds it', async ({
	context
}) => {
	test.setTimeout(180_000);
	const first = await context.newPage();
	await first.goto('/');
	await waitForConsent(first);
	await passConsent(first, { identity: 'anonymous', persistent: true, remember: true });
	await expect(todoInput(first)).toBeEnabled({ timeout });

	// Before the first todo: the list to come, with delegation and a budget on
	// offer, and no database made yet.
	await expect(listKind(first)).toHaveAttribute('data-kind', 'private', { timeout });
	await expect(listKind(first)).toHaveAttribute('data-pending', 'true');
	await expect(first.getByTestId('add-todo-delegate-toggle')).toBeVisible();
	await expect(first.getByTestId('add-todo-private-list-hint')).toHaveCount(0);

	// The first todo makes it and goes into it.
	const text = `first-${Date.now().toString(36)}`;
	await todoInput(first).fill(text);
	await first.getByTestId('add-todo-submit').click();
	await expect(first.getByText(text, { exact: true })).toBeVisible({ timeout });
	await expect(listKind(first)).not.toHaveAttribute('data-pending', 'true');
	await expect(listKind(first)).toHaveAttribute('data-kind', 'private');
	const home = await openedAddress(first);
	// The address bar names it, so the link and the page QR are this list.
	await expect.poll(() => decodeURIComponent(new URL(first.url()).hash)).toContain('db=');
	// And so does the lists tab: what it copies is this list's address. The
	// browser's three words are named beside it, not offered as this list's.
	await openSection(first, 'listen');
	await expect(first.getByTestId('shared-list-details')).toHaveAttribute('data-kind', 'private');
	await expect(first.getByTestId('active-shared-list-name')).toHaveCount(0);
	await expect(first.getByTestId('three-word-list-name')).toHaveText(/^\S+-\S+-\S+$/);
	await first.close();

	// No link this time: the start has to find the list it made, not make one.
	const second = await context.newPage();
	await second.goto('/');
	await expect(todoInput(second)).toBeEnabled({ timeout });
	await expect(listKind(second)).toHaveAttribute('data-kind', 'private', { timeout });
	expect(await openedAddress(second)).toBe(home);
	await expect(second.getByText(text, { exact: true })).toBeVisible({ timeout });
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

test('the shared list underneath is offered only once it is on screen', async ({ page }) => {
	// The start opens the browser's three-word list and keeps it open under the
	// list still to be made. The lists tab, the address bar and the page QR used
	// to name it as the open one, so its words, handed on, sent the other person
	// into a list the first todo never reached.
	test.setTimeout(180_000);
	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page);
	await expect(todoInput(page)).toBeEnabled({ timeout });
	await expect(listKind(page)).toHaveAttribute('data-pending', 'true', { timeout });

	// The list to come has nothing to pass on yet: no list in the address, so
	// none in the page QR either ...
	expect(readListLink(page.url())).toMatchObject({ words: null, address: null });
	expect(readListLink(await expectPageQr(page, expect))).toMatchObject({
		words: null,
		address: null
	});

	// ... and nothing to copy in the lists tab. The browser's words are named
	// beside it, with the switch to their list.
	await openSection(page, 'listen');
	const details = page.getByTestId('shared-list-details');
	await expect(details).toHaveAttribute('data-kind', 'pending');
	await expect(details.getByTestId('active-list-label')).toHaveText('· My todos');
	await expect(details.getByTestId('active-list-pending-note')).toBeVisible();
	await expect(details.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('active-shared-list-name')).toHaveCount(0);
	const words = ((await page.getByTestId('three-word-list-name').textContent()) ?? '').trim();
	expect(words).toMatch(/^\S+-\S+-\S+$/);

	// "Open this list" puts it on screen, without the dialog: it was open all along.
	await page.getByTestId('three-word-list-open').click();
	await expect(details).toHaveAttribute('data-kind', 'shared', { timeout });
	await expect(details.getByTestId('active-shared-list-name')).toHaveText(words);
	await expect(details.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
	await expect(page.getByTestId('share-by-three-words')).toHaveCount(0);
	expect(await isConsentOpen(page)).toBe(false);
	await expect.poll(() => readListLink(page.url()).words).toBe(words);
	expect(readListLink(await expectPageQr(page, expect)).words).toBe(words);

	// And the first todo goes where the words lead.
	await openSection(page, 'aufgaben');
	await expect(listKind(page)).toHaveAttribute('data-kind', 'shared');
	await expect(listKind(page)).not.toHaveAttribute('data-pending', 'true');
	await expect(page.getByTestId('active-list-name')).toHaveText(words);
	const text = `shared-${Date.now().toString(36)}`;
	await todoInput(page).fill(text);
	await page.getByTestId('add-todo-submit').click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
	await expect(listKind(page)).toHaveAttribute('data-kind', 'shared');
	expect(readListLink(page.url()).words).toBe(words);

	// Kept like a start that joined it: a reload comes back to it, not to the
	// list still to be made.
	await page.reload();
	await expect(todoInput(page)).toBeEnabled({ timeout });
	await expect(listKind(page)).toHaveAttribute('data-kind', 'shared', { timeout });
	await expect(page.getByTestId('active-list-name')).toHaveText(words);
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
});
