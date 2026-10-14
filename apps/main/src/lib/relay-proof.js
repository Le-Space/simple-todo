// Deciding what a relay's answer says about one OrbitDB entry.
//
// This used to be a single equality inside db-actions.js:
//
//     proof.ok === true && proof.lastRecord?.hash === entryHash
//
// `/pinning/sync` reports the relay's snapshot but only its *last* record, so
// that comparison answers "is this the newest entry the relay holds", not "did
// the relay replicate it". The moment any later todo arrives it is false for
// the earlier one forever — with six todos in flight the early ones were
// unprovable no matter how long anyone waited. orbitdb-relay 0.10.3 answers the
// real question over POST /pinning/has-entry; the equality stays as the
// fallback for relays that predate it.

/** Total time a single entry may spend trying to prove itself. */
export const RELAY_PROOF_BUDGET_MS = 60_000;
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 5_000;

/**
 * @typedef {'pinned' | 'absent' | 'indeterminate'} RelayProofOutcome
 */

/**
 * What one round of relay answers proves about `entryHash`.
 *
 * The three outcomes are not interchangeable. `absent` is the only one the UI
 * may paint as a negative: the relay scanned its snapshot and the entry was not
 * there. `indeterminate` means nobody knows — an old relay, an unopened
 * database, a truncated scan, a transport error — and must never be shown as
 * "not replicated", which is precisely the conflation that made the old
 * indicator lie.
 *
 * @param {{ membership?: any, sync?: any, entryHash: string }} input
 * @returns {RelayProofOutcome}
 */
export function decideProofOutcome({ membership, sync, entryHash }) {
	if (membership && membership.ok === true) {
		if (membership.hasEntry === true) return 'pinned';
		if (membership.hasEntry === false) return 'absent';
		// hasEntry === null: the relay could not scan (database not open, or an
		// iterator walk truncated at 100k). Explicitly not `absent`.
	}

	// Relays before 0.10.3 have no membership route. Their `lastRecord` answer
	// is still sound in the one case it can express: the entry is the newest one
	// they hold. It can never disprove anything, so a mismatch is indeterminate.
	if (sync && sync.ok === true && sync.lastRecord?.hash === entryHash) return 'pinned';

	return 'indeterminate';
}

/**
 * Backoff between proof rounds.
 *
 * The old code fired three rounds 250 ms apart and then latched a permanent
 * negative — a relay that needed one extra second was recorded as having lost
 * the entry, and nothing ever asked again. Growing the gap keeps the early
 * rounds responsive (most proofs land on the first or second) while letting the
 * budget stretch over a slow sync without hammering the relay.
 *
 * @param {number} attempt 1-based
 * @returns {number}
 */
export function nextProofDelayMs(attempt) {
	const grown = MIN_DELAY_MS * 2 ** Math.max(0, attempt - 1);
	return Math.min(MAX_DELAY_MS, grown);
}

/**
 * The status to store once the budget is spent without a `pinned`.
 *
 * @param {RelayProofOutcome} lastOutcome
 * @returns {'unavailable' | 'unknown'}
 */
export function statusForExhaustedBudget(lastOutcome) {
	return lastOutcome === 'absent' ? 'unavailable' : 'unknown';
}

/**
 * @typedef {'sync' | 'observe'} RelayProofMode
 */

/**
 * How the proof asks the relay (Le-Space/simple-todo#64).
 *
 * `sync`, the default and what every chapter does today: each round sends
 * `POST /pinning/sync`, which makes the relay run a fresh pass over the
 * database, and restarts the local Sync so the relay sees a subscription edge.
 * `observe`: never ask the relay to do anything; only read
 * `POST /pinning/has-entry` within the same budget, so the chip reports what
 * the relay replicated on its own.
 *
 * Set at build time with `VITE_RELAY_PROOF_MODE`. An E2E or dev build also
 * reads `localStorage['relay-proof-mode']`, so one build serves both arms of
 * the experiment; a production build ignores it.
 *
 * @param {Record<string, string | boolean | undefined>} [env] the build's `import.meta.env`
 * @param {{ getItem(key: string): string | null } | undefined} [storage] the page's `localStorage`
 * @returns {RelayProofMode}
 */
export function relayProofMode(env = import.meta.env, storage = globalThis.localStorage) {
	if (env?.VITE_E2E === 'true' || env?.DEV === true) {
		try {
			const stored = storage?.getItem('relay-proof-mode');
			if (stored === 'observe' || stored === 'sync') return stored;
		} catch {
			// No storage here; the build-time setting decides.
		}
	}
	return env?.VITE_RELAY_PROOF_MODE === 'observe' ? 'observe' : 'sync';
}
