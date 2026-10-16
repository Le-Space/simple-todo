import { describe, expect, it } from 'vitest';
import { scopeRelayBootstrapPosts } from './aleph-bootstrap-discovery.js';

// 2026-10-16, 18:27 UTC: a stray relay registered under the production id
// six minutes before every chapter's deploy ran. Newest per id, it was the
// only candidate; it did not answer; ten publishes failed while the healthy
// production relay sat one post below it.
const PROD_ID = 'relay:orbitdb-relay:orbitdb-relay';
const now = Date.parse('2026-10-16T18:40:00Z');
const post = (peer, at, extra = {}) => ({
	time: Date.parse(at) / 1000,
	address: `0x${peer}`,
	content: {
		profile: 'orbitdb-relay',
		registrationId: PROD_ID,
		peerId: `12D3KooW${peer}`,
		updatedAt: Date.parse(at),
		multiaddrs: [`/dns4/${peer}.example/tcp/443/tls/ws/p2p/12D3KooW${peer}`],
		...extra
	}
});

describe('scopeRelayBootstrapPosts', () => {
	it('keeps every current relay under the id, newest first, not only the newest post', () => {
		const stray = post('stray', '2026-10-16T18:27:00Z');
		const production = post('prod', '2026-10-16T16:35:00Z');
		const older = post('prod', '2026-10-16T10:31:00Z');
		const out = scopeRelayBootstrapPosts([older, production, stray], { now });
		expect(out.map((p) => p.content.peerId)).toEqual(['12D3KooWstray', '12D3KooWprod']);
	});

	it('drops what is older than the age limit, of another profile, or under another id', () => {
		const stale = post('old', '2026-10-15T20:00:00Z');
		const uc = post('uc', '2026-10-16T14:27:00Z', { profile: 'uc-go-peer' });
		const e2e = post('e2e', '2026-10-16T18:33:00Z', { registrationId: `${PROD_ID}:4f730b50` });
		const production = post('prod', '2026-10-16T16:35:00Z');
		const out = scopeRelayBootstrapPosts([stale, uc, e2e, production], { now });
		expect(out.map((p) => p.content.peerId)).toEqual(['12D3KooWprod']);
	});

	it('without an id takes every current relay of the profile', () => {
		const a = post('a', '2026-10-16T18:00:00Z', {
			registrationId: 'relay:orbitdb-relay:simple-todo-e2e-1'
		});
		const b = post('b', '2026-10-16T17:00:00Z');
		const out = scopeRelayBootstrapPosts([a, b], { now, registrationId: null });
		expect(out).toHaveLength(2);
	});
});
