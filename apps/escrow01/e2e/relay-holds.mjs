/**
 * Whether the E2E relay holds a record, asked the relay itself.
 *
 * `POST /pinning/has-entry` answers from the relay's own copy (`db.all()`), so
 * `true` means the relay can hand the record to a peer that has nothing. It is
 * the endpoint the app's relay proof trusts; `entryCount` from
 * `/pinning/databases` is not (see delegation.spec.js), and a database the
 * relay has not opened answers `hasEntry: null`.
 *
 * Before it asks, it has the relay sync each database (`POST /pinning/sync`,
 * as the app's relay proof does). Left to itself, the relay works through the
 * databases it discovers one after another, each waiting up to 20 s for
 * access-controller heads (orbitdb-relay#90). Late in a suite that backlog
 * holds earlier tests' registries, and in CI on #176 it had not reached this
 * one after 180 s; alone on a fresh relay it took ~54 s.
 *
 * The relay's `/pinning/*` REST API is deprecated (orbitdb-relay#61). This is
 * the one place a spec of this chapter calls it, so the migration
 * (simple-todo#64) has one place to change.
 */
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

/** The origin start-e2e-server.mjs wrote for this run. */
function relayHttpOrigin() {
	const info = JSON.parse(readFileSync(new URL('./relay-info.json', import.meta.url), 'utf8'));
	if (!info?.httpOrigin) throw new Error('relay-info.json names no relay HTTP origin');
	return String(info.httpOrigin).replace(/\/$/, '');
}

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} address
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function relayHasEntry(request, address, hash) {
	const response = await request.post(`${relayHttpOrigin()}/pinning/has-entry`, {
		data: { dbAddress: address, entryHash: hash },
		failOnStatusCode: false
	});
	if (!response.ok()) return false;
	return (await response.json())?.hasEntry === true;
}

/**
 * Ask the relay to sync `address` now. Its answer comes once the sync is done,
 * or after 120 s with 504 while it goes on.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} address
 * @returns {Promise<string>} what the relay said, for the log
 */
export async function askRelayToSync(request, address) {
	const response = await request.post(`${relayHttpOrigin()}/pinning/sync`, {
		data: { dbAddress: address },
		failOnStatusCode: false,
		timeout: 130_000
	});
	if (!response.ok()) return `HTTP ${response.status()}`;
	const { entryCount = null } = (await response.json()) ?? {};
	return `synced, entryCount ${entryCount}`;
}

/**
 * Wait until the relay holds every record in `databases`, having asked it to
 * sync each of them.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {Array<{ role: string, address: string | null, records: Array<{ key: string, hash: string }> }>} databases
 * @param {{ timeout?: number, log?: (message: string) => void }} [options]
 */
export async function waitUntilRelayHolds(request, databases, { timeout = 120_000, log } = {}) {
	const started = Date.now();
	// Not awaited: has-entry below is what counts, the answers are only logged.
	for (const { role, address } of databases) {
		if (!address) continue;
		void askRelayToSync(request, address).then(
			(said) => log?.(`relay sync of the ${role}: ${said} after ${Date.now() - started} ms`),
			(error) => log?.(`relay sync of the ${role} failed: ${error?.message ?? error}`)
		);
	}
	for (const { role, address, records } of databases) {
		expect(address, `${role}: no address`).toBeTruthy();
		expect(records.length, `${role}: no record to wait for`).toBeGreaterThan(0);
		for (const { hash } of records) {
			await expect
				.poll(() => relayHasEntry(request, /** @type {string} */ (address), hash), {
					message: `the relay holds ${role} record ${hash.slice(0, 12)}…`,
					timeout: Math.max(1, timeout - (Date.now() - started)),
					intervals: [500, 1000, 2000]
				})
				.toBe(true);
		}
		log?.(`relay holds the ${role} (${records.length}) after ${Date.now() - started} ms`);
	}
}
