/**
 * A circuit relay and nothing else: no OrbitDB, no pubsub, no peer discovery.
 *
 * Everything two browsers exchange through it travels over the circuit
 * between them; the relay itself holds no entry and routes no message. That is
 * the point of it - `orbitdb-relay` pins every database and would hand a reader
 * the entry on its own.
 *
 * By default it limits each circuit, as `@libp2p/circuit-relay-v2` does, so a
 * connection through it is *limited* (`connection.limits != null`) and the
 * heads protocol is refused on it. The limits are generous so that a circuit
 * does not close during a test. With `--unlimited` it sends no limit at all
 * (`applyDefaultLimit: false`), and a connection through it is unlimited -
 * `limits == null`, the one thing Sync's patch looks at - though the relay
 * still carries every byte. That gives a spec an unlimited connection between
 * two browsers without WebRTC.
 *
 * Started by a spec, not by the suite. It binds 127.0.0.1 on a port the system
 * picks and prints one `READY {json}` line.
 */
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify, identifyPush } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { webSockets } from '@libp2p/websockets';
import { createLibp2p } from 'libp2p';

const unlimited = process.argv.includes('--unlimited');

const node = await createLibp2p({
	addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] },
	transports: [webSockets()],
	connectionEncrypters: [noise()],
	streamMuxers: [yamux()],
	services: {
		identify: identify({ maxMessageSize: 65_536 }),
		identifyPush: identifyPush({ maxMessageSize: 65_536 }),
		ping: ping(),
		relay: circuitRelayServer({
			reservations: unlimited
				? { maxReservations: 100, applyDefaultLimit: false }
				: {
						maxReservations: 100,
						defaultDataLimit: BigInt(1024 * 1024 * 1024),
						defaultDurationLimit: 20 * 60 * 1000
					}
		})
	}
});

const multiaddr = node
	.getMultiaddrs()
	.map(String)
	.find((addr) => addr.includes('/ws/'));
console.log(`READY ${JSON.stringify({ peerId: node.peerId.toString(), multiaddr, unlimited })}`);

let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await node.stop().catch(() => {});
	process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
