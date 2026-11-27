import { test, expect } from '@playwright/test';

import {
	GOSSIP_FORGETS_MS,
	addTodo,
	arrives,
	connect,
	connectionsTo,
	databasePeers,
	foreignConnections,
	getPeerId,
	isolatedContext,
	multiaddrs,
	openIsolatedApp,
	startHelper,
	timeout,
	wsPort
} from './support/isolated-browsers.mjs';

/**
 * Two browsers that meet over a circuit first, and get an unlimited connection
 * later. The heads exchange has to start on the second one.
 *
 * Sync starts the exchange when a peer subscribes to the database's topic. Over
 * a circuit relay that happens on a *limited* connection: gossipsub may use it
 * (`runOnLimitedConnection: true` in `libp2p-config.js`), so the subscription
 * arrives, but the heads protocol may not, so the exchange is refused. When an
 * unlimited connection opens afterwards, nothing in `@orbitdb/core` 4.0.0 tries
 * again - the subscription is already known, and it does not change. The
 * repo's patch (#161) starts the exchange when an unlimited connection to a
 * known subscriber opens.
 *
 * The steps:
 *
 * 1. Alice writes with only relay A to talk to, so the publish reaches no one,
 *    and waits until gossipsub has forgotten the message.
 * 2. Bob dials Alice through relay A. The circuit is limited: they see each
 *    other on the list's topic, but Bob gets nothing.
 * 3. Bob dials Alice through relay B, which sets no limits, so the new
 *    connection is unlimited (`limits == null`). Bob must now get the entry.
 *
 * **Neither relay holds a database.** `support/plain-circuit-relay.mjs` relays
 * circuits and nothing else - no OrbitDB, no pubsub - so the only way Alice's
 * entry can reach Bob is a heads exchange between the two browsers. Relay B
 * stands in for a hole-punched WebRTC connection: WebRTC is off here, and an
 * unlimited relayed connection is what Sync sees either way, because the patch
 * looks only at `connection.limits`. Each browser may reach the preview server
 * and the two relays and nothing else (`support/isolated-browsers.mjs` says
 * why that has to be an allowlist).
 */

/** How long the circuit alone gets to deliver, after the browsers see each other. */
const CIRCUIT_ONLY_MS = 10000;
/** How long Bob may take once the unlimited connection is open. */
const DELIVERY_MS = 30000;

test.describe('heads exchange after a circuit', () => {
	test('starts once an unlimited connection follows a limited one', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const relayA = await startHelper('plain-circuit-relay.mjs');
		const relayB = await startHelper('plain-circuit-relay.mjs', ['--unlimited']);
		const ports = [wsPort(relayA.multiaddr), wsPort(relayB.multiaddr)];
		const aliceContext = await isolatedContext(browser, ports);
		const bobContext = await isolatedContext(browser, ports);
		const t0 = Date.now();
		const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

		try {
			const alice = await aliceContext.newPage();
			const bob = await bobContext.newPage();
			/** What Bob's database reported, and when: how the entry reached Bob. */
			const bobLog = [];
			bob.on('console', (message) => {
				const text = message.text();
				if (/Database peer joined|Entry updated/.test(text))
					bobLog.push(`${at()} ${text.slice(0, 160)}`);
			});

			// 1. Alice writes, with a relay that holds nothing as the only peer.
			await openIsolatedApp(alice);
			const alicePeer = await getPeerId(alice);
			await reserveOn(alice, relayA);

			const todo = `after-circuit-${Date.now()}`;
			await addTodo(alice, todo);
			const [head] = await alice.evaluate(() => window.__simpleTodoE2E.getLogHeads());
			expect(head?.hash, 'no head after the write').toBeTruthy();
			console.log(`[circuit ${at()}] Alice wrote ${head.hash}`);
			await alice.waitForTimeout(GOSSIP_FORGETS_MS);

			// 2. Bob meets Alice over relay A's circuit, and nowhere else.
			await openIsolatedApp(bob);
			const bobPeer = await getPeerId(bob);
			const address = await bob.evaluate(() => window.__simpleTodoE2E.getDatabaseAddress());
			await connect(bob, `${relayA.multiaddr}/p2p-circuit/p2p/${alicePeer}`);
			await expect
				.poll(() => subscribers(bob, address), {
					timeout,
					message: 'Bob never saw Alice on the list topic over the circuit'
				})
				.toContain(alicePeer);
			console.log(`[circuit ${at()}] Bob sees Alice on the topic over the circuit`);

			await bob.waitForTimeout(CIRCUIT_ONLY_MS);
			const overCircuit = await connectionsTo(bob, alicePeer);
			console.log(`[circuit ${at()}] bob->alice: ${JSON.stringify(overCircuit)}`);
			expect(
				overCircuit.filter((connection) => !connection.limited),
				'the browsers had an unlimited connection before the test opened one'
			).toEqual([]);
			expect(
				await bob.getByText(todo, { exact: true }).count(),
				'Bob got the entry over the limited circuit, so there is no gap to measure'
			).toBe(0);
			expect(await databasePeers(bob)).not.toContain(alicePeer);

			// 3. An unlimited connection, through the relay that sets no limits.
			await reserveOn(alice, relayB);
			await connect(bob, `${relayB.multiaddr}/p2p-circuit/p2p/${alicePeer}`);
			await expect
				.poll(
					async () =>
						(await connectionsTo(bob, alicePeer)).some((connection) => !connection.limited),
					{ timeout, message: 'no unlimited connection between the browsers' }
				)
				.toBe(true);
			const openedAt = Date.now();
			console.log(`[circuit ${at()}] unlimited connection open`);

			const arrived = await arrives(bob, todo, DELIVERY_MS);
			console.log(
				`[circuit ${at()}] Bob ${arrived ? `has it after ${Date.now() - openedAt} ms` : `still does not have it after ${DELIVERY_MS} ms`}`
			);

			// What would make the run mean something else.
			const names = {
				[alicePeer]: 'alice',
				[bobPeer]: 'bob',
				[relayA.peerId]: 'relayA',
				[relayB.peerId]: 'relayB'
			};
			const name = (id) => names[id] ?? `other:${String(id).slice(-6)}`;
			const since = (ms) => `+${((ms - t0) / 1000).toFixed(1)}s`;
			const bobEvents = await bob.evaluate(() => window.__simpleTodoE2E.getConnectionEvents());
			for (const event of bobEvents) {
				console.log(
					`[circuit bob ${since(event.at)}] ${event.event} ${name(event.peer)} ${event.detail}`
				);
			}
			console.log(
				`[circuit] bob->alice at the end: ${JSON.stringify(await connectionsTo(bob, alicePeer))}`
			);
			for (const line of bobLog) console.log(`[circuit bob db] ${line}`);

			const known = new Set(Object.keys(names));
			const foreign = [
				...(await foreignConnections(alice, known)).map((e) => ({ ...e, from: 'alice' })),
				...(await foreignConnections(bob, known)).map((e) => ({ ...e, from: 'bob' }))
			];
			expect(
				foreign,
				'a peer outside the test was reached, and it could have carried the entry'
			).toEqual([]);

			expect(
				arrived,
				'the browsers never exchanged heads once an unlimited connection was open'
			).toBe(true);
		} finally {
			await aliceContext.close();
			await bobContext.close();
			await relayA.stop();
			await relayB.stop();
		}
	});
});

/**
 * Connect to a relay and wait for the reservation, so that others can dial this
 * browser through it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ peerId: string, multiaddr: string }} relay
 */
async function reserveOn(page, relay) {
	await connect(page, relay.multiaddr);
	await expect
		.poll(
			async () =>
				(await multiaddrs(page)).some((addr) => addr.includes(`/p2p/${relay.peerId}/p2p-circuit`)),
			{ timeout, message: 'no circuit reservation on the relay' }
		)
		.toBe(true);
}

/** @param {import('@playwright/test').Page} page @param {string} topic */
function subscribers(page, topic) {
	return page.evaluate(
		(name) => window.__simpleTodoE2E.getPubsubState()?.subscribers?.[name] ?? [],
		topic
	);
}
