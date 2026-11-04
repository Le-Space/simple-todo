import { fetchAlephBootstrapPosts } from '@le-space/aleph-bootstrap';
import { discoverScopedBootstrapMultiaddrs as discoverShared } from '@simple-todo/net/aleph-bootstrap-discovery.js';

// Which relays count is decided once, in `@simple-todo/net`: Le Space's own,
// by the Aleph account that runs them and checked against the instance on
// Aleph (#104), fresh, one per peer (#84). This file used to scope on its own
// with the package's `discoverAlephBootstrapMultiaddrs`, by one fixed
// registration id — the newest post under it, which on 2026-10-16 was a stray
// relay that did not answer. The chapter keeps reading the registry with its
// own `@le-space/aleph-bootstrap`, the version its README names.

/**
 * @param {{ profile?: string, registrationId?: string | null, maxAgeMs?: number, pagination?: number }} [options]
 *   `registrationId`: exactly that registration instead of Le Space's relays (tests)
 * @returns {Promise<string[]>}
 */
export function discoverScopedBootstrapMultiaddrs(options = {}) {
	return discoverShared({ ...options, fetchPosts: fetchAlephBootstrapPosts });
}
