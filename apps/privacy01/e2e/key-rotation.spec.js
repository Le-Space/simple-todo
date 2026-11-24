import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (privacy01), #120: removing a reader has to change the key.
//
// Before, "Remove" took away the write grant and nothing else. The removed DID
// kept the list key and the address, so it went on replicating the list and
// reading every entry written after it was removed — the button promised more
// than it did.
//
// Now a removal starts a new key epoch. Everybody who stays gets a copy of the
// new key; the removed DID does not. This drives that with three people: Alice
// owns the list, Bob is removed, Carol stays. What it proves is the difference
// between the two who were let in:
//
// - Carol reads what Alice writes after the removal, and what Carol writes is
//   sealed under the new key too — her copy reaches her while the list is
//   open, without a reload.
// - Bob receives those same entries — the log on his side grows — and cannot
//   open them. That distinction matters: an entry that simply never arrived
//   would look the same on screen, and prove nothing.
// - Bob still reads what was written before. A key handed over cannot be taken
//   back, and the panel says so.

const testUrl = '/';
const timeout = 90000;

test.describe('a removed reader and the key (#120)', () => {
	test('a reader removed from a sealed list cannot read what is written afterwards', async ({
		browser
	}) => {
		test.setTimeout(timeout * 10);

		const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
		const [alice, bob, carol] = await Promise.all(contexts.map((context) => context.newPage()));
		const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const before = `before-removal-${runId}`;
		const after = `after-removal-${runId}`;
		const carolAfter = `carol-after-removal-${runId}`;

		try {
			for (const page of [alice, bob, carol]) await addVirtualAuthenticator(page);

			await openReadyApp(alice, 'Alice');
			await alice.getByTestId('new-list-name').fill(`rotation-${runId}`);
			await alice.getByTestId('new-list-create').click();
			await expect(alice.getByTestId('permissions-panel')).toBeVisible({ timeout });
			await addTodoOk(alice, before);
			const address = await activeAddress(alice);

			await openReadyApp(bob, 'Bob');
			await openReadyApp(carol, 'Carol');
			const bobDid = await ownDid(bob);
			const carolDid = await ownDid(carol);
			await openListByAddress(bob, address);
			await openListByAddress(carol, address);

			// Both admitted, and both read the list. The copies reach them while it
			// is open: the store of copies announces them, and the list is reopened
			// sealed without anybody clicking.
			await grantWriteAccess(alice, bobDid);
			await grantWriteAccess(alice, carolDid);
			await expectTodo(bob, before);
			await expectTodo(carol, before);

			// Alice removes Bob. The panel says what that does and what it cannot.
			await expect(alice.getByTestId('permission-revoke-hint')).toContainText('earlier keys');
			await alice
				.locator(`[data-testid="permission-entry"][data-did="${bobDid}"]`)
				.getByTestId('permission-revoke')
				.click();
			await expect(
				alice.locator(`[data-testid="permission-entry"][data-did="${bobDid}"]`)
			).toHaveCount(0, { timeout });
			const notice = alice.getByTestId('permission-notice');
			await expect(notice).toContainText('new key', { timeout });
			await expect(notice).toContainText('every entry written before now');
			await expect(alice.getByTestId('permission-error')).toHaveCount(0);

			const bobHad = await logSummary(bob);
			await addTodoOk(alice, after);

			// Carol stays, so she reads it: her copy of the new key arrived.
			await expectTodo(carol, after);
			// And what she writes now is sealed under it as well.
			await addTodoOk(carol, carolAfter);
			await expectTodo(alice, carolAfter);

			// Bob received both entries and opens neither.
			await expect
				.poll(async () => (await logSummary(bob)).unreadable, { timeout })
				.toBeGreaterThanOrEqual(bobHad.unreadable + 2);
			await expect(bob.getByText(after, { exact: true })).toHaveCount(0);
			await expect(bob.getByText(carolAfter, { exact: true })).toHaveCount(0);
			// What he already had stays his.
			await expectTodo(bob, before);

			// Opening the list again changes nothing for him: no copy of the new
			// key was ever made for his DID.
			await bob.getByTestId('open-db-address-input').fill(address);
			await bob.getByTestId('open-db-button').click();
			await expectTodo(bob, before);
			await bob.waitForTimeout(5000);
			await expect(bob.getByText(after, { exact: true })).toHaveCount(0);
			await expect(bob.getByText(carolAfter, { exact: true })).toHaveCount(0);
		} finally {
			await Promise.all(contexts.map((context) => context.close()));
		}
	});
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function openReadyApp(page, label) {
	await page.goto(testUrl);
	await passConsent(page, { identity: 'create', label });
	await expect(todoInput(page)).toBeEnabled({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function ownDid(page) {
	const badge = page.getByTestId('own-did-value');
	await expect(badge).toBeVisible({ timeout });
	const did = await badge.getAttribute('data-did');
	if (!did) throw new Error('own DID badge has no data-did');
	return did;
}

/** @param {import('@playwright/test').Page} page */
async function activeAddress(page) {
	const el = page.getByTestId('active-database-address');
	await expect
		.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout })
		.toMatch(/^\/orbitdb\//);
	return ((await el.textContent()) ?? '').trim();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} address
 */
async function openListByAddress(page, address) {
	await page.getByTestId('open-db-address-input').fill(address);
	await page.getByTestId('open-db-button').click();
	const el = page.getByTestId('active-database-address');
	await expect.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout }).toBe(address);
}

/**
 * Granted once, then again while the app says the key did not go with it —
 * the DID's published key may not have reached the owner yet. Same as
 * acl-permissions.spec.js, for the same reason.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} did
 */
async function grantWriteAccess(page, did) {
	for (let attempt = 1; attempt <= 5; attempt++) {
		await page.getByTestId('permission-did-input').fill(did);
		await page.getByTestId('permission-add').click();
		await expect(page.locator(`[data-testid="permission-entry"][data-did="${did}"]`)).toBeVisible({
			timeout
		});

		const notice = page.getByTestId('permission-error');
		if ((await notice.count()) === 0) return;
		if (!/published no encryption key yet/.test((await notice.textContent()) ?? '')) return;

		await page.waitForTimeout(3000);
	}

	throw new Error(`granting ${did} never handed over the list key`);
}

/**
 * How many entries the open list holds here, and how many of them this reader
 * cannot open (`getTodoLogSummary` in db-actions.js).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ entries: number, unreadable: number }>}
 */
async function logSummary(page) {
	return page.evaluate(() => /** @type {any} */ (window).getTodoLogSummary());
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodoOk(page, text) {
	await todoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodo(page, text) {
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page */
function todoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
