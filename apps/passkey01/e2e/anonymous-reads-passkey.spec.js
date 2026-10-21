import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (passkey01): the open list promises that a passkey and a browser
// without one share it. They did not, silently: a browser without a passkey
// never registered the WebAuthn identity provider, so OrbitDB could not
// verify an identity of that kind and kept none of the entries it signed —
// Bob's list simply stayed empty of Alice's todos, with no error anywhere
// (#78). Alice writes with a passkey, Bob reads without one; and Bob's
// entry reaches Alice too.

const collaborationTimeout = 90_000;
const sharedMnemonic = 'bosque-coral-brisa';

test('a browser without a passkey reads what a passkey wrote, and writes back', async ({
	browser
}) => {
	test.setTimeout(collaborationTimeout * 4);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const aliceTodo = `alice-${runId}-with-passkey`;
	const bobTodo = `bob-${runId}-without-passkey`;

	try {
		await addVirtualAuthenticator(alice);
		await alice.goto('/');
		await passConsent(alice, { identity: 'create', label: 'Alice', mnemonic: sharedMnemonic });
		await bob.goto('/');
		await passConsent(bob, { identity: 'anonymous', mnemonic: sharedMnemonic });
		for (const page of [alice, bob]) {
			await expect(todoInput(page)).toBeEnabled({ timeout: collaborationTimeout });
		}
		const aliceDid = await alice.getByTestId('own-did-value').getAttribute('data-did');
		expect(aliceDid).toMatch(/^did:/);

		await addTodo(alice, aliceTodo);
		// Bob has no passkey and no provider of his own to lean on: the entry
		// arrives only if his OrbitDB can verify Alice's identity.
		const row = bob
			.locator('div.flex-1')
			.filter({ has: bob.getByText(aliceTodo, { exact: true }) });
		await expect(row.getByTestId('todo-author')).toHaveAttribute('data-author', String(aliceDid), {
			timeout: collaborationTimeout
		});

		await addTodo(bob, bobTodo);
		await expect(alice.getByText(bobTodo, { exact: true })).toBeVisible({
			timeout: collaborationTimeout
		});
	} finally {
		await bobContext.close();
		await aliceContext.close();
	}
});

/** @param {import('@playwright/test').Page} page */
const todoInput = (page) => page.getByPlaceholder('What needs to be done?');

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	await todoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({
		timeout: collaborationTimeout
	});
}
