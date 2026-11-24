import { describe, it, expect } from 'vitest';
import { connectionPath, hasDirectBrowserConnection, listPeerState } from './list-peers.js';

const RELAY = '12D3KooWRelay';
const ALICE = '12D3KooWAlice';
const BOB = '12D3KooWBob';
const CAROL = '12D3KooWCarol';

/**
 * A connection as libp2p reports it: a circuit is limited, everything else is not.
 *
 * @param {string} peer
 * @param {string} address
 * @param {boolean} [limited]
 */
function connection(peer, address, limited = false) {
	return {
		remotePeer: { toString: () => peer },
		remoteAddr: { toString: () => address },
		limits: limited ? { bytes: 131072n, seconds: 120 } : undefined
	};
}

const relayOverWebSocket = connection(RELAY, `/dns4/relay.example/tcp/443/tls/ws/p2p/${RELAY}`);
const relayOverWebRTCDirect = connection(
	RELAY,
	`/ip4/203.0.113.7/udp/4906/webrtc-direct/certhash/uEiAbc/p2p/${RELAY}`
);
const bobOverCircuit = connection(
	BOB,
	`/dns4/relay.example/tcp/443/tls/ws/p2p/${RELAY}/p2p-circuit/p2p/${BOB}`,
	true
);
// The side that dialled sees the route it signalled over; it is WebRTC all the same.
const bobOverWebRTCOutbound = connection(
	BOB,
	`/dns4/relay.example/tcp/443/tls/ws/p2p/${RELAY}/p2p-circuit/webrtc/p2p/${BOB}`
);
const bobOverWebRTCInbound = connection(BOB, `/webrtc/p2p/${BOB}`);

describe('connectionPath', () => {
	it('reads relayed from the limits, whatever the address says', () => {
		expect(connectionPath(bobOverCircuit)).toBe('relay');
		expect(
			connectionPath(connection(BOB, `/p2p/${RELAY}/p2p-circuit/webrtc/p2p/${BOB}`, true))
		).toBe('relay');
	});

	it('calls an unlimited WebRTC connection direct, from either end', () => {
		expect(connectionPath(bobOverWebRTCOutbound)).toBe('direct');
		expect(connectionPath(bobOverWebRTCInbound)).toBe('direct');
	});

	it('calls WebSocket and WebRTC-Direct a server, not a browser', () => {
		expect(connectionPath(relayOverWebSocket)).toBe('server');
		expect(connectionPath(relayOverWebRTCDirect)).toBe('server');
	});
});

describe('hasDirectBrowserConnection', () => {
	it('is not fooled by the relay reached over WebRTC-Direct', () => {
		// The header's old check ("an address with /webrtc") said "connected
		// directly to another browser" here.
		expect(hasDirectBrowserConnection([relayOverWebSocket, relayOverWebRTCDirect])).toBe(false);
	});

	it('sees a WebRTC connection to a browser', () => {
		expect(hasDirectBrowserConnection([relayOverWebSocket, bobOverWebRTCInbound])).toBe(true);
	});
});

describe('listPeerState', () => {
	it('is alone with only the relay on the list', () => {
		expect(
			listPeerState({ connections: [relayOverWebSocket], subscribers: [RELAY], selfId: ALICE })
		).toEqual({ state: 'alone', direct: 0, relayed: 0, peers: [] });
	});

	it('leaves out this browser itself', () => {
		expect(listPeerState({ connections: [], subscribers: [ALICE], selfId: ALICE }).state).toBe(
			'alone'
		);
	});

	it('is relay when the other browser is reached through a circuit only', () => {
		const result = listPeerState({
			connections: [relayOverWebSocket, bobOverCircuit],
			subscribers: [RELAY, BOB],
			selfId: ALICE
		});
		expect(result).toEqual({
			state: 'relay',
			direct: 0,
			relayed: 1,
			peers: [{ peerId: BOB, path: 'relay' }]
		});
	});

	it('is direct once WebRTC stands beside the circuit', () => {
		const result = listPeerState({
			connections: [relayOverWebSocket, bobOverCircuit, bobOverWebRTCOutbound],
			subscribers: [RELAY, BOB],
			selfId: ALICE
		});
		expect(result.state).toBe('direct');
		expect(result.direct).toBe(1);
		expect(result.relayed).toBe(0);
	});

	it('counts each browser once, from the topic and from db.peers alike', () => {
		const result = listPeerState({
			connections: [relayOverWebSocket, bobOverWebRTCInbound],
			subscribers: [RELAY, BOB, BOB],
			selfId: ALICE
		});
		expect(result.peers).toEqual([{ peerId: BOB, path: 'direct' }]);
	});

	it('counts direct and relayed browsers apart', () => {
		const carolOverCircuit = connection(CAROL, `/p2p/${RELAY}/p2p-circuit/p2p/${CAROL}`, true);
		const result = listPeerState({
			connections: [relayOverWebSocket, bobOverWebRTCInbound, carolOverCircuit],
			subscribers: [RELAY, BOB, CAROL],
			selfId: ALICE
		});
		expect(result).toMatchObject({ state: 'direct', direct: 1, relayed: 1 });
	});

	it('takes a subscriber without a connection as reachable through the relay only', () => {
		expect(listPeerState({ connections: [], subscribers: [BOB], selfId: ALICE })).toMatchObject({
			state: 'relay',
			relayed: 1
		});
	});

	it('is alone without a node or a list', () => {
		expect(listPeerState({}).state).toBe('alone');
	});
});
