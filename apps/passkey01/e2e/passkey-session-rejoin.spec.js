import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (passkey01): a new session of the same passkey can still write
// after its earlier entries came back from another peer.
//
// OrbitDB remembers a verified identity under its id signature, which a
// passkey's PRF-derived signing key keeps the same in every session, while
// the WebAuthn proof in the identity is new per session. When the earlier
// session's entries arrive first — here from Bob, who holds the shared list —
// that session sits in the cache, and the new session's own writes are
// refused: "not allowed to write to the log" (seen on a phone restoring a
// laptop's archive, archived01, 2026-10-17; orbitdb/orbitdb#1258). The shared
// `stale-identity-cache.js` re-checks such an identity; without it Alice's
// second todo below never appears.
//
// The "other device" is Alice's browser after a wipe: IndexedDB gone, and the
// provider's remembered proof gone too, so the restored identity carries a
// fresh assertion the way another device's would. Bob, with a passkey of his
// own, is on the same three words — the list is open in this chapter — and
// keeps the entry alive while Alice forgets it.

const timeout = 90000;
const mnemonic = 'bosque-coral-brisa';

test('writes again after an earlier session of the same passkey came back from a peer', async ({
	browser
}) => {
	test.setTimeout(timeout * 4);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	try {
		const cdp = await addVirtualAuthenticator(alice);
		await alice.goto('/');
		await passConsent(alice, { identity: 'create', label: 'Rejoiner', persistent: true, mnemonic });
		await expect(todoInput(alice)).toBeEnabled({ timeout });
		const did = await alice.getByTestId('own-did-value').getAttribute('data-did');
		expect(did).toMatch(/^did:/);

		// Bob with a passkey of his own: only a browser that registered the
		// WebAuthn provider verifies — and therefore keeps — a passkey's entries.
		await addVirtualAuthenticator(bob);
		await bob.goto('/');
		await passConsent(bob, { identity: 'create', label: 'Holder', mnemonic });
		await expect(todoInput(bob)).toBeEnabled({ timeout });
		const bobPeerId = await peerIdOf(bob);
		await expectConnected(alice, bobPeerId);
		await expectConnected(bob, await peerIdOf(alice));

		await addTodo(alice, `first-${run}`);
		// Bob holds it: that is what brings it back to Alice later.
		await expect(bob.getByText(`first-${run}`, { exact: true })).toBeVisible({ timeout });

		await cdp.send('Storage.clearDataForOrigin', {
			origin: new URL(alice.url()).origin,
			storageTypes: 'indexeddb'
		});
		await alice.evaluate(() => {
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith('webauthn-identity-proof:')) localStorage.removeItem(key);
			}
		});
		await alice.reload();
		await waitForConsent(alice);
		await passConsent(alice, { identity: 'existing', persistent: true, mnemonic });
		await expect(todoInput(alice)).toBeEnabled({ timeout });
		expect(await alice.getByTestId('own-did-value').getAttribute('data-did')).toBe(did);
		await expectConnected(alice, bobPeerId);
		// The earlier session's entry comes back — and is verified first.
		await expect(alice.getByText(`first-${run}`, { exact: true })).toBeVisible({ timeout });
		// The same passkey, a new session: it still writes.
		await addTodo(alice, `second-${run}`);
		await expect(alice.getByText(/Failed to add todo/)).toHaveCount(0);
		await expect(bob.getByText(`second-${run}`, { exact: true })).toBeVisible({ timeout });
	} finally {
		await aliceContext.close();
		await bobContext.close();
	}
});

/** @param {import('@playwright/test').Page} page */
const todoInput = (page) => page.getByPlaceholder('What needs to be done?');

/** @param {import('@playwright/test').Page} page @param {string} text */
async function addTodo(page, text) {
	await todoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function peerIdOf(page) {
	await expect
		.poll(() => page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null), { timeout })
		.toBeTruthy();
	return page.evaluate(() => window.__simpleTodoE2E.getPeerId());
}

/**
 * A browser-to-browser connection (WebRTC, or the relay's circuit while it
 * upgrades): what replication rides on.
 * @param {import('@playwright/test').Page} page @param {string} remotePeerId
 */
async function expectConnected(page, remotePeerId) {
	await expect
		.poll(
			() =>
				page.evaluate(
					(peerId) =>
						window.__simpleTodoE2E
							?.getConnections?.()
							.some((connection) => connection.remotePeer === peerId) ?? false,
					remotePeerId
				),
			{ timeout }
		)
		.toBe(true);
}
