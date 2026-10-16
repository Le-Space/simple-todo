import {
	fetchAlephBootstrapPosts,
	filterRelayBootstrapPostsByProfile
} from '@le-space/aleph-bootstrap';

// The relay registrations live on a public Aleph channel: anyone with an ETH
// key can post there, and registrations of erased VMs are orphaned forever
// (guests self-publish with generated keys since relay-button #66, so no
// remaining key can FORGET them). Discovery therefore scopes hard before any
// dial probe runs (issue #84):
//  - registrationId: only the app's own production registration — ephemeral
//    E2E relays register as `relay:<profile>:simple-todo-e2e-*` and polluted
//    the candidate list until the browser's probe wave exhausted its stream
//    budget and dropped the healthy relay along with the corpses.
//  - maxAgeMs: orphans stop refreshing (live relays republish every 6 h), so
//    anything older than ~2 cadences is dead weight even when the
//    registrationId matches.
//
// One relay per *peer*, not one per registration id. The package's
// `selectCurrentRelayBootstrapPosts` keeps the newest post per registration
// id — and on 2026-10-16 a stray relay registered under the production id
// (`relay:orbitdb-relay:orbitdb-relay`), six minutes before every deploy ran:
// it was the newest, so it was the only candidate, it did not answer, and
// all ten chapters failed to publish while the healthy production relay sat
// one post below it. The id scopes which relays may be candidates; which of
// them is alive is the probe's question, so every current registration under
// the id is a candidate, newest first, and a dead one costs a probe, not the
// deploy.
const DEFAULT_REGISTRATION_ID = 'relay:orbitdb-relay:orbitdb-relay';
const DEFAULT_MAX_AGE_MS = 13 * 60 * 60 * 1000;

/**
 * The registrations that may be bootstrap candidates: fresh, of the profile,
 * under the registration id, one per peer (its newest), newest first.
 *
 * @param {any[]} posts - relay-bootstrap-v2 posts as the registry returns them
 * @param {{ profile?: string, registrationId?: string | null, maxAgeMs?: number, now?: number }} [options]
 * @returns {any[]}
 */
export function scopeRelayBootstrapPosts(
	posts,
	{
		profile = 'orbitdb-relay',
		registrationId = DEFAULT_REGISTRATION_ID,
		maxAgeMs = DEFAULT_MAX_AGE_MS,
		now = Date.now()
	} = {}
) {
	const fresh = posts.filter((post) => {
		const updatedAt = post?.content?.updatedAt ?? (post?.time ? post.time * 1000 : 0);
		return updatedAt > 0 && now - updatedAt <= maxAgeMs;
	});
	const profiled = filterRelayBootstrapPostsByProfile(fresh, profile);
	const scoped = registrationId
		? profiled.filter((post) => post.content?.registrationId === registrationId)
		: profiled;
	/** @type {Map<string, any>} */
	const newestPerPeer = new Map();
	for (const post of scoped) {
		const peer = post.content?.peerId ?? post.address ?? '';
		if (!peer) continue;
		const previous = newestPerPeer.get(peer);
		if (!previous || updatedAtOf(post) > updatedAtOf(previous)) newestPerPeer.set(peer, post);
	}
	return [...newestPerPeer.values()].sort((a, b) => updatedAtOf(b) - updatedAtOf(a));
}

/** @param {any} post */
const updatedAtOf = (post) => post?.content?.updatedAt ?? (post?.time ? post.time * 1000 : 0);

export async function discoverScopedBootstrapMultiaddrs({
	profile = 'orbitdb-relay',
	registrationId = DEFAULT_REGISTRATION_ID,
	maxAgeMs = DEFAULT_MAX_AGE_MS,
	pagination = 100
} = {}) {
	const posts = await fetchAlephBootstrapPosts({ pagination });
	const scoped = scopeRelayBootstrapPosts(posts, { profile, registrationId, maxAgeMs });
	const addresses = scoped.flatMap((post) => {
		const content = post.content;
		if (!content) return [];
		return content.browserMultiaddrs?.length
			? content.browserMultiaddrs
			: (content.multiaddrs ?? []);
	});
	return [...new Set(addresses)];
}
