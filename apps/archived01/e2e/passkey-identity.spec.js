import { test, expect } from '@playwright/test';
import { acceptNotice, consentModal, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (archived01): Alice and Bob each register a WebAuthn passkey in
// their own browser context (CDP virtual authenticator) and open the same
// three words. Here the list belongs to the passkey — its access controller
// names the DID as the only writer, and so the same words name a list per
// DID: each sees their own todo, attributed to their own DID, and not the
// other's. A reload then recovers Alice's identity through the
// create-or-recover flow — the DID, and with it the list, stays identical.

const testUrl = '/';
const collaborationTimeout = 90000;
const sharedMnemonic = 'bosque-coral-brisa';

test.describe('Passkey identities', () => {
	test('Alice and Bob write with passkey DIDs and recovery keeps the DID stable', async ({
		browser
	}) => {
		test.setTimeout(collaborationTimeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const aliceTodo = `alice-${runId}-passkey-todo`;
		const bobTodo = `bob-${runId}-passkey-todo`;

		try {
			await Promise.all([addVirtualAuthenticator(alice), addVirtualAuthenticator(bob)]);

			// Deliberately the same label on both sides. The passkey is identified by
			// its random user handle, not by what is typed here, so two people who
			// pick the same name still get two identities. Before the handle became
			// random this would have been a collision — on one device the second
			// registration replaced the first.
			await Promise.all([
				openReadyAppWithNewPasskey(alice, { label: 'Alex' }),
				openReadyAppWithNewPasskey(bob, { label: 'Alex' })
			]);

			const aliceDid = await getOwnDid(alice);
			const bobDid = await getOwnDid(bob);
			expect(aliceDid).toMatch(/^did:/);
			expect(bobDid).toMatch(/^did:/);
			expect(aliceDid).not.toBe(bobDid);

			await addTodo(alice, aliceTodo);
			await addTodo(bob, bobTodo);

			// In this chapter the list belongs to the passkey: the same three words
			// name a different list for every DID, so each sees their own todo,
			// attributed to their own DID, and never the other's.
			await expectTodoWithAuthor(alice, aliceTodo, aliceDid);
			await expectTodoWithAuthor(bob, bobTodo, bobDid);
			await expect(alice.getByText(bobTodo, { exact: true })).toHaveCount(0);
			await expect(bob.getByText(aliceTodo, { exact: true })).toHaveCount(0);

			// Reload → the app preselects passkey recovery; the DID must survive.
			await alice.reload();
			await proceedWithExistingPasskey(alice);
			const recoveredDid = await getOwnDid(alice);
			expect(recoveredDid).toBe(aliceDid);
			await expectTodoWithAuthor(alice, aliceTodo, aliceDid);
		} finally {
			await bobContext.close();
			await aliceContext.close();
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
	// A remembered passkey session preselects "Use an existing passkey".
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
	// This scenario is about a *remembered* session -- the dialog preselecting
	// the passkey it knows about -- so it asks for the storage that remembers.
	// In memory mode nothing is kept, and the identity comes back through the
	// authenticator instead; `passkey-restore.spec.js` covers that path (#9).
	await page.getByTestId('storage-mode-indexeddb').check();
	await consentModal(page).getByTestId('shared-list-mnemonic-input').fill(sharedMnemonic);
	// Ticked here rather than at the click, so this helper still hands back a
	// dialog its callers can leave whenever they choose to.
	await acceptNotice(page);
	return consentModal(page);
}

/** @param {import('@playwright/test').Page} page */
async function expectAppReady(page) {
	await expect(getTodoInput(page)).toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout: collaborationTimeout });
}

/** @param {import('@playwright/test').Page} page */
async function getOwnDid(page) {
	const badge = page.getByTestId('own-did-value');
	await expect(badge).toBeVisible({ timeout: collaborationTimeout });
	const did = await badge.getAttribute('data-did');
	if (!did) throw new Error('own DID badge has no data-did attribute');
	return did;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({
		timeout: collaborationTimeout
	});
}

/**
 * The todo must be visible AND carry the writer's DID in its author field —
 * resolved from entry.identity, not from the (spoofable) todo payload.
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {string} expectedDid
 */
async function expectTodoWithAuthor(page, text, expectedDid) {
	const row = page.locator('div.flex-1').filter({ has: page.getByText(text, { exact: true }) });
	await expect(row.getByTestId('todo-author')).toHaveAttribute('data-author', expectedDid, {
		timeout: collaborationTimeout
	});
}

/** @param {import('@playwright/test').Page} page */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
