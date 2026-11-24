/**
 * How this browser reaches the other browsers on the open list (escrow01).
 *
 * A browser can be reached in two ways only:
 * - over WebRTC, which libp2p marks unlimited;
 * - over a circuit through the relay, which libp2p marks limited.
 *
 * Every other unlimited connection ends at a server: WebSocket, WebRTC-Direct,
 * TCP. A server is a relay, and a relay is not a browser on this list, even
 * though it subscribes to the list's topic in order to pin it.
 *
 * Relayed or direct is read from `connection.limits`, never from the address
 * (AGENTS.md: "Tell relayed from direct by `connection.limits == null`"). The
 * address only tells a server from a browser. The header's old check,
 * "an address containing /webrtc", also matched the relay's WebRTC-Direct
 * address, so it could say "connected directly to another browser" with only
 * the relay on the line.
 */

/** @typedef {'direct' | 'relay' | 'server'} ConnectionPath */
/** @typedef {'direct' | 'relay' | 'alone'} ListPeerState */

/**
 * @param {any} connection a libp2p connection
 * @returns {ConnectionPath}
 */
export function connectionPath(connection) {
	if (connection?.limits != null) return 'relay';
	const address = String(connection?.remoteAddr ?? '').toLowerCase();
	const webrtcToABrowser = address.includes('/webrtc') && !address.includes('/webrtc-direct');
	return webrtcToABrowser ? 'direct' : 'server';
}

/**
 * Whether any connection is a direct one to another browser, on any list.
 *
 * @param {readonly any[]} connections
 */
export function hasDirectBrowserConnection(connections) {
	return (connections ?? []).some((connection) => connectionPath(connection) === 'direct');
}

/**
 * The other browsers on a list, and how each is reached.
 *
 * `subscribers` should hold the peers on the list's pubsub topic, together
 * with OrbitDB's `db.peers`. `db.peers` alone is not enough: OrbitDB drops a
 * peer again when the join-time heads exchange fails, and that exchange is
 * always refused over a circuit. So a browser reached only through the relay
 * would never appear in `db.peers`, while gossipsub, which may use a circuit,
 * still lists it.
 *
 * @param {{ connections?: readonly any[], subscribers?: Iterable<unknown>, selfId?: string | null }} input
 * @returns {{ state: ListPeerState, direct: number, relayed: number, peers: Array<{ peerId: string, path: 'direct' | 'relay' }> }}
 */
export function listPeerState({ connections = [], subscribers = [], selfId = null }) {
	/** @type {Map<string, Set<ConnectionPath>>} */
	const pathsByPeer = new Map();
	for (const connection of connections ?? []) {
		const peerId = connection?.remotePeer?.toString();
		if (!peerId) continue;
		const paths = pathsByPeer.get(peerId) ?? new Set();
		paths.add(connectionPath(connection));
		pathsByPeer.set(peerId, paths);
	}

	/** @type {Array<{ peerId: string, path: 'direct' | 'relay' }>} */
	const peers = [];
	for (const peerId of new Set(Array.from(subscribers ?? [], String))) {
		if (!peerId || peerId === selfId) continue;
		const paths = pathsByPeer.get(peerId);
		// A peer reached over WebSocket or WebRTC-Direct is a server: the relay
		// pinning this list, not somebody working in it.
		if (paths?.has('server')) continue;
		// Without any connection right now, what this browser gets from that
		// peer can only come through the relay.
		peers.push({ peerId, path: paths?.has('direct') ? 'direct' : 'relay' });
	}

	const direct = peers.filter((peer) => peer.path === 'direct').length;
	const relayed = peers.length - direct;
	/** @type {ListPeerState} */
	const state = direct > 0 ? 'direct' : relayed > 0 ? 'relay' : 'alone';
	return { state, direct, relayed, peers };
}
