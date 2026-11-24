import { test, expect } from '@playwright/test';

import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { generateSpanishMnemonic } from '@simple-todo/todo/spanish-mnemonic.js';
import { openSection } from './sections.mjs';

/**
 * What replicates when the relay is the whole of the path.
 *
 * Ported from main's spec of the same name and adapted to this chapter: the
 * list is a shared one chosen by its three words, and the todos live behind a
 * tab.
 *
 * `default-database-collaboration.spec.js` waits for the connection between
 * Alice and Bob to become direct WebRTC before it checks anything: it measures
 * the case where the upgrade succeeds. This one measures the other: two
 * browsers whose upgrade never happens (carrier NAT, or a VPN that blocks it,
 * as on the machine this was written on), so the circuit through the relay is
 * all there is.
 *
 * - OrbitDB's **live updates** go over gossipsub, and the app sets
 *   `runOnLimitedConnection: true` there, so a new todo should cross
 * - OrbitDB's **heads sync** and **bitswap** do not set it, so neither crosses
 *   a circuit (AGENTS.md)
 *
 * WebRTC is switched off through the app's own setting rather than by breaking
 * the network, so this is a configuration the app already supports.
 */

const testUrl = '/';
const timeout = 90000;

test.describe('replication when only the relay carries it', () => {
	test('MEASUREMENT: what crosses a circuit between two browsers', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		// A list of its own per run: a fixed one would carry earlier runs'
		// entries, and the relay would already hold the list before Alice writes.
		const mnemonic = generateSpanishMnemonic();
		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();

		try {
			const alice = await aliceContext.newPage();
			const bob = await bobContext.newPage();

			await Promise.all([
				openWithoutWebRTC(alice, { mnemonic, label: 'Alice' }),
				openWithoutWebRTC(bob, { mnemonic, label: 'Bob' })
			]);

			const [alicePeer, bobPeer] = await Promise.all([getPeerId(alice), getPeerId(bob)]);

			// Waited for rather than read straight away: an immediate look finds two
			// empty lists, and whatever happened next would be reported as having
			// crossed a circuit.
			await expect.poll(() => connectionTo(alice, bobPeer), { timeout }).not.toEqual([]);

			const carried = await Promise.all([
				connectionTo(alice, bobPeer),
				connectionTo(bob, alicePeer)
			]);
			console.log('CONNECTIONS alice→bob:', JSON.stringify(carried[0]));
			console.log('CONNECTIONS bob→alice:', JSON.stringify(carried[1]));

			// Nothing here is direct, or the spec is measuring the wrong thing.
			expect(
				carried.flat().some((c) => c.webrtc || c.limited === false),
				'an unlimited connection exists, so this is not the relay-only case'
			).toBe(false);

			const todo = `only-over-the-circuit-${Date.now()}`;
			await addTodo(alice, todo);

			await openSection(bob, 'aufgaben');
			const arrived = await bob
				.getByText(todo, { exact: true })
				.waitFor({ state: 'visible', timeout })
				.then(
					() => true,
					() => false
				);

			// **Whether the relay was a participant, not merely a route.**
			//
			// `orbitdb-relay` runs OrbitDB and pins what it sees, and it offers no
			// switch to stop. So rather than removing it, this asks what it did:
			// a todo the relay pinned may have reached Bob *from the relay*, over
			// his own unlimited WebSocket to it, without ever crossing a circuit.
			// Without this the measurement above cannot tell the two apart.
			const pinned = await alice
				.getByTestId('todo-item')
				.filter({ has: alice.getByText(todo, { exact: true }) })
				.getByTestId('todo-relay-status')
				.getAttribute('data-status')
				.catch(() => null);

			console.log(`LIVE UPDATE over a circuit: ${arrived ? 'arrived' : 'did not arrive'}`);
			console.log(`RELAY participation: ${pinned}`);

			expect(arrived, 'a todo created with no direct path did not reach the other browser').toBe(
				true
			);

			// Not yet pinned when it arrived, so it came over the circuit rather
			// than from the relay. The relay pinning it a moment later is expected
			// and fine; what would spoil the measurement is it having pinned
			// first, because then Bob could have had it from his own unlimited
			// WebSocket to the relay instead.
			expect(pinned, 'the relay had already pinned it, so the path is ambiguous').not.toBe(
				'pinned'
			);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ mnemonic: string, label: string }} options
 */
async function openWithoutWebRTC(page, { mnemonic, label }) {
	// Set before the app loads: `initializeWebRTCSetting` reads this key on
	// startup, and the transport list is built from it once.
	await page.addInitScript(() => {
		localStorage.setItem('simpleTodo.webrtcEnabled', 'false');
	});

	await page.goto(testUrl);

	// Kept in the browser, so the app reads the device where the init script put
	// the switch: in memory mode a setting lives in the tab, and the seeded value
	// is never seen (#9). The relay is on by default in this chapter.
	await passConsent(page, { mnemonic, persistent: true });

	await expect(getTodoInput(page)).toBeEnabled({ timeout });
	await expectWebRTCOff(page, label);
}

/**
 * The app read the switch. Asked of the app rather than inferred from the init
 * script: a switch written where the app does not look leaves WebRTC on, and
 * the spec would measure the direct path under the relay's name.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function expectWebRTCOff(page, label) {
	// The hook is installed when P2P start has finished, after the todo input
	// already takes text.
	await page.waitForFunction(() => window.__simpleTodoE2E != null, null, { timeout });
	const enabled = await page.evaluate(() => window.__simpleTodoE2E.getWebRTCEnabled());
	expect(enabled, `${label} has WebRTC on: the switch was not read`).toBe(false);
}

/** @param {import('@playwright/test').Page} page */
async function getPeerId(page) {
	await expect
		.poll(() => page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null), { timeout })
		.toBeTruthy();

	return page.evaluate(() => window.__simpleTodoE2E.getPeerId());
}

/**
 * Every connection this page holds to one particular peer.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} peerId
 */
async function connectionTo(page, peerId) {
	return page.evaluate(
		(id) =>
			(window.__simpleTodoE2E?.getConnections?.() ?? [])
				.filter((/** @type {any} */ connection) => connection.remotePeer === id)
				.map((/** @type {any} */ connection) => ({
					address: String(connection.remoteAddr ?? ''),
					// `limits` is what separates a relayed connection from a direct
					// one. The address does not: a hole-punched connection still
					// reads `/p2p-circuit/webrtc/…`.
					limited: connection.limited === true,
					encryption: connection.encryption ?? 'none',
					multiplexer: connection.multiplexer ?? 'none',
					webrtc: String(connection.remoteAddr ?? '').includes('/webrtc')
				})),
		peerId
	);
}

/** @param {import('@playwright/test').Page} page */
const getTodoInput = (page) => page.getByPlaceholder('What needs to be done?');

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	await openSection(page, 'aufgaben');
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}
