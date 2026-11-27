import { test, expect } from '@playwright/test';

import {
	GOSSIP_FORGETS_MS,
	addTodo,
	arrives,
	connect,
	connectionCount,
	connectionsTo,
	databaseAddress,
	databasePeers,
	foreignConnections,
	getPeerId,
	isolatedContext,
	openIsolatedApp,
	startHelper,
	timeout,
	wsPort
} from './support/isolated-browsers.mjs';

/**
 * An entry a peer learnt through the heads exchange, and a reader that was
 * already there (orbitdb/orbitdb#1255).
 *
 * Three peers in a star: Alice and Bob are browsers, and between them is a
 * plain `@orbitdb/core` peer (`support/plain-orbitdb-peer.mjs`) that both reach
 * over a WebSocket. The steps, in order:
 *
 * 1. Bob joins and exchanges heads with the peer, which has nothing yet.
 * 2. Alice writes while connected to nobody, so the publish reaches no one, and
 *    then waits until gossipsub has forgotten the message.
 * 3. Alice connects to the peer. The peer learns Alice's entry through the heads
 *    exchange - the only way left - and Bob, who exchanged with the peer while
 *    it was empty, has to hear of it from the peer.
 *
 * In `@orbitdb/core` 4.0.0 Bob never does. Heads learnt by exchange are not
 * published on the topic, and the exchange runs once per peer, so nothing tells
 * Bob. The repo's patch (#141) publishes them.
 *
 * **Why not the suite's relay.** The suite starts `orbitdb-relay`, which pins
 * every database and wraps core `Sync` in its own replication logic - it
 * republishes heads to subscribers, among other things. With it in the middle
 * this measures the relay, not OrbitDB. The peer in the middle runs whatever
 * `@orbitdb/core` the browsers run, patched or not, and each browser may reach
 * the preview server and that peer and nothing else
 * (`support/isolated-browsers.mjs` says why that has to be an allowlist).
 *
 * WebRTC is off, so if the browsers meet each other at all it is over a circuit
 * through the peer - a limited connection, on which the heads protocol is
 * refused. The peer is the only route the entry has.
 */

/** How long Bob may take once the peer holds the entry. */
const DELIVERY_MS = 30000;

test.describe('heads learnt by exchange', () => {
	test('reach a reader through a plain OrbitDB peer', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const peer = await startHelper('plain-orbitdb-peer.mjs');
		const aliceContext = await isolatedContext(browser, [wsPort(peer.multiaddr)]);
		const bobContext = await isolatedContext(browser, [wsPort(peer.multiaddr)]);
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

			// 1. Bob, and an exchange with a peer that holds nothing.
			await openIsolatedApp(bob);
			const bobPeer = await getPeerId(bob);
			expect(await databaseAddress(bob), 'the peer opened another list').toBe(peer.address);

			await connect(bob, peer.multiaddr);
			await expect
				.poll(
					async () =>
						(await peerState(peer)).databasePeers.includes(bobPeer) &&
						(await databasePeers(bob)).includes(peer.peerId),
					{ timeout, message: 'Bob and the peer never exchanged heads' }
				)
				.toBe(true);
			expect((await peerState(peer)).entries).toEqual([]);
			console.log(`[star ${at()}] Bob exchanged heads with the empty peer`);

			// 2. Alice writes to nobody.
			await openIsolatedApp(alice);
			const alicePeer = await getPeerId(alice);
			expect(await connectionCount(alice), 'Alice is not isolated').toBe(0);

			const todo = `learnt-by-exchange-${Date.now()}`;
			await addTodo(alice, todo);
			const [head] = await alice.evaluate(() => window.__simpleTodoE2E.getLogHeads());
			expect(head?.hash, 'no head after the write').toBeTruthy();
			console.log(`[star ${at()}] Alice wrote ${head.hash} with no peers`);

			await alice.waitForTimeout(GOSSIP_FORGETS_MS);
			expect(await connectionCount(alice), 'Alice met someone while writing').toBe(0);

			// 3. Alice meets the peer; the exchange is the only way Alice's entry can travel.
			await connect(alice, peer.multiaddr);
			await expect
				.poll(async () => (await peerState(peer)).entries.includes(head.hash), {
					timeout,
					message: 'the peer never received the entry through the exchange'
				})
				.toBe(true);
			const learntAt = Date.now();
			console.log(`[star ${at()}] the peer holds the entry`);

			const arrived = await arrives(bob, todo, DELIVERY_MS);
			console.log(
				`[star ${at()}] Bob ${arrived ? `has it after ${Date.now() - learntAt} ms` : `still does not have it after ${DELIVERY_MS} ms`}`
			);

			// What would make the run mean something else.
			const bobEvents = await bob.evaluate(() => window.__simpleTodoE2E.getConnectionEvents());
			const between = [
				...(await connectionsTo(alice, bobPeer)),
				...(await connectionsTo(bob, alicePeer))
			];
			const state = await peerState(peer);
			console.log(
				`[star] peer: ${JSON.stringify({ databasePeers: state.databasePeers, entries: state.entries.length, errors: state.errors.map((e) => e.message) })}`
			);
			console.log(`[star] alice<->bob: ${JSON.stringify(between)}`);

			// The timeline, with names rather than peer ids.
			const names = { [alicePeer]: 'alice', [bobPeer]: 'bob', [peer.peerId]: 'peer' };
			const name = (id) => names[id] ?? `other:${String(id).slice(-6)}`;
			const since = (ms) => `+${((ms - t0) / 1000).toFixed(1)}s`;
			for (const event of state.events) {
				const { at: when, event: kind, peer: who, ...rest } = event;
				console.log(`[star peer ${since(when)}] ${kind} ${name(who)} ${JSON.stringify(rest)}`);
			}
			for (const entry of state.entryDetails) {
				console.log(
					`[star entry] ${entry.hash} ${entry.op} ${entry.key} clock=${entry.clock?.id?.slice?.(-8)}:${entry.clock?.time} next=${entry.next.length}`
				);
			}
			for (const event of bobEvents) {
				console.log(
					`[star bob ${since(event.at)}] ${event.event} ${name(event.peer)} ${event.detail}`
				);
			}
			for (const line of bobLog) console.log(`[star bob db] ${line}`);

			// Any other peer could have carried the entry - the public relays hold
			// the same list.
			const known = new Set([alicePeer, bobPeer, peer.peerId]);
			const foreign = [
				...(await foreignConnections(alice, known)).map((e) => ({ ...e, from: 'alice' })),
				...(await foreignConnections(bob, known)).map((e) => ({ ...e, from: 'bob' })),
				...state.events
					.filter((e) => e.event === 'connection:open' && !known.has(e.peer))
					.map((e) => ({ ...e, from: 'peer' }))
			];
			expect(
				foreign,
				'a peer outside the test was reached, and it could have carried the entry'
			).toEqual([]);

			// A dropped and reopened connection between Bob and the peer starts
			// the exchange again, which would deliver the entry without the fix.
			expect(
				bobEvents.filter((event) => event.event === 'close' && event.peer === peer.peerId),
				"Bob's connection to the peer closed during the run, so a fresh exchange could have carried the entry"
			).toEqual([]);
			// An unlimited connection between the browsers would let them exchange
			// heads directly, which is another gap than this one.
			expect(
				between.filter((connection) => !connection.limited),
				'the browsers reached each other directly'
			).toEqual([]);

			expect(arrived, 'the reader never got the entry the peer learnt through the exchange').toBe(
				true
			);
		} finally {
			await aliceContext.close();
			await bobContext.close();
			await peer.stop();
		}
	});
});

/** @param {{ http: string }} peer */
async function peerState(peer) {
	const response = await fetch(`${peer.http}/state`);
	return response.json();
}
