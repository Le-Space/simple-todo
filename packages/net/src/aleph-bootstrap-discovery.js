import {
	fetchAlephBootstrapPosts,
	filterRelayBootstrapPostsByProfile
} from '@le-space/aleph-bootstrap';
import { wordlist } from '@scure/bip39/wordlists/english';

// The relay registrations live on a public Aleph channel: anyone with an ETH
// key can post there, and registrations of erased VMs are orphaned forever
// (guests self-publish with generated keys since relay-button #66, so no
// remaining key can FORGET them). Discovery therefore scopes hard before any
// dial probe runs:
//  - owner (#104): a registration counts only if the Aleph account that runs
//    the relay is one of Le Space's, and Aleph itself confirms that the
//    instance named in the registration is that account's. Only the
//    instance's own 2n6.me name is dialled, so a registration cannot send the
//    browser to another host. Ephemeral E2E and smoke relays run from other
//    accounts or name none, so they stay out (#84) without a fixed
//    registration id — which kept nobody out anyway, since anyone can post
//    under it too.
//  - maxAgeMs: orphans stop refreshing (live relays republish every 6 h), so
//    anything older than ~2 cadences is dead weight.
//
// One relay per *peer*. The package's `selectCurrentRelayBootstrapPosts` keeps
// the newest post per registration id — and on 2026-10-16 a stray relay
// registered under the then production id (`relay:orbitdb-relay:orbitdb-relay`),
// six minutes before every deploy ran: it was the newest, so it was the only
// candidate, it did not answer, and all ten chapters failed to publish while
// the healthy relay sat one post below it. Which candidate is alive is the
// probe's question, so every current one is kept, newest first, and a dead one
// costs a probe, not the deploy.
//
// A test that needs its own relay passes `registrationId`: then exactly that
// registration counts, without the owner check, as before #104.

/**
 * The Aleph accounts Le Space pays its relays from. A relay deployed with
 * relay-button names its account (`ownerAddress`) and its instance (the last
 * segment of its registration id) when it registers. A redeploy needs no
 * change here: the account stays, the instance is checked on Aleph.
 */
export const TRUSTED_RELAY_OWNERS = Object.freeze([
	// relay-button
	'0x28129bdDa64310221480d4eF903446b0cdFD4BEb',
	// orbitdb-relay
	'0x2bd014B41FEa490320187b5FAdf413dab88f7628'
]);

const ALEPH_API_HOST = 'https://api.aleph.im';
const DEFAULT_MAX_AGE_MS = 13 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The 2n6.me name Aleph's gateway gives an instance: the first 44 bits of its
 * hash as four BIP39 words.
 *
 * @param {string} instanceHash
 */
export function twoN6Host(instanceHash) {
	const bits = parseInt(String(instanceHash).slice(0, 11), 16);
	const words = [33, 22, 11, 0].map((shift) => wordlist[Math.floor(bits / 2 ** shift) % 2048]);
	return `${words.join('-')}.2n6.me`;
}

/**
 * The instance a relay-button registration names: the last segment of
 * `relay:<profile>:<name>:<instance hash>`.
 *
 * @param {unknown} registrationId
 * @returns {string | null}
 */
export function instanceOf(registrationId) {
	return /^relay:[^:]+:.+:([0-9a-f]{64})$/.exec(String(registrationId ?? ''))?.[1] ?? null;
}

/** @param {string} address @param {string} host */
const onHost = (address, host) => {
	const [, protocol, name] = address.split('/');
	return /^dns[46]?$/.test(protocol ?? '') && name === host;
};

/** @param {any} post */
const updatedAtOf = (post) => post?.content?.updatedAt ?? (post?.time ? post.time * 1000 : 0);

/**
 * @param {any} content
 * @returns {string[]}
 */
const addressesOf = (content) =>
	(content?.browserMultiaddrs?.length
		? content.browserMultiaddrs
		: (content?.multiaddrs ?? [])
	).map(String);

/**
 * @typedef {object} RelayCandidate
 * @property {string} peerId
 * @property {number} updatedAt
 * @property {string[]} addresses the ones the browser may dial
 * @property {string | undefined} registrationId
 * @property {string} [instance] owner mode: the instance to check on Aleph
 * @property {string} [owner] owner mode: the account that must own it
 */

/**
 * The registrations that may be bootstrap candidates: fresh, of the profile,
 * one per peer (its newest), newest first. Without `registrationId`, only
 * those of a trusted owner, each with the addresses on its instance's own
 * 2n6.me name — still to be checked against the instance (`ownedInstance`).
 * With `registrationId`, exactly that registration, its addresses as posted.
 *
 * @param {any[]} posts - relay-bootstrap-v2 posts as the registry returns them
 * @param {{ profile?: string, registrationId?: string | null, owners?: readonly string[], maxAgeMs?: number, now?: number }} [options]
 * @returns {RelayCandidate[]}
 */
export function scopeRelayBootstrapPosts(
	posts,
	{
		profile = 'orbitdb-relay',
		registrationId = null,
		owners = TRUSTED_RELAY_OWNERS,
		maxAgeMs = DEFAULT_MAX_AGE_MS,
		now = Date.now()
	} = {}
) {
	const fresh = posts.filter((post) => {
		const updatedAt = updatedAtOf(post);
		return updatedAt > 0 && now - updatedAt <= maxAgeMs;
	});
	const trusted = new Set(owners.map((owner) => owner.toLowerCase()));
	/** @type {RelayCandidate[]} */
	const candidates = [];
	for (const post of filterRelayBootstrapPostsByProfile(fresh, profile)) {
		const content = post?.content;
		const peerId = content?.peerId ?? post?.address ?? '';
		if (!peerId) continue;
		const base = {
			peerId,
			updatedAt: updatedAtOf(post),
			registrationId: content?.registrationId
		};
		if (registrationId) {
			if (content?.registrationId !== registrationId) continue;
			candidates.push({ ...base, addresses: addressesOf(content) });
			continue;
		}
		const owner = String(content?.ownerAddress ?? '').toLowerCase();
		const instance = instanceOf(content?.registrationId);
		if (!instance || !trusted.has(owner)) continue;
		const host = twoN6Host(instance);
		const addresses = addressesOf(content).filter((address) => onHost(address, host));
		if (addresses.length === 0) continue;
		candidates.push({ ...base, addresses, instance, owner });
	}
	/** @type {Map<string, RelayCandidate>} */
	const newestPerPeer = new Map();
	for (const candidate of candidates) {
		const previous = newestPerPeer.get(candidate.peerId);
		if (!previous || candidate.updatedAt > previous.updatedAt) {
			newestPerPeer.set(candidate.peerId, candidate);
		}
	}
	return [...newestPerPeer.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Whether Aleph holds `instance` as a processed INSTANCE of `owner`. A
 * registration can name any instance and any owner; this is the answer only
 * the owner can have produced. Any failure to ask counts as no.
 *
 * @param {string} instance
 * @param {string} owner
 * @param {{ fetch?: typeof fetch, apiHost?: string, timeoutMs?: number }} [options]
 */
export async function ownedInstance(
	instance,
	owner,
	{
		fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
		apiHost = ALEPH_API_HOST,
		timeoutMs = DEFAULT_TIMEOUT_MS
	} = {}
) {
	try {
		const response = await fetchImpl(new URL(`/api/v0/messages/${instance}`, apiHost).toString(), {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!response.ok) return false;
		const body = await response.json();
		return (
			body?.status === 'processed' &&
			body?.message?.type === 'INSTANCE' &&
			body?.message?.item_hash === instance &&
			String(body?.message?.content?.address ?? '').toLowerCase() === owner.toLowerCase()
		);
	} catch {
		return false;
	}
}

/**
 * Le Space's current relays as Aleph knows them: their addresses, newest
 * relay first. With `registrationId`, the addresses of exactly that
 * registration instead (tests).
 *
 * @param {{
 *   profile?: string,
 *   registrationId?: string | null,
 *   owners?: readonly string[],
 *   maxAgeMs?: number,
 *   pagination?: number,
 *   fetch?: typeof fetch,
 *   fetchPosts?: (options: { pagination: number, fetch?: typeof fetch }) => Promise<any[]>,
 *   timeoutMs?: number
 * }} [options] `fetchPosts`: the registry read, for a chapter that brings its
 *   own `@le-space/aleph-bootstrap` (qr01)
 * @returns {Promise<string[]>}
 */
export async function discoverScopedBootstrapMultiaddrs({
	profile = 'orbitdb-relay',
	registrationId = null,
	owners = TRUSTED_RELAY_OWNERS,
	maxAgeMs = DEFAULT_MAX_AGE_MS,
	pagination = 100,
	fetch: fetchImpl,
	fetchPosts = fetchAlephBootstrapPosts,
	timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
	const posts = await fetchPosts({ pagination, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
	const candidates = scopeRelayBootstrapPosts(posts, { profile, registrationId, owners, maxAgeMs });
	if (registrationId) return [...new Set(candidates.flatMap((candidate) => candidate.addresses))];
	// Anyone can post any owner and any instance; only Aleph says whose the
	// instance is.
	const owned = await Promise.all(
		candidates.map((candidate) =>
			ownedInstance(String(candidate.instance), String(candidate.owner), {
				fetch: fetchImpl,
				timeoutMs
			})
		)
	);
	return [
		...new Set(
			candidates.filter((_, index) => owned[index]).flatMap((candidate) => candidate.addresses)
		)
	];
}
