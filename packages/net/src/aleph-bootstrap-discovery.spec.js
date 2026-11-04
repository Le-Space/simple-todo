import { describe, expect, it, vi } from 'vitest';
import {
	TRUSTED_RELAY_OWNERS,
	discoverScopedBootstrapMultiaddrs,
	instanceOf,
	ownedInstance,
	scopeRelayBootstrapPosts,
	twoN6Host
} from './aleph-bootstrap-discovery.js';

// Modelled on the channel as it stood on 2026-11-04: relay-main-ekb, deployed
// with relay-button from Le Space's account, and around it the posts that must
// not count — the retired relay under the old fixed id (no owner), a smoke
// relay (no owner), and whatever a stranger can post.
const RELAY_BUTTON = TRUSTED_RELAY_OWNERS[0];
const STRANGER = '0x000000000000000000000000000000000000dEaD';
const EKB = '32d4d7b21e5b245d2a0a2e996845c1568397af7454401746997bda74414045ba';
const EKB_HOST = 'crazy-pluck-uncle-device.2n6.me';
const EKB_PEER = '12D3KooWQu5E1ZkGC5x2dSVTEWxYvsssWjXgk2Mzc8GZHN26cYzS';
const SMOKE = 'aa93f15e0da1473433fedd14bc6f4ba4f337e37cedac867616f0ebaeadd533a1';
const now = Date.parse('2026-11-04T09:00:00Z');

/** A relay-bootstrap-v2 post as `fetchAlephBootstrapPosts` returns it. */
const post = ({ peer, at, registrationId, owner, multiaddrs, profile = 'orbitdb-relay' }) => ({
	address: '0x0ed61FbB00000000000000000000000000000000',
	time: Date.parse(at) / 1000,
	content: {
		profile,
		registrationId,
		peerId: peer,
		updatedAt: Date.parse(at),
		...(owner ? { ownerAddress: owner } : {}),
		multiaddrs
	}
});
const wss = (host, peer) => [
	`/dns4/${host}/tcp/443/tls/ws/p2p/${peer}`,
	`/dns6/${host}/tcp/443/tls/ws/p2p/${peer}`
];
const ekb = (at = '2026-11-04T04:17:00Z', extra = {}) =>
	post({
		peer: EKB_PEER,
		at,
		registrationId: `relay:orbitdb-relay:relay-main-ekb:${EKB}`,
		owner: RELAY_BUTTON,
		multiaddrs: [...wss(EKB_HOST, EKB_PEER), `/ip4/45.144.209.26/tcp/25861/ws/p2p/${EKB_PEER}`],
		...extra
	});
const retired = post({
	peer: '12D3KooWQt2YjDez',
	at: '2026-11-04T04:59:00Z',
	registrationId: 'relay:orbitdb-relay:orbitdb-relay',
	multiaddrs: wss('secret-pass-wife-sentence.2n6.me', '12D3KooWQt2YjDez')
});

/** What Aleph answers for `GET /api/v0/messages/<hash>`. */
const instanceMessage = (hash, address, { status = 'processed', type = 'INSTANCE' } = {}) => ({
	status,
	item_hash: hash,
	message: { type, item_hash: hash, sender: address, content: { address } }
});
/** @param {Record<string, any>} messages by hash; anything else 404 */
const alephMessages = (messages) =>
	vi.fn(async (/** @type {string} */ url) => {
		const hash = url.split('/').pop() ?? '';
		return hash in messages
			? new Response(JSON.stringify(messages[hash]), { status: 200 })
			: new Response('{"message":"not found"}', { status: 404 });
	});

describe('twoN6Host and instanceOf', () => {
	it('names an instance the way Aleph names it, from the first 44 bits of its hash', () => {
		expect(twoN6Host(EKB)).toBe(EKB_HOST);
		expect(twoN6Host(SMOKE)).toBe('pride-panel-fiscal-brave.2n6.me');
	});

	it('reads the instance from the last segment of a relay-button registration id', () => {
		expect(instanceOf(`relay:orbitdb-relay:relay-main-ekb:${EKB}`)).toBe(EKB);
		expect(instanceOf('relay:orbitdb-relay:orbitdb-relay')).toBeNull();
		expect(instanceOf('relay:orbitdb-relay:simple-todo-e2e-1')).toBeNull();
		expect(instanceOf(`relay:orbitdb-relay:x:${EKB.slice(1)}`)).toBeNull();
		expect(instanceOf(undefined)).toBeNull();
	});
});

describe('scopeRelayBootstrapPosts, by owner', () => {
	it('keeps a relay of a trusted account, with the addresses on its own 2n6.me name only', () => {
		const [candidate, ...rest] = scopeRelayBootstrapPosts([ekb()], { now });
		expect(rest).toEqual([]);
		expect(candidate).toMatchObject({
			peerId: EKB_PEER,
			instance: EKB,
			owner: RELAY_BUTTON.toLowerCase()
		});
		expect(candidate.addresses).toEqual(wss(EKB_HOST, EKB_PEER));
	});

	it('drops a relay whose owner is not trusted', () => {
		expect(scopeRelayBootstrapPosts([ekb(undefined, { owner: STRANGER })], { now })).toEqual([]);
	});

	it('drops addresses on another host, and the relay when none are left', () => {
		const elsewhere = ekb(undefined, { multiaddrs: wss('evil.example', EKB_PEER) });
		expect(scopeRelayBootstrapPosts([elsewhere], { now })).toEqual([]);
		const mixed = ekb(undefined, {
			multiaddrs: [...wss('evil.example', EKB_PEER), wss(EKB_HOST, EKB_PEER)[0]]
		});
		expect(scopeRelayBootstrapPosts([mixed], { now })[0].addresses).toEqual([
			wss(EKB_HOST, EKB_PEER)[0]
		]);
	});

	it('drops a stale registration', () => {
		expect(scopeRelayBootstrapPosts([ekb('2026-11-03T19:00:00Z')], { now })).toEqual([]);
	});

	it('drops ephemeral relays and the retired fixed id: neither names a trusted owner', () => {
		const smoke = post({
			peer: '12D3KooWEeBDHhsc',
			at: '2026-11-04T03:30:00Z',
			registrationId: `relay:orbitdb-relay:smoke-orbitdb-relay-41766934680-1:${SMOKE}`,
			multiaddrs: wss('pride-panel-fiscal-brave.2n6.me', '12D3KooWEeBDHhsc')
		});
		const e2e = post({
			peer: '12D3KooWe2e',
			at: '2026-11-04T08:00:00Z',
			registrationId: 'relay:orbitdb-relay:simple-todo-e2e-1',
			owner: RELAY_BUTTON,
			multiaddrs: wss('e2e.example', '12D3KooWe2e')
		});
		const out = scopeRelayBootstrapPosts([smoke, e2e, retired, ekb()], { now });
		expect(out.map((c) => c.peerId)).toEqual([EKB_PEER]);
	});

	it('drops a relay of another profile', () => {
		expect(scopeRelayBootstrapPosts([ekb(undefined, { profile: 'uc-go-peer' })], { now })).toEqual(
			[]
		);
	});

	it('keeps one candidate per peer, its newest, and every current peer newest first', () => {
		const older = ekb('2026-11-03T22:17:00Z');
		const newer = ekb('2026-11-04T04:17:00Z');
		const second = post({
			peer: '12D3KooWsecond',
			at: '2026-11-04T06:00:00Z',
			registrationId: `relay:orbitdb-relay:relay-two:${SMOKE}`,
			owner: TRUSTED_RELAY_OWNERS[1],
			multiaddrs: wss(twoN6Host(SMOKE), '12D3KooWsecond')
		});
		const out = scopeRelayBootstrapPosts([older, newer, second], { now });
		expect(out.map((c) => [c.peerId, c.updatedAt])).toEqual([
			['12D3KooWsecond', Date.parse('2026-11-04T06:00:00Z')],
			[EKB_PEER, Date.parse('2026-11-04T04:17:00Z')]
		]);
	});
});

describe('scopeRelayBootstrapPosts, by registration id', () => {
	it('takes exactly that registration, its addresses as posted, without an owner', () => {
		const out = scopeRelayBootstrapPosts([retired, ekb()], {
			now,
			registrationId: 'relay:orbitdb-relay:orbitdb-relay'
		});
		expect(out).toHaveLength(1);
		expect(out[0].addresses).toEqual(retired.content.multiaddrs);
		expect(out[0].instance).toBeUndefined();
	});
});

describe('ownedInstance', () => {
	it('is yes only for a processed INSTANCE of that owner', async () => {
		const fetch = alephMessages({ [EKB]: instanceMessage(EKB, RELAY_BUTTON) });
		expect(await ownedInstance(EKB, RELAY_BUTTON.toLowerCase(), { fetch })).toBe(true);
		expect(fetch).toHaveBeenCalledWith(
			`https://api.aleph.im/api/v0/messages/${EKB}`,
			expect.anything()
		);
	});

	it('is no for an instance of another account', async () => {
		const fetch = alephMessages({ [EKB]: instanceMessage(EKB, STRANGER) });
		expect(await ownedInstance(EKB, RELAY_BUTTON, { fetch })).toBe(false);
	});

	it('is no for a forgotten or pending instance, another message type, or another hash', async () => {
		for (const answer of [
			instanceMessage(EKB, RELAY_BUTTON, { status: 'forgotten' }),
			instanceMessage(EKB, RELAY_BUTTON, { status: 'pending' }),
			instanceMessage(EKB, RELAY_BUTTON, { type: 'STORE' }),
			instanceMessage(SMOKE, RELAY_BUTTON)
		]) {
			const fetch = alephMessages({ [EKB]: answer });
			expect(await ownedInstance(EKB, RELAY_BUTTON, { fetch })).toBe(false);
		}
	});

	it('is no when Aleph does not know the hash or cannot be asked', async () => {
		expect(await ownedInstance(EKB, RELAY_BUTTON, { fetch: alephMessages({}) })).toBe(false);
		const down = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(await ownedInstance(EKB, RELAY_BUTTON, { fetch: down })).toBe(false);
	});
});

describe('discoverScopedBootstrapMultiaddrs', () => {
	it("returns Le Space's relay and nothing a registration merely claims", async () => {
		// A stranger copies relay-main-ekb's post onto another instance it does
		// not own, naming Le Space's account. The account is trusted; Aleph says
		// the instance is not that account's.
		const claimed = post({
			peer: '12D3KooWclaim',
			at: '2026-11-04T08:30:00Z',
			registrationId: `relay:orbitdb-relay:relay-main-ekb:${SMOKE}`,
			owner: RELAY_BUTTON,
			multiaddrs: wss(twoN6Host(SMOKE), '12D3KooWclaim')
		});
		const fetchPosts = vi.fn(async () => [retired, claimed, ekb()]);
		const fetch = alephMessages({
			[EKB]: instanceMessage(EKB, RELAY_BUTTON),
			[SMOKE]: instanceMessage(SMOKE, STRANGER)
		});
		const out = await discoverScopedBootstrapMultiaddrs({ fetchPosts, fetch, maxAgeMs: Infinity });
		expect(out).toEqual(wss(EKB_HOST, EKB_PEER));
		expect(fetchPosts).toHaveBeenCalledWith({ pagination: 100, fetch });
	});

	it('with a registration id asks Aleph for no instance', async () => {
		const fetchPosts = vi.fn(async () => [retired, ekb()]);
		const fetch = alephMessages({});
		const out = await discoverScopedBootstrapMultiaddrs({
			fetchPosts,
			fetch,
			maxAgeMs: Infinity,
			registrationId: 'relay:orbitdb-relay:orbitdb-relay'
		});
		expect(out).toEqual(retired.content.multiaddrs);
		expect(fetch).not.toHaveBeenCalled();
	});
});
