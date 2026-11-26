import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { openSection } from './sections.mjs';
import { pinTechnicalView } from './technical-view.mjs';

// #127: a private list is sealed. Who reads what:
//
//   Alice    owns the list: every todo.
//   Bob      is the delegate of one todo: that todo, and nothing else.
//   Carol    may write to the list: every todo, until Alice removes her.
//   Mallory  has the address and no rights: nothing. What her browser holds
//            of the list is what the relay holds, and what any stranger with
//            the address gets: envelopes, and no todo text in the clear.
//
// Each identity is a passkey in a browser context of its own.

const testUrl = '/';
const timeout = 90000;

/** Progress in the CI log, so a timeout says which step it was. @param {string} message */
function step(message) {
	console.log(`[sealed ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

test.describe('Sealed private lists (#127)', () => {
	test('the delegate reads his todo only, and a stranger with the address reads nothing', async ({
		browser
	}) => {
		test.setTimeout(timeout * 7);
		const alice = await newIdentity(browser, 'Alice');
		const bob = await newIdentity(browser, 'Bob');
		const mallory = await newIdentity(browser, 'Mallory');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const kept = `kept-${runId}`;
		const delegated = `delegated-${runId}`;
		const renamed = `${delegated}-renamed`;

		try {
			step('Alice makes the list, a todo for herself and one for Bob');
			await createPrivateList(alice.page);
			await addTodoOk(alice.page, kept);
			await addTodoOk(alice.page, delegated, { delegateDid: bob.did });
			const address = await getActiveDatabaseAddress(alice.page);

			step('Bob and Mallory open it by address');
			await openListByAddress(bob.page, address);
			await openListByAddress(mallory.page, address, 3);

			step('Bob reads his todo and not Alice’s');
			await expectTodo(bob.page, delegated);
			await expect(rowFor(bob.page, delegated)).toHaveAttribute('data-role', 'delegate');
			await expectHidden(bob.page, 1);
			await expect(bob.page.getByText(kept, { exact: true })).toHaveCount(0);

			step('Mallory reads neither, and cannot write');
			await expectHidden(mallory.page, 2);
			await expect(mallory.page.getByText(kept, { exact: true })).toHaveCount(0);
			await expect(mallory.page.getByText(delegated, { exact: true })).toHaveCount(0);
			await addTodoExpectDenied(mallory.page, `intruder-${runId}`);

			step('what Mallory holds of the list is sealed');
			const held = await entriesOnceThere(mallory.page, 2);
			expectNothingInTheClear(held, [kept, delegated]);

			step('Bob renames his todo; Alice reads it, Mallory does not');
			await renameTodo(bob.page, delegated, renamed);
			await expectDelegatedWriteSigned(bob.page, 'patch-fields');
			await expectTodo(alice.page, renamed);
			await expect
				.poll(
					async () =>
						(await mallory.page.evaluate(() => window.__simpleTodoE2E.getOpenListEntries())).some(
							(/** @type {any} */ entry) => String(entry.key).startsWith('delegation-action/')
						),
					{ timeout, message: 'waiting for Bob’s rename to reach Mallory' }
				)
				.toBe(true);
			expectNothingInTheClear(
				await mallory.page.evaluate(() => window.__simpleTodoE2E.getOpenListEntries()),
				[renamed]
			);

			step('Alice takes the todo back: Bob no longer reads it');
			await openSection(alice.page, 'aufgaben');
			await rowFor(alice.page, renamed).getByTestId('todo-revoke-delegation').click();
			// Taking it back takes Bob's rename back too, as in delegation.spec.js:
			// the row shows Alice's own text again.
			await expect(rowFor(alice.page, delegated).getByTestId('todo-delegation-status')).toHaveText(
				'revoked',
				{ timeout }
			);
			await expectHidden(bob.page, 2);
			await expect(bob.page.getByText(renamed, { exact: true })).toHaveCount(0);
			await expect(bob.page.getByText(delegated, { exact: true })).toHaveCount(0);
		} finally {
			await Promise.all([alice.close(), bob.close(), mallory.close()]);
		}
	});

	test('a writer reads and writes the whole list, and nothing after she is removed', async ({
		browser
	}) => {
		test.setTimeout(timeout * 6);
		const alice = await newIdentity(browser, 'Alice');
		const carol = await newIdentity(browser, 'Carol');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const before = `before-carol-${runId}`;
		const byCarol = `by-carol-${runId}`;
		const after = `after-carol-${runId}`;

		try {
			step('Alice makes the list and gives Carol write access');
			await createPrivateList(alice.page);
			await addTodoOk(alice.page, before);
			const address = await getActiveDatabaseAddress(alice.page);
			await grantWrite(alice.page, carol.did);
			await expect(alice.page.getByTestId('permission-key-note')).toHaveCount(0);

			step('Carol opens it: she reads what was there, and writes');
			await openListByAddress(carol.page, address);
			await expectTodo(carol.page, before);
			await addTodoOk(carol.page, byCarol);
			await expectTodo(alice.page, byCarol);

			step('Alice removes her; what Alice writes next stays sealed to Carol');
			await revokeWrite(alice.page, carol.did);
			await expect(alice.page.getByTestId('permission-key-note')).toBeVisible({ timeout });
			await addTodoOk(alice.page, after);
			// Whether the entry reaches Carol at all, apart from whether she can open
			// it: the two failed together until now, and only this tells them apart.
			await expect
				.poll(
					async () =>
						(await carol.page.evaluate(() => window.__simpleTodoE2E.getOpenListEntries())).length,
					{ timeout, message: 'waiting for Alice’s todo to reach Carol at all' }
				)
				.toBeGreaterThanOrEqual(3);
			step('Alice’s todo reached Carol; is it sealed to her?');
			await expectHidden(carol.page, 1);
			await expect(carol.page.getByText(after, { exact: true })).toHaveCount(0);
			// What she could read stays readable to her: a grant cannot be taken back.
			await expectTodo(carol.page, before);
		} finally {
			await Promise.all([alice.close(), carol.close()]);
		}
	});
});

/**
 * @param {Array<{ key: string | null, value: any }>} entries
 * @param {string[]} texts the todo texts that must not appear in the clear
 */
function expectNothingInTheClear(entries, texts) {
	const raw = JSON.stringify(entries);
	for (const text of texts) expect(raw, `"${text}" in the clear`).not.toContain(text);
	for (const entry of entries) {
		if (entry.value === null || String(entry.key).startsWith('delegation-action/')) continue;
		expect(entry.value, `${entry.key} is not sealed`).toMatchObject({ sealed: 1 });
	}
}

/**
 * The open list's raw entries in this browser, once there are `count` of them.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} count
 */
async function entriesOnceThere(page, count) {
	await page.waitForFunction(() => window.__simpleTodoE2E != null, null, { timeout });
	await expect
		.poll(
			async () => (await page.evaluate(() => window.__simpleTodoE2E.getOpenListEntries())).length,
			{ timeout, message: `waiting for ${count} entries` }
		)
		.toBeGreaterThanOrEqual(count);
	return page.evaluate(() => window.__simpleTodoE2E.getOpenListEntries());
}

/** @param {import('@playwright/test').Page} page @param {number} count */
async function expectHidden(page, count) {
	await openSection(page, 'aufgaben');
	await expect(page.getByTestId('sealed-hidden-todos')).toContainText(
		count === 1 ? '1 todo in this list is sealed' : `${count} todos in this list are sealed`,
		{ timeout }
	);
}

/** @param {import('@playwright/test').Page} page @param {string} did */
async function grantWrite(page, did) {
	await openSection(page, 'listen');
	await page.getByTestId('permission-did-input').fill(did);
	await page.getByTestId('permission-add').click();
	await expect(page.locator(`[data-testid="permission-entry"][data-did="${did}"]`)).toBeVisible({
		timeout
	});
}

/** @param {import('@playwright/test').Page} page @param {string} did */
async function revokeWrite(page, did) {
	await openSection(page, 'listen');
	const entry = page.locator(`[data-testid="permission-entry"][data-did="${did}"]`);
	await entry.getByTestId('permission-revoke').click();
	await expect(entry).toHaveCount(0, { timeout });
}

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {string} label
 */
async function newIdentity(browser, label) {
	const context = await browser.newContext();
	// `waitForPeers` reads the peer count from the network details, which only
	// the technical view renders.
	await pinTechnicalView(context);
	const page = await context.newPage();
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning') {
			console.log(`[${label}:${message.type()}] ${message.text()}`);
		}
	});
	page.on('pageerror', (error) => console.log(`[${label}:pageerror] ${error.message}`));
	await addVirtualAuthenticator(page);
	await page.goto(testUrl);
	await passConsent(page, { identity: 'create', label });
	await expect(todoInput(page)).toBeEnabled({ timeout });
	const did = await getOwnDid(page);
	step(`${label} is ${did.slice(0, 20)}…`);
	return { page, did, close: () => context.close() };
}

/** @param {import('@playwright/test').Page} page */
async function addVirtualAuthenticator(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasPrf: true,
			automaticPresenceSimulation: true
		}
	});
}

/** @param {import('@playwright/test').Page} page */
async function getOwnDid(page) {
	await openSection(page, 'konto');
	const badge = page.getByTestId('own-did-value');
	await expect(badge).toBeVisible({ timeout });
	const did = await badge.getAttribute('data-did');
	if (!did) throw new Error('own DID badge has no data-did');
	return did;
}

/** @param {import('@playwright/test').Page} page */
async function createPrivateList(page) {
	await openSection(page, 'listen');
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });
	await openSection(page, 'aufgaben');
	await expect(page.getByTestId('add-todo-delegate-toggle')).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function getActiveDatabaseAddress(page) {
	const el = page.getByTestId('active-database-address');
	await expect
		.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout })
		.toMatch(/^\/orbitdb\//);
	return ((await el.textContent()) ?? '').trim();
}

/**
 * Wait until this browser has at least `count` peers (the relay counts as
 * one), as delegation.spec.js does before opening by address.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} count
 */
async function waitForPeers(page, count) {
	const details = page.getByTestId('network-details');
	await expect
		.poll(
			async () => {
				const text = (await details.textContent()) ?? '';
				const match = /(\d+) peers?/.exec(text);
				return match ? Number(match[1]) : 0;
			},
			{ timeout, message: `waiting for ${count} peers` }
		)
		.toBeGreaterThanOrEqual(count);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} address
 * @param {number} [peers]
 */
async function openListByAddress(page, address, peers = 2) {
	await waitForPeers(page, peers);
	await openSection(page, 'listen');
	await page.getByTestId('open-db-address-input').fill(address);
	const el = page.getByTestId('active-database-address');
	// The manifest fetch can time out once while fresh browsers still find each
	// other (delegation.spec.js); the same retry a person would make.
	for (let attempt = 1; attempt <= 3; attempt++) {
		await page.getByTestId('open-db-button').click();
		const opened = await expect
			.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout })
			.toBe(address)
			.then(
				() => true,
				() => false
			);
		if (opened) return;
		step(`open by address failed (attempt ${attempt}), retrying`);
	}
	throw new Error(`Could not open ${address} after 3 attempts`);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {{ delegateDid?: string }} [delegation]
 */
async function addTodoOk(page, text, delegation = {}) {
	await openSection(page, 'aufgaben');
	await todoInput(page).fill(text);
	if (delegation.delegateDid) {
		const toggle = page.getByTestId('add-todo-delegate-toggle');
		if (!(await toggle.isChecked())) await toggle.check();
		await page.getByTestId('add-todo-delegate-did').fill(delegation.delegateDid);
	}
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expectTodo(page, text);
}

/** @param {import('@playwright/test').Page} page @param {string} text */
async function addTodoExpectDenied(page, text) {
	await openSection(page, 'aufgaben');
	await todoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(/no write permission|write access|no key for it yet/i)).toBeVisible({
		timeout
	});
	await page.waitForTimeout(2000);
	await expect(page.getByText(text, { exact: true })).toHaveCount(0);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} from
 * @param {string} to
 */
async function renameTodo(page, from, to) {
	await openSection(page, 'aufgaben');
	const row = rowFor(page, from);
	await row.getByTestId('todo-edit').click();
	await row.getByTestId('todo-edit-input').fill(to);
	await row.getByTestId('todo-edit-save').click();
	await expectTodo(page, to);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'set-completed' | 'patch-fields'} action
 */
async function expectDelegatedWriteSigned(page, action) {
	const badge = page.getByTestId('delegated-auth-state');
	await expect(badge).toHaveAttribute('data-state', 'success', { timeout });
	await expect(badge).toHaveAttribute('data-action', action);
}

/** @param {import('@playwright/test').Page} page @param {string} text */
async function expectTodo(page, text) {
	await openSection(page, 'aufgaben');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page @param {string} text */
function rowFor(page, text) {
	return page.locator(`[data-testid="todo-item"][data-todo-text="${text}"]`);
}

/** @param {import('@playwright/test').Page} page */
function todoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
