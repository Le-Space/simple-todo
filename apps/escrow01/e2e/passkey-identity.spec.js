import { test, expect } from '@playwright/test';
import {
	continueWithPasskey,
	isWelcomeOpen,
	passConsent,
	waitForConsent
} from '@simple-todo/e2e-kit/consent.mjs';
import { openSection } from './sections.mjs';

// Chapter (passkey01): Alice and Bob each register a WebAuthn passkey in
// their own browser context (CDP virtual authenticator), write todos into
// the shared list, and both see every todo attributed to the correct author
// DID (resolved from entry.identity). A reload then recovers Alice's
// identity through the create-or-recover flow — the DID stays identical.

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

			// A todo reaches the other browser as a live update on the list's topic,
			// and one published before the other browser is on that topic is not
			// sent again: the heads exchange happens when a browser joins, and both
			// joined with an empty list. Written straight after the start, the two
			// todos missed each other in most runs, on main as well (2026-11-25).
			await Promise.all([expectOtherBrowserInList(alice), expectOtherBrowserInList(bob)]);

			await addTodo(alice, aliceTodo);
			await addTodo(bob, bobTodo);

			// Both peers see both todos, each attributed to its author's DID.
			for (const page of [alice, bob]) {
				await expectTodoWithAuthor(page, aliceTodo, aliceDid);
				await expectTodoWithAuthor(page, bobTodo, bobDid);
			}

			// Reload → the passkey again, by the short step where the device keeps
			// the link, by the dialog where it keeps nothing; the DID must survive.
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
 * Attach a CTAP2.1 virtual authenticator (resident keys + largeBlob) so
 * WebAuthn ceremonies run without any OS dialog.
 * @param {import('@playwright/test').Page} page
 */
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
			hasLargeBlob: true,
			automaticPresenceSimulation: true
		}
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ label: string }} identity
 */
async function openReadyAppWithNewPasskey(page, { label }) {
	await page.goto(testUrl);
	await passConsent(page, { identity: 'create', label, mnemonic: sharedMnemonic });
	await expectAppReady(page);
}

/** @param {import('@playwright/test').Page} page */
async function proceedWithExistingPasskey(page) {
	await waitForConsent(page);
	if (await isWelcomeOpen(page)) {
		await continueWithPasskey(page);
		await expectAppReady(page);
		return;
	}
	await passConsent(page, { identity: 'existing', mnemonic: sharedMnemonic });
	await expectAppReady(page);
}

/** @param {import('@playwright/test').Page} page */
async function expectAppReady(page) {
	// A reload keeps the fragment, so the page may come back on another tab.
	await openSection(page, 'aufgaben');
	await expect(getTodoInput(page)).toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout: collaborationTimeout });
}

/**
 * The light under the list's name: another browser subscribes to this list's
 * topic, directly or through the relay -- which of the two is not this spec's
 * business (`list-peer-led.spec.js`).
 *
 * @param {import('@playwright/test').Page} page
 */
async function expectOtherBrowserInList(page) {
	await openSection(page, 'aufgaben');
	await expect(page.getByTestId('list-peer-led')).toHaveAttribute(
		'data-state',
		/^(direct|relay)$/,
		{ timeout: collaborationTimeout }
	);
}

/** @param {import('@playwright/test').Page} page */
async function getOwnDid(page) {
	await openSection(page, 'konto');
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
	await openSection(page, 'aufgaben');
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
	await openSection(page, 'aufgaben');
	const row = page.locator('div.flex-1').filter({ has: page.getByText(text, { exact: true }) });
	await expect(row.getByTestId('todo-author')).toHaveAttribute('data-author', expectedDid, {
		timeout: collaborationTimeout
	});
}

/** @param {import('@playwright/test').Page} page */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
