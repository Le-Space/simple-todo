/**
 * The "pinned" mark on a todo: proof that the relay holds this exact
 * entry, asked of the relay over HTTP (`POST /pinning/sync`, then its last
 * record's hash compared with the entry's).
 *
 * Inherited, not part of what escrow01 teaches, and moved here from
 * db-actions.js as it was. The `/pinning/*` routes are deprecated in
 * orbitdb-relay (relay#61), so new code should not build on them.
 */
import { writable, get } from 'svelte/store';
import { relayHttpStatusStore } from '@simple-todo/net/relay-status.js';

/**
 * Re-joins the database's pubsub topic if that database is still the open
 * one, so OrbitDB exchanges heads with the relay while it syncs.
 *
 * @typedef {(dbAddress: string) => Promise<void>} Resubscribe
 */

/** @typedef {'unknown' | 'pending' | 'pinned' | 'unavailable'} TodoReplicationStatus */
export const todoReplicationStatusStore = writable(
	/** @type {Record<string, TodoReplicationStatus>} */ ({})
);

const relayProofsInFlight = new Set();
const RELAY_PROOF_ATTEMPTS = 3;

/**
 * @param {string} todoKey @param {string} entryHash @param {string} dbAddress
 * @param {Resubscribe} resubscribe
 */
export function scheduleRelayReplicationProof(todoKey, entryHash, dbAddress, resubscribe) {
	if (relayProofsInFlight.has(todoKey)) return;
	if (get(todoReplicationStatusStore)[todoKey] === 'pinned') return;

	relayProofsInFlight.add(todoKey);
	todoReplicationStatusStore.update((statuses) => ({ ...statuses, [todoKey]: 'pending' }));
	void verifyRelayReplication(todoKey, entryHash, dbAddress, resubscribe).finally(() => {
		relayProofsInFlight.delete(todoKey);
	});
}

/**
 * Ask the connected relay to perform a fresh database sync. A green state is only
 * assigned when the relay reports this exact OrbitDB entry as its last local record.
 * @param {string} todoKey
 * @param {string} entryHash
 * @param {string} dbAddress
 * @param {Resubscribe} resubscribe
 */
export async function verifyRelayReplication(todoKey, entryHash, dbAddress, resubscribe) {
	const { origin } = get(relayHttpStatusStore);
	if (!origin || !entryHash || !dbAddress) {
		console.warn('Relay replication proof skipped:', {
			todoKey,
			reason: !origin
				? 'no connected relay HTTP origin'
				: !entryHash
					? 'missing OrbitDB entry hash'
					: 'missing OrbitDB database address'
		});
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
		return;
	}

	try {
		for (let attempt = 1; attempt <= RELAY_PROOF_ATTEMPTS; attempt++) {
			const proof = await requestRelayReplicationProof(
				origin,
				dbAddress,
				todoKey,
				attempt,
				resubscribe
			);
			const replicated = proof?.ok === true && proof?.lastRecord?.hash === entryHash;
			if (replicated) {
				console.info('Relay replication proof verified:', { todoKey, entryHash, attempt });
				todoReplicationStatusStore.update((statuses) => ({
					...statuses,
					[todoKey]: 'pinned'
				}));
				return;
			}

			console.warn('Relay replication proof did not include the expected entry:', {
				todoKey,
				attempt,
				expectedEntryHash: entryHash,
				reportedEntryHash: proof?.lastRecord?.hash ?? null,
				relayOk: proof?.ok ?? null,
				entryCount: proof?.entryCount ?? null,
				snapshotSource: proof?.snapshotSource ?? null
			});
		}
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
	} catch (error) {
		console.warn('Relay pinning proof unavailable for todo:', todoKey, error);
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
	}
}

/**
 * @param {string} origin @param {string} dbAddress @param {string} todoKey @param {number} attempt
 * @param {Resubscribe} resubscribe
 */
async function requestRelayReplicationProof(origin, dbAddress, todoKey, attempt, resubscribe) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	try {
		console.info('Requesting relay replication proof:', {
			todoKey,
			attempt,
			dbAddress,
			endpoint: `${origin}/pinning/sync`
		});
		const responsePromise = fetch(`${origin}/pinning/sync`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ dbAddress }),
			signal: controller.signal
		});

		// The relay may already be subscribed for discovery before OrbitDB installs
		// its heads handler. Re-subscribing here makes OrbitDB perform its native
		// heads exchange while the relay database is open.
		await new Promise((resolve) => setTimeout(resolve, 250));
		await resubscribe(dbAddress);

		const response = await responsePromise;
		const responseText = await response.text();
		if (!response.ok) {
			throw new Error(
				`HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 500)}` : ''}`
			);
		}
		try {
			return JSON.parse(responseText);
		} catch {
			throw new Error(`Relay returned invalid JSON: ${responseText.slice(0, 500)}`);
		}
	} finally {
		clearTimeout(timeout);
	}
}
