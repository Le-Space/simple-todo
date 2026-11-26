import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

/**
 * A delegate's account reaches the payer who looks it up later (live run on
 * Sepolia, 2026-11-26).
 *
 * On Sepolia Alice could not lock a budget for Bob: "the delegate has no
 * account for budgets yet", although Bob's account was on chain and his
 * browser had published it under his DID (chain/account-directory.js). Bob
 * writes that entry once, usually long before Alice looks, so it never reaches
 * her as a live update. OrbitDB hands an existing entry over only in its
 * join-time heads exchange, and two browsers that first meet over the relay's
 * circuit never get one: the protocol is refused on a limited connection and
 * not tried again. Measured with the code before this spec: no entry in 60 s.
 * The relay sometimes held the directory and saved the run, sometimes it got
 * to the topic only after the test had ended.
 *
 * Bob's browser now answers every newcomer itself over gossipsub, which
 * crosses a circuit. That alone was not enough: OrbitDB checks the entry
 * against Bob's identity document and fetches it by bitswap, which refused a
 * limited connection until the app turned on `runOnLimitedConnections`
 * (`@helia/bitswap` 4.0.17 and later); before, the entry arrived six times and
 * was refused six times.
 *
 * Budgets run against the fake here, and the fake never opens the directory,
 * so the spec drives it through the E2E hook with the code the Sepolia service
 * uses. WebRTC is off in both browsers, so the circuit is all there is: the
 * case in which nothing else delivers the entry. Whether the entry came from
 * Bob or from the relay, which may pin the directory as it pins any topic, is
 * checked, not assumed.
 */

const timeout = 90_000;
const CHAIN_ID = 11155111;
// Bob's account in the live run; any address does, nothing here is on chain.
const ADDRESS = '0x601A3a3Dca597722DEd8973349AF84a1c727532d';
// What the Sepolia service waits for (`lookupTimeoutMs`).
const APP_LOOKUP_MS = 20_000;

test.describe('the account directory over the relay circuit alone', () => {
	test("a payer who looks later still gets the delegate's account, from the delegate", async ({
		browser
	}) => {
		test.setTimeout(timeout * 3);
		const bobContext = await browser.newContext();
		const aliceContext = await browser.newContext();
		try {
			const bob = await start(await bobContext.newPage(), 'Bob');
			await bob.page.evaluate(
				(account) => window.__simpleTodoE2E.accountDirectory.publish(account),
				{ address: ADDRESS, chainId: CHAIN_ID }
			);

			// Alice comes afterwards: the entry exists before her browser does.
			const alice = await start(await aliceContext.newPage(), 'Alice');
			await expectOnlyTheCircuit(alice, bob);

			const found = await lookup(alice, bob.did, APP_LOOKUP_MS);
			expect(found?.address, "Bob's account did not reach Alice").toBe(ADDRESS);
			await expectDeliveredBy(alice, bob);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});

	test('a payer whose browser opened the directory before the two met gets it as well', async ({
		browser
	}) => {
		test.setTimeout(timeout * 3);
		const bobContext = await browser.newContext();
		const aliceContext = await browser.newContext();
		try {
			const bob = await start(await bobContext.newPage(), 'Bob');
			await bob.page.evaluate(
				(account) => window.__simpleTodoE2E.accountDirectory.publish(account),
				{ address: ADDRESS, chainId: CHAIN_ID }
			);

			// The live run's order: Alice's first attempt opened Bob's directory
			// before her browser had found his, and every later attempt only read
			// the directory that was already open.
			const alice = await start(await aliceContext.newPage(), 'Alice');
			const early = await connectionsTo(alice, bob.peer);
			console.log(`Alice opens Bob's directory with ${early.length} connection(s) to him`);
			expect(await lookup(alice, bob.did, 0)).toBeNull();

			await expectOnlyTheCircuit(alice, bob);
			const found = await lookup(alice, bob.did, APP_LOOKUP_MS);
			expect(found?.address, "Bob's account did not reach Alice").toBe(ADDRESS);
			await expectDeliveredBy(alice, bob);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});

/**
 * A passkey session with WebRTC off, kept in the browser so the app reads the
 * switch where the init script put it (replication-without-webrtc.spec.js).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function start(page, label) {
	await addVirtualAuthenticator(page);
	await page.addInitScript(() => localStorage.setItem('simpleTodo.webrtcEnabled', 'false'));
	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { identity: 'create', label, persistent: true });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
	// Installed at the end of the P2P start, after the input takes text.
	await page.waitForFunction(() => window.__simpleTodoE2E != null, null, { timeout });
	expect(
		await page.evaluate(() => window.__simpleTodoE2E.getWebRTCEnabled()),
		`${label} has WebRTC on: the switch was not read`
	).toBe(false);
	const did = await page.getByTestId('own-did-value').getAttribute('data-did');
	expect(did).toMatch(/^did:key:/);
	const peer = await page.evaluate(() => window.__simpleTodoE2E.getPeerId());
	return { page, label, did: String(did), peer: String(peer) };
}

/**
 * The two browsers are connected, and only through the relay. Anything
 * unlimited between them and the spec would measure another path.
 *
 * @param {{ page: import('@playwright/test').Page, peer: string }} alice
 * @param {{ page: import('@playwright/test').Page, peer: string }} bob
 */
async function expectOnlyTheCircuit(alice, bob) {
	await expect.poll(() => connectionsTo(alice, bob.peer), { timeout }).not.toEqual([]);
	const both = [
		...(await connectionsTo(alice, bob.peer)),
		...(await connectionsTo(bob, alice.peer))
	];
	console.log(`Alice ↔ Bob: ${JSON.stringify(both)}`);
	expect(
		both.some((connection) => !connection.limited),
		'an unlimited connection exists, so this is not the relay-only case'
	).toBe(false);
}

/**
 * The entry was applied from a message Bob's browser published, not from the
 * relay's copy of the directory.
 *
 * @param {{ page: import('@playwright/test').Page }} alice
 * @param {{ page: import('@playwright/test').Page, did: string, peer: string }} bob
 */
async function expectDeliveredBy(alice, bob) {
	const { events } = await alice.page.evaluate(
		(did) => window.__simpleTodoE2E.accountDirectory.inspect(did),
		bob.did
	);
	for (const event of events) {
		console.log(`  ${event.event} ${event.peer?.slice(-8) ?? ''} ${event.detail ?? ''}`);
	}
	const update = events.find((/** @type {any} */ event) => event.event === 'update');
	expect(update, 'the entry was never applied').toBeTruthy();
	// Both kinds of delivery end in an `update`: a heads exchange (its `join`
	// follows it) or a message on the topic just before it.
	const message = events
		.filter((/** @type {any} */ event) => event.event === 'pubsub-message' && event.at <= update.at)
		.at(-1);
	expect(
		message?.peer,
		'the entry came from the relay, not from Bob: this run does not show his answer works'
	).toBe(bob.peer);
}

/**
 * @param {{ page: import('@playwright/test').Page }} alice
 * @param {string} did
 * @param {number} timeoutMs
 */
function lookup(alice, did, timeoutMs) {
	return alice.page.evaluate(
		({ did, chainId, timeoutMs }) =>
			window.__simpleTodoE2E.accountDirectory.lookup(did, { chainId, timeoutMs }),
		{ did, chainId: CHAIN_ID, timeoutMs }
	);
}

/**
 * @param {{ page: import('@playwright/test').Page }} from
 * @param {string} peerId
 */
function connectionsTo(from, peerId) {
	return from.page.evaluate(
		(id) =>
			window.__simpleTodoE2E
				.getConnections()
				.filter((/** @type {any} */ connection) => connection.remotePeer === id)
				.map((/** @type {any} */ connection) => ({
					limited: connection.limited === true,
					multiplexer: connection.multiplexer ?? 'none'
				})),
		peerId
	);
}
