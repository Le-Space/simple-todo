import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { openSection } from './sections.mjs';
import { pinTechnicalView } from './technical-view.mjs';
import { identityBlock } from './identity-block.mjs';
import { expectReadersMoment } from '@simple-todo/e2e-kit/moment.mjs';

// Chapter (delegation01): a list stays owner-only, but the owner may hand ONE
// todo to another DID. That delegate may complete or rename exactly that todo
// — and nothing else — until the owner revokes it or the delegation expires.
// Every delegated write is confirmed with the delegate's passkey first.
//
// Three passkey identities, each in its own browser context:
//   Alice  owns the list
//   Bob    is the delegate
//   Mallory has the address, and no rights

const testUrl = '/';
const timeout = 90000;

/** Progress in the CI log, so a timeout says which step it was. @param {string} message */
function step(message) {
	console.log(`[delegation ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

test.describe('Per-todo delegation', () => {
	test('Bob completes and renames the todo Alice delegated to him, and nothing else', async ({
		browser
	}) => {
		test.setTimeout(timeout * 6);
		const alice = await newIdentity(browser, 'Alice');
		const bob = await newIdentity(browser, 'Bob');
		const mallory = await newIdentity(browser, 'Mallory');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const delegated = `delegated-${runId}`;
		const kept = `kept-${runId}`;
		const renamed = `${delegated}-renamed-by-bob`;

		try {
			// 1. Alice: private list, Bob's DID on one todo, a second todo for herself.
			step('identities ready; Alice creates the list');
			await createPrivateList(alice.page);
			await addTodoOk(alice.page, delegated, { delegateDid: bob.did });
			await addTodoOk(alice.page, kept);
			const address = await getActiveDatabaseAddress(alice.page);
			const delegatedRow = rowFor(alice.page, delegated);
			await expect(delegatedRow.getByTestId('todo-delegate')).toHaveAttribute('data-did', bob.did);
			await expect(delegatedRow.getByTestId('todo-delegation-status')).toHaveText('active');

			// 2. Bob and Mallory open the list by address. Neither is in the write set.
			//    The list is sealed (#127): Bob reads the todo handed to him and
			//    nothing else; Mallory reads nothing (sealed-lists.spec.js has more).
			step('Bob and Mallory open the list by address');
			await openListByAddress(bob.page, address);
			await openListByAddress(mallory.page, address, 3);
			await expectTodo(bob.page, delegated);
			for (const page of [bob.page, mallory.page]) {
				await expect(page.getByText(kept, { exact: true })).toHaveCount(0);
				await addTodoExpectDenied(page, `intruder-${runId}`);
			}
			await expect(mallory.page.getByText(delegated, { exact: true })).toHaveCount(0);

			// 3. The delegated row is Bob's to change.
			step('roles on the rows');
			await expect(rowFor(bob.page, delegated)).toHaveAttribute('data-role', 'delegate');

			// 4. Bob completes it. His passkey is asked first; the write lands on Alice's side.
			step('Bob completes the delegated todo');
			await checkbox(bob.page, delegated).check();
			await expectDelegatedWriteSigned(bob.page, 'set-completed');
			await expect(checkbox(bob.page, delegated)).toBeChecked({ timeout });
			await expect(checkbox(alice.page, delegated)).toBeChecked({ timeout });
			await expect(rowFor(alice.page, delegated).getByTestId('todo-updated-by')).toBeVisible({
				timeout
			});

			// 5. Bob renames it; Alice sees the new text, Mallory does not.
			step('Bob renames it');
			await renameTodo(bob.page, delegated, renamed);
			await expectDelegatedWriteSigned(bob.page, 'patch-fields');
			await expectTodo(alice.page, renamed);
			await expect(mallory.page.getByText(renamed, { exact: true })).toHaveCount(0);

			// 6. Alice's own todo was never touched.
			step('done; checking the untouched todo');
			await expect(checkbox(alice.page, kept)).not.toBeChecked();
		} finally {
			await Promise.all([alice.close(), bob.close(), mallory.close()]);
		}
	});

	test('Revoking takes the delegation back, including what Bob already did', async ({
		browser
	}) => {
		test.setTimeout(timeout * 5);
		const alice = await newIdentity(browser, 'Alice');
		const bob = await newIdentity(browser, 'Bob');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const todo = `revocable-${runId}`;

		try {
			await createPrivateList(alice.page);
			await addTodoOk(alice.page, todo, { delegateDid: bob.did });
			const address = await getActiveDatabaseAddress(alice.page);
			await openListByAddress(bob.page, address);
			await expectTodo(bob.page, todo);

			// Bob completes it while delegated.
			await checkbox(bob.page, todo).check();
			await expectDelegatedWriteSigned(bob.page, 'set-completed');
			await expect(checkbox(alice.page, todo)).toBeChecked({ timeout });

			// Alice revokes. The completion is a delegate action; without the
			// delegation it no longer applies — on both sides.
			await rowFor(alice.page, todo).getByTestId('todo-revoke-delegation').click();
			await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
				'revoked',
				{ timeout }
			);
			await expect(checkbox(alice.page, todo)).not.toBeChecked({ timeout });
			// Taken back, the todo goes under the list key, which Bob never had
			// (#127): it leaves his view, and what Alice writes from now on is not
			// his to read.
			await expect(bob.page.getByText(todo, { exact: true })).toHaveCount(0, { timeout });
			await expect(bob.page.getByTestId('sealed-hidden-todos')).toBeVisible({ timeout });
		} finally {
			await Promise.all([alice.close(), bob.close()]);
		}
	});

	test('An expired delegation grants nothing; re-delegating from the row brings it back', async ({
		browser
	}) => {
		test.setTimeout(timeout * 5);
		const alice = await newIdentity(browser, 'Alice');
		const bob = await newIdentity(browser, 'Bob');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const todo = `expiring-${runId}`;

		try {
			await createPrivateList(alice.page);
			// Expired a minute ago: the UI shows it, and the checkbox stays disabled for Bob.
			const aMinuteAgo = new Date(Date.now() - 60_000);
			await addTodoOk(alice.page, todo, { delegateDid: bob.did, expiresAt: aMinuteAgo });
			await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
				'expired'
			);
			// A deadline between two people says whose clock it is written in.
			await expectReadersMoment(
				alice.page,
				rowFor(alice.page, todo).locator('time[datetime]'),
				expect
			);
			const address = await getActiveDatabaseAddress(alice.page);
			await openListByAddress(bob.page, address);
			await expectTodo(bob.page, todo);
			await expect(rowFor(bob.page, todo).getByTestId('todo-delegation-status')).toHaveText(
				'expired'
			);
			await expect(checkbox(bob.page, todo)).toBeDisabled();

			// Alice re-delegates from the row, this time without an expiry.
			const row = rowFor(alice.page, todo);
			await row.getByTestId('todo-delegate-open').click();
			await row.getByTestId('todo-delegate-did-input').fill(bob.did);
			await row.getByTestId('todo-delegate-save').click();
			await expect(row.getByTestId('todo-delegation-status')).toHaveText('active', { timeout });

			await expect(checkbox(bob.page, todo)).toBeEnabled({ timeout });
			await checkbox(bob.page, todo).check();
			await expectDelegatedWriteSigned(bob.page, 'set-completed');
			await expect(checkbox(alice.page, todo)).toBeChecked({ timeout });
		} finally {
			await Promise.all([alice.close(), bob.close()]);
		}
	});
	// The three above put Alice and Bob in front of each other. These put the
	// relay between them, and all three are still `fixme`.
	//
	// **Until 2026-11-24 they measured the wrong thing.** The chapter never read
	// `simpleTodo.webrtcEnabled`, and in memory mode it would not have read the
	// device anyway, so `webrtc: false` changed nothing: Alice and Bob had a
	// real WebRTC connection, `setOffline` left it standing, and "offline"
	// removed the relay and kept the direct path. Every earlier conclusion drawn
	// from these tests rests on that. Now `newIdentity` starts them in
	// persistent mode and asks the app whether WebRTC is off, and
	// `expectNoDirectPath` requires every connection between the two to be a
	// limited one, a circuit through the relay.
	//
	// Measured with that in place, locally, in delegation01, invoice01 and
	// escrow01, two runs each:
	//
	//   · the revocation arrives from the relay: 6 of 6
	//   · the delegation arrives from the relay: 4 of 6. Both reds came in runs
	//     where Bob's first open by address timed out and was retried; all four
	//     greens opened at once. Why is not established. Alice leaving within
	//     the second of her write does not tell them apart: she does that in
	//     every run
	//   · a delegate's completion while the owner is away: red, 4 of 4, on the
	//     last assertion, as docs/foundations.md says (see that test)
	//
	// Instruments that gave plausible wrong answers on the way here:
	//
	//   · a reload: in memory mode this chapter keeps nothing across one, so it
	//     measures that gap instead of the relay
	//   · the peer count in the panel: it counts something other than
	//     `getConnections()` and stayed at 1 long after the last had gone
	//   · `entryCount` from `/pinning/databases`: it reported 0 for every list
	//     including one the relay had demonstrably received, because the relay
	//     falls back to `db.all()` there. `/pinning/has-entry` is the endpoint
	//     the app itself trusts
	//
	// At no point after the write are both online, so anything that arrives
	// came out of the relay and not off the other browser. That is the case
	// docs/foundations.md makes a claim about.
	test.fixme(
		'a delegation made while the delegate is offline arrives from the relay',
		async ({ browser }) => {
			test.setTimeout(timeout * 6);
			const alice = await newIdentity(browser, 'Alice', { webrtc: false });
			const bob = await newIdentity(browser, 'Bob', { webrtc: false });
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const todo = `offline-delegated-${runId}`;

			try {
				step('Alice creates the list; Bob opens it, then drops off the network');
				await createPrivateList(alice.page);
				await addTodoOk(alice.page, todo);
				const address = await getActiveDatabaseAddress(alice.page);
				await openListByAddress(bob.page, address);
				await expectTodo(bob.page, todo);
				await expectNoDirectPath(alice, bob);
				await goOffline(bob.page);

				step('Alice delegates to a Bob who cannot hear it, then goes offline herself');
				await rowFor(alice.page, todo).getByTestId('todo-delegate-open').click();
				await rowFor(alice.page, todo).getByTestId('todo-delegate-did-input').fill(bob.did);
				await rowFor(alice.page, todo).getByTestId('todo-delegate-save').click();
				await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'active',
					{ timeout }
				);
				// Nothing reached Bob directly — if it had, what arrives after Alice
				// is gone would prove nothing about the relay.
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'none');

				step('Alice leaves entirely; only the relay still holds it');
				await alice.close();

				step('Bob comes back with nobody but the relay to ask');
				await comeBackOnline(bob.page);

				// The delegation is the owner's own entry, so a relay that pins her
				// writes has it — this is the half docs/foundations.md says works.
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'delegate', { timeout });
			} finally {
				await Promise.allSettled([alice.close(), bob.close()]); // idempotent
			}
		}
	);

	test.fixme(
		'a revocation made while the delegate is offline arrives from the relay',
		async ({ browser }) => {
			test.setTimeout(timeout * 6);
			const alice = await newIdentity(browser, 'Alice', { webrtc: false });
			const bob = await newIdentity(browser, 'Bob', { webrtc: false });
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const todo = `offline-revoked-${runId}`;

			try {
				step('Alice delegates while both are present');
				await createPrivateList(alice.page);
				await addTodoOk(alice.page, todo, { delegateDid: bob.did });
				const address = await getActiveDatabaseAddress(alice.page);
				await openListByAddress(bob.page, address);
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'delegate', { timeout });
				await expectNoDirectPath(alice, bob);

				step('Bob drops off; Alice revokes and goes offline too');
				await goOffline(bob.page);
				await rowFor(alice.page, todo).getByTestId('todo-revoke-delegation').click();
				await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'revoked',
					{ timeout }
				);
				await expect(rowFor(bob.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'active'
				);

				step('Alice leaves entirely; only the relay still holds the revocation');
				await alice.close();

				step('Bob returns and must learn he no longer holds it');
				await comeBackOnline(bob.page);

				// A revocation that does not travel is the dangerous half: Bob would
				// go on believing the todo is his, and act on it.
				await expect(rowFor(bob.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'revoked',
					{ timeout }
				);
				await expect(checkbox(bob.page, todo)).toBeDisabled();
			} finally {
				await Promise.allSettled([alice.close(), bob.close()]); // idempotent
			}
		}
	);

	// While the switch went unread, this one could not even be staged: the
	// direct connection survived `setOffline`, and Alice's todo was already
	// ticked while she was supposedly offline. With WebRTC off it gets as far as
	// the last assertion and fails there, which is docs/foundations.md's claim.
	test.fixme(
		"a delegate's completion made while the owner is offline arrives from the relay",
		async ({ browser }) => {
			test.setTimeout(timeout * 6);
			const alice = await newIdentity(browser, 'Alice', { webrtc: false });
			const bob = await newIdentity(browser, 'Bob', { webrtc: false });
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const todo = `offline-completed-${runId}`;

			try {
				step('Alice delegates to Bob while both are present, then goes offline');
				await createPrivateList(alice.page);
				await addTodoOk(alice.page, todo, { delegateDid: bob.did });
				const address = await getActiveDatabaseAddress(alice.page);
				await openListByAddress(bob.page, address);
				// Opening by address leaves Bob on the lists tab; the row's role reads
				// there, but his checkbox below has to be on screen to be clicked.
				await expectTodo(bob.page, todo);
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'delegate', { timeout });
				await expectNoDirectPath(alice, bob);
				await goOffline(alice.page);

				step('Bob completes it with nobody but the relay listening');
				await checkbox(bob.page, todo).click();
				await expectDelegatedWriteSigned(bob.page, 'set-completed');
				await expect(checkbox(bob.page, todo)).toBeChecked({ timeout });
				await expect(checkbox(alice.page, todo)).not.toBeChecked();

				step('Bob leaves entirely; only the relay could still carry it');
				await bob.close();

				step('Alice returns and must find it done');
				await comeBackOnline(alice.page);

				// This is the half docs/foundations.md says does not work: the relay opens the
				// list with its built-in `orbitdb` controller, which knows nothing of
				// delegation, and refuses a delegate's entry. Asserted as the
				// behaviour we want rather than the behaviour we have — if it passes,
				// docs/foundations.md is wrong and should be corrected.
				await expect(checkbox(alice.page, todo)).toBeChecked({ timeout });
			} finally {
				await Promise.allSettled([alice.close(), bob.close()]); // idempotent
			}
		}
	);
});

// ---------------------------------------------------------------------------

/**
 * A browser context with its own virtual authenticator and a fresh passkey
 * identity, already past the consent screen.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} label
 */
async function newIdentity(browser, label, { webrtc = true } = {}) {
	const context = await browser.newContext();
	// `waitForPeers` reads the peer count from the network details, which only
	// the technical view renders.
	await pinTechnicalView(context);

	// Relay-only, for the tests that have to prove something arrived *through*
	// the relay. Measured: Playwright's `setOffline` cuts the WebSocket to the
	// relay after a few seconds but leaves an established `/webrtc/p2p/…`
	// connection to the other browser standing indefinitely — WebRTC does not
	// go through the stack it emulates. So "offline" without this switch
	// removes the relay and keeps the direct path, which is the wrong way round
	// for the question being asked.
	//
	// Seeded on the device, so the app has to start in the mode that reads the
	// device: in memory mode a setting lives in the tab, and the seeded value is
	// never seen (#9). Hence `persistent` below, as main's
	// `replication-without-webrtc.spec.js` does.
	if (!webrtc) {
		await context.addInitScript(() => {
			try {
				localStorage.setItem('simpleTodo.webrtcEnabled', 'false');
			} catch {
				// Storage blocked; `expectWebRTCOff` below says so.
			}
		});
	}
	const page = await context.newPage();
	// Browser-side failures are otherwise invisible in a CI log; a refused
	// write or a failed passkey prompt shows up here, tagged with who saw it.
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning') {
			console.log(`[${label}:${message.type()}] ${message.text()}`);
		}
	});
	page.on('pageerror', (error) => console.log(`[${label}:pageerror] ${error.message}`));
	await addVirtualAuthenticator(page);
	await openReadyAppWithNewPasskey(page, { label, persistent: webrtc ? undefined : true });
	/** @type {string | null} */
	let peerId = null;
	if (!webrtc) {
		await expectWebRTCOff(page, label);
		peerId = await page.evaluate(() => window.__simpleTodoE2E.getPeerId());
	}
	const did = await getOwnDid(page);
	step(`${label} is ${did.slice(0, 20)}…, identity block ${await identityBlock(page)}`);
	return { page, did, peerId, close: () => context.close() };
}

/**
 * The app read the switch.
 *
 * Asked of the app rather than inferred from the init script. Until the
 * chapter called `initializeWebRTCSetting`, the value was written and never
 * read; and in memory mode it is read from the tab, where the init script
 * never put it. Either way the tests below ran with WebRTC on and measured the
 * direct path under the relay's name.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function expectWebRTCOff(page, label) {
	// The E2E hook, not the public diagnostics: only the hook carries the
	// setting. It is installed when P2P start has finished, which is after the
	// todo input already takes text, so it is waited for.
	await page.waitForFunction(() => window.__simpleTodoE2E != null, null, { timeout });
	const enabled = await page.evaluate(() => window.__simpleTodoE2E.getWebRTCEnabled());
	expect(enabled, `${label} has WebRTC on: the switch was not read`).toBe(false);
}

/**
 * Nothing between the two browsers goes around the relay.
 *
 * A connection between them may exist: a circuit through the relay. It has to
 * be a limited one. An unlimited connection is direct, and whatever crosses it
 * proves nothing about the relay. Decided by `limited`, never by the address: a
 * hole-punched connection still reads `/p2p-circuit/webrtc/…` (AGENTS.md).
 *
 * @param {{ page: import('@playwright/test').Page, peerId: string | null }} a
 * @param {{ page: import('@playwright/test').Page, peerId: string | null }} b
 */
async function expectNoDirectPath(a, b) {
	for (const [from, to] of [
		[a, b],
		[b, a]
	]) {
		expect(to.peerId, 'peer id unknown, so the check would pass on nothing').toBeTruthy();
		const connections = await from.page.evaluate(
			(id) =>
				(window.__simpleTodoE2E?.getConnections?.() ?? []).filter(
					(/** @type {any} */ connection) => connection.remotePeer === id
				),
			to.peerId
		);
		step(
			`connections ${from.peerId?.slice(-6)} → ${to.peerId?.slice(-6)}: ${JSON.stringify(connections)}`
		);
		// A hook that does not report `limited` would let every connection pass.
		for (const connection of connections) {
			expect(typeof connection.limited, 'getConnections() does not report `limited`').toBe(
				'boolean'
			);
		}
		expect(
			connections.filter((/** @type {any} */ connection) => connection.limited === false),
			'a direct connection to the other browser exists, so this is not the relay-only case'
		).toEqual([]);
	}
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
			hasLargeBlob: true,
			automaticPresenceSimulation: true
		}
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ label: string, persistent?: boolean }} identity
 */
async function openReadyAppWithNewPasskey(page, { label, persistent }) {
	await page.goto(testUrl);
	await passConsent(page, { identity: 'create', label, persistent });
	await expect(todoInput(page)).toBeEnabled({ timeout });
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
	// The list's controller accepts delegation, so the form offers it.
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
 * Wait until this browser is connected to at least `count` peers (the relay
 * counts as one). Three browsers starting within seconds of each other race
 * for relay reservations, and a dial that lands before the other side has
 * one fails with NO_RESERVATION; the app retries discovered peers on a
 * timer, so the count does climb — but opening a list by address before it
 * has means fetching the manifest block from nobody.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} count
 */
async function waitForPeers(page, count) {
	// Read from the network tab without opening it: the text is there either way.
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
 * @param {number} [peers] how many peers (relay included) this browser should have first
 */
async function openListByAddress(page, address, peers = 2) {
	await waitForPeers(page, peers);
	await openSection(page, 'listen');
	await page.getByTestId('open-db-address-input').fill(address);
	const el = page.getByTestId('active-database-address');
	// Opening by address fetches the manifest block from whoever has it. With
	// three fresh browsers still finding each other, that fetch can time out
	// once ("Failed to load block for …") before the peers are connected —
	// the same retry a person would make. Not a delegation concern.
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
 * @param {{ delegateDid?: string, expiresAt?: Date }} [delegation]
 */
async function addTodoOk(page, text, delegation = {}) {
	await openSection(page, 'aufgaben');
	await todoInput(page).fill(text);
	if (delegation.delegateDid) {
		const toggle = page.getByTestId('add-todo-delegate-toggle');
		if (!(await toggle.isChecked())) await toggle.check();
		await page.getByTestId('add-todo-delegate-did').fill(delegation.delegateDid);
		if (delegation.expiresAt) {
			await page
				.getByTestId('add-todo-delegation-expiry')
				.fill(toDatetimeLocal(delegation.expiresAt));
		}
	}
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expectTodo(page, text);
}

/**
 * A denied write must raise a visible error and NOT render the todo.
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodoExpectDenied(page, text) {
	await openSection(page, 'aufgaben');
	await todoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	// In a sealed list (#127) the missing key stops the write before the
	// controller would: the message says so instead.
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
 * The passkey prompt before a delegated write: the badge goes through
 * `awaiting` and ends on `success`. The virtual authenticator answers at
 * once, so `awaiting` may already be over; `success` is the assertion.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'set-completed' | 'patch-fields'} action
 */
async function expectDelegatedWriteSigned(page, action) {
	const badge = page.getByTestId('delegated-auth-state');
	await expect(badge).toHaveAttribute('data-state', 'success', { timeout });
	await expect(badge).toHaveAttribute('data-action', action);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodo(page, text) {
	await openSection(page, 'aufgaben');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page @param {string} text */
function rowFor(page, text) {
	// Matched on the row itself, not on the text span: the span is replaced
	// by an input while the todo is being renamed, and a locator through it
	// would wait forever for the row to come back.
	return page.locator(`[data-testid="todo-item"][data-todo-text="${text}"]`);
}

/** @param {import('@playwright/test').Page} page @param {string} text */
function checkbox(page, text) {
	return rowFor(page, text).getByTestId('todo-complete-checkbox');
}

/** @param {import('@playwright/test').Page} page */
function todoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}

/** `datetime-local` wants local wall-clock time without a zone. @param {Date} date */
function toDatetimeLocal(date) {
	const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Take this browser off the network and give libp2p time to notice.
 *
 * Deliberately not asserting that every connection has gone. Measured with
 * WebRTC on: `setOffline` drops the WebSocket to the relay after a few seconds
 * and leaves an established `/webrtc/p2p/…` to the other browser standing
 * indefinitely, because WebRTC does not travel through the stack Playwright
 * emulates, so waiting for zero never returned. The tests that call this now
 * switch WebRTC off and check that nothing direct exists
 * (`expectNoDirectPath`). Whether the count then reaches zero has not been
 * measured, so it is still not waited for.
 *
 * The tests below do not need it to. They prove the direct path delivered
 * nothing by *checking* that it delivered nothing, and then close the other
 * browser outright before asking again — a context that no longer exists
 * cannot be the source of what arrives next.
 *
 * @param {import('@playwright/test').Page} page
 */
async function goOffline(page) {
	await page.context().setOffline(true);
	await page.waitForTimeout(12000);
}

/**
 * Back on the network, and connected to something again.
 *
 * Without this the two tests above cannot be read: a delegate who never
 * reconnected would receive nothing whether the relay had it or not, and the
 * absence would look like a refusal.
 *
 * @param {import('@playwright/test').Page} page
 */
async function comeBackOnline(page) {
	await page.context().setOffline(false);
	await expect
		.poll(
			() => page.evaluate(() => (window.__simpleTodoDiagnostics?.getConnections?.() ?? []).length),
			{ timeout, message: 'waiting to be connected again' }
		)
		.toBeGreaterThan(0);
}
