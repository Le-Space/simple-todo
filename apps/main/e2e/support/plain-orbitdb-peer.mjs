/**
 * A third OrbitDB peer for the e2e suite, built from `@orbitdb/core` alone.
 *
 * It sits between two browsers the way a relay does - they reach it over a
 * WebSocket, and it relays circuits and routes gossipsub between them - but it
 * is not `orbitdb-relay`. That package wraps the same core in its own
 * replication logic (it republishes heads to subscribers, fetches manifests on
 * first sight, answers heads streams on demand), and any of those can hide a
 * gap in core `Sync`. This peer does nothing core does not do: it opens one
 * database and lets `Sync` run.
 *
 * It resolves `@orbitdb/core` from this app, so it runs whatever version the
 * browsers run, patched or not.
 *
 * Started by a spec, not by the suite. It binds 127.0.0.1 on ports the system
 * picks, prints one `READY {json}` line, and answers `GET /state` with what it
 * holds.
 */
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { gossipsub } from '@libp2p/gossipsub';
import { identify, identifyPush } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { webSockets } from '@libp2p/websockets';
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core';
import { createHeliaLight } from 'helia';
import { createLibp2p } from 'libp2p';
import * as json from 'multiformats/codecs/json';
import { sha512 } from 'multiformats/hashes/sha2';

const DATABASE_NAME = process.env.PEER_DATABASE_NAME || 'simple-todos';
const TOPICS = (process.env.PEER_PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub')
	.split(',')
	.map((topic) => topic.trim())
	.filter(Boolean);

const directory = await mkdtemp(join(tmpdir(), 'plain-orbitdb-peer-'));

const libp2p = await createLibp2p({
	addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] },
	transports: [webSockets()],
	connectionEncrypters: [noise()],
	streamMuxers: [yamux()],
	// The browsers find each other through this, as they do through the relay.
	peerDiscovery: [pubsubPeerDiscovery({ interval: 5000, topics: TOPICS, listenOnly: false })],
	services: {
		identify: identify({ maxMessageSize: 65_536 }),
		identifyPush: identifyPush({ maxMessageSize: 65_536 }),
		ping: ping(),
		// Limits stay on, so a circuit between the browsers is a limited
		// connection - the case a relayed connection is in the field. They are
		// generous so that it does not close during a test.
		relay: circuitRelayServer({
			reservations: {
				maxReservations: 100,
				defaultDataLimit: BigInt(1024 * 1024 * 1024),
				defaultDurationLimit: 20 * 60 * 1000
			}
		}),
		pubsub: gossipsub({
			allowPublishToZeroTopicPeers: true,
			// Every browser arrives from 127.0.0.1; without this, gossipsub's
			// colocation penalty starts dropping them from the mesh.
			scoreParams: { IPColocationFactorWeight: 0, behaviourPenaltyWeight: 0 }
		})
	}
});

const helia = await withBitswap(
	withLibp2p(createHeliaLight({ codecs: [dagCbor, dagJson, json], hashers: [sha512] }), libp2p)
).start();

const orbitdb = await createOrbitDB({ ipfs: helia, id: 'plain-orbitdb-peer', directory });

// The same name, type and access controller as the app's default list, so the
// manifest - and with it the address - comes out the same. Opened here, before
// any browser arrives, rather than on first sight: discovering databases is
// relay logic, and this peer has none.
const db = await orbitdb.open(DATABASE_NAME, {
	type: 'keyvalue',
	create: true,
	sync: true,
	AccessController: IPFSAccessController({ write: ['*'] })
});
const address = db.address.toString();

// Errors from Sync are what a failed heads exchange looks like; keep them, and
// do not let them crash the peer.
const errors = [];
db.events.on('error', (error) => {
	errors.push({
		at: Date.now(),
		name: error?.name ?? null,
		message: String(error?.message ?? error)
	});
});

// A timeline of what the peer saw, so that a run can say how an entry reached
// a reader rather than only that it did.
const events = [];
const note = (event, detail) => events.push({ at: Date.now(), event, ...detail });
libp2p.addEventListener('connection:open', ({ detail }) =>
	note('connection:open', {
		peer: detail.remotePeer.toString(),
		limited: detail.limits != null,
		remoteAddr: detail.remoteAddr.toString()
	})
);
libp2p.addEventListener('connection:close', ({ detail }) =>
	note('connection:close', { peer: detail.remotePeer.toString(), limited: detail.limits != null })
);
libp2p.services.pubsub.addEventListener('subscription-change', ({ detail }) => {
	const subscription = detail.subscriptions.find((s) => s.topic === address);
	if (subscription) {
		note('subscription-change', {
			peer: detail.peerId.toString(),
			subscribe: subscription.subscribe
		});
	}
});
db.events.on('join', (peerId, heads) =>
	note('join', { peer: String(peerId), heads: (heads ?? []).map((h) => h.hash) })
);
db.events.on('update', (entry) => note('update', { hash: entry?.hash ?? null }));

const multiaddr = libp2p
	.getMultiaddrs()
	.map(String)
	.find((addr) => addr.includes('/ws/'));

async function state() {
	const entries = [];
	const entryDetails = [];
	for await (const entry of db.log.iterator()) {
		entries.push(entry.hash);
		entryDetails.push({
			hash: entry.hash,
			op: entry.payload?.op ?? null,
			key: entry.payload?.key ?? null,
			identity: entry.identity ?? null,
			clock: entry.clock ? { id: entry.clock.id, time: entry.clock.time } : null,
			next: entry.next ?? [],
			refs: entry.refs ?? []
		});
	}

	return {
		peerId: libp2p.peerId.toString(),
		address,
		databasePeers: Array.from(db.peers ?? [], String),
		subscribers: libp2p.services.pubsub.getSubscribers(address).map(String),
		entries,
		entryDetails,
		connections: libp2p.getConnections().map((connection) => ({
			remotePeer: connection.remotePeer.toString(),
			limited: connection.limits != null,
			remoteAddr: connection.remoteAddr.toString()
		})),
		events,
		errors
	};
}

const server = http.createServer((request, response) => {
	if (request.method === 'GET' && request.url === '/state') {
		state().then(
			(body) => {
				response.writeHead(200, { 'content-type': 'application/json' });
				response.end(JSON.stringify(body));
			},
			(error) => {
				response.writeHead(500, { 'content-type': 'application/json' });
				response.end(JSON.stringify({ error: String(error?.message ?? error) }));
			}
		);
		return;
	}
	response.writeHead(404);
	response.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
console.log(
	`READY ${JSON.stringify({ peerId: libp2p.peerId.toString(), multiaddr, address, http: `http://127.0.0.1:${port}` })}`
);

let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	server.close();
	await db.close().catch(() => {});
	await orbitdb.stop().catch(() => {});
	await helia.stop().catch(() => {});
	await rm(directory, { recursive: true, force: true });
	process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
