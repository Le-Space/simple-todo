import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator, forgetThisDevice } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (privacy01), #120: the owner gets a copy of her own key.
//
// A sealed list's key used to live only in the browser that created it. The
// same passkey on a second device — or this browser once its storage is gone —
// was the same person and could not read her own list.
//
// Now the owner is a recipient like any other: a copy of the key is sealed to
// her when the list is created, and her encryption key pair is derived from the
// signing key the passkey provider derives from the passkey's PRF output. So a
// device that has never seen this identity arrives at the same pair, and finds
// her copy.
//
// **"A second device" is this browser with everything it kept wiped**, on the
// same virtual authenticator: a credential copied into another browser context
// loses its PRF secret (the virtual authenticator does not export it), and a
// passkey without it is a different signing key — not the case this is about.
// `forgetThisDevice` clears local storage, session storage and every IndexedDB
// database, so nothing of the first session is left but the passkey.
//
// **The list and the copy come back from a peer, not from the relay.** Measured
// while writing this: after the wipe the relay delivers neither the list's
// entries nor the store of copies to a browser that holds nothing — 0 entries
// in both for two minutes, while the list's manifest and access controller do
// arrive. That is orbitdb/orbitdb#1255 (a reader reached only through a relay
// never gets the first entry), tracked elsewhere; `list-registry.spec.js` and
// `encrypted-list.spec.js` carry `fixme`s for the same reason. So a second
// person, the keeper, holds both: someone who opened the list by address and
// replicates it, and who cannot read a word of it. That is also a fair picture
// of where a sealed list lives — on whoever replicates it.

const testUrl = '/';
const timeout = 90000;

test('the owner reads her sealed list on a device that kept nothing', async ({ browser }) => {
	test.setTimeout(timeout * 6);

	const ownerContext = await browser.newContext();
	const keeperContext = await browser.newContext();
	const owner = await ownerContext.newPage();
	const keeper = await keeperContext.newPage();
	const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	const todo = `sealed-for-myself-${runId}`;

	try {
		await addVirtualAuthenticator(owner);
		await addVirtualAuthenticator(keeper);

		// Both online before the list exists, so the keeper's store of copies
		// receives the owner's copy as it is written.
		await openReadyApp(owner, { identity: 'create', label: 'Owner' });
		await openReadyApp(keeper, { identity: 'create', label: 'Keeper' });
		const before = await identityOf(owner);

		// A direct connection first, as the collaboration specs wait for one: a
		// heads exchange over the relay's circuit is refused (see AGENTS.md), and
		// what this test is about starts after the data has arrived.
		await expectWebRTCConnection(owner, await peerIdOf(keeper));

		await owner.getByTestId('new-list-name').fill(`own-${runId}`);
		await owner.getByTestId('new-list-create').click();
		await expect(owner.getByTestId('permissions-panel')).toBeVisible({ timeout });
		const address =
			(await owner.getByTestId('new-list-created-address').textContent())?.trim() ?? '';
		expect(address).toMatch(/^\/orbitdb\/[A-Za-z0-9]+$/);

		// The keeper opens the list before anything is in it, so the entry reaches
		// it as it is written rather than through a late join.
		await openListByAddress(keeper, address);
		await todoInput(owner).fill(todo);
		await owner.getByRole('button', { name: 'Add TODO' }).click();
		await expect(owner.getByText(todo, { exact: true })).toBeVisible({ timeout });

		// The keeper replicates the list and reads nothing in it.
		await expect
			.poll(async () => (await logSummary(keeper)).unreadable, { timeout })
			.toBeGreaterThanOrEqual(1);
		await expect(keeper.getByText(todo, { exact: true })).toHaveCount(0);

		// The owner's device forgets everything.
		await forgetThisDevice(owner);
		await owner.goto(testUrl);
		await waitForConsent(owner);
		await passConsent(owner, { persistent: false, identity: 'existing' });
		await expect(todoInput(owner)).toBeEnabled({ timeout: 120000 });

		// The same person, and — what the copy depends on — the same signing key:
		// the encryption key pair is derived from it. A restore used to ask the
		// provider for its default key type rather than the one the identity was
		// built with, and signed under a different key (passkey-identity.js).
		const after = await identityOf(owner);
		expect(after.id).toBe(before.id);
		expect(after.publicKey, 'the restored identity signs with a different key').toBe(
			before.publicKey
		);
		// Nothing of the first session is here: no list key, no device key.
		expect(await keptKeys(owner)).toEqual([]);

		// A new session is a new peer; the keeper is the one that holds the list.
		await expectWebRTCConnection(owner, await peerIdOf(keeper));
		await openListByAddress(owner, address);
		// Two steps, because they fail for different reasons. The entry has to
		// replicate to this device at all — a matter of sync, not of keys — and
		// then her copy of the key has to arrive and open it.
		await expect
			.poll(async () => (await logSummary(owner)).entries, {
				timeout,
				message: 'the list never replicated to the second device'
			})
			.toBeGreaterThanOrEqual(1);
		await expect(owner.getByText(todo, { exact: true }), {
			message: 'the entry is here and the owner cannot open it: her key copy did not arrive'
		}).toBeVisible({ timeout: timeout * 2 });
		await expect.poll(async () => (await logSummary(owner)).unreadable).toBe(0);

		// And the keeper, who carried the copy, still reads nothing.
		await expect(keeper.getByText(todo, { exact: true })).toHaveCount(0);
	} finally {
		await keeperContext.close();
		await ownerContext.close();
	}
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ identity: 'create' | 'existing', label?: string }} choice
 */
async function openReadyApp(page, { identity, label }) {
	await page.goto(testUrl);
	await waitForConsent(page);
	await passConsent(page, { persistent: false, identity, label });
	await expect(todoInput(page)).toBeEnabled({ timeout });
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

/** @param {import('@playwright/test').Page} page */
async function peerIdOf(page) {
	await expect
		.poll(() => page.evaluate(() => /** @type {any} */ (window).__simpleTodoE2E?.getPeerId?.()), {
			timeout
		})
		.toBeTruthy();
	return page.evaluate(() => /** @type {any} */ (window).__simpleTodoE2E.getPeerId());
}

/**
 * A browser-to-browser WebRTC connection to that peer: `/webrtc` in the
 * address is the upgraded transport, whatever `/p2p-circuit` the address still
 * remembers of the introduction (AGENTS.md, "Two traps").
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} remotePeerId
 */
async function expectWebRTCConnection(page, remotePeerId) {
	await expect
		.poll(
			() =>
				page.evaluate(
					(peerId) =>
						/** @type {any} */ (window).__simpleTodoE2E
							?.getConnections?.()
							.some(
								(/** @type {any} */ connection) =>
									connection.remotePeer === peerId && connection.remoteAddr?.includes('/webrtc')
							) ?? false,
					remotePeerId
				),
			{ timeout }
		)
		.toBe(true);
}

/** @param {import('@playwright/test').Page} page */
async function identityOf(page) {
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					Boolean(/** @type {any} */ (window).__simpleTodoE2E?.getOrbitDBIdentity?.())
				),
			{ timeout }
		)
		.toBe(true);
	return page.evaluate(() => /** @type {any} */ (window).__simpleTodoE2E.getOrbitDBIdentity());
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

/** @param {import('@playwright/test').Page} page */
async function keptKeys(page) {
	return page.evaluate(() =>
		Object.keys(localStorage).filter(
			(key) => key.startsWith('privacy01.dbKey.') || key.startsWith('privacy01.deviceKey.')
		)
	);
}

/** @param {import('@playwright/test').Page} page */
function todoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
