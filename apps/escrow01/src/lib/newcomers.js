/**
 * An owner's browser answers every newcomer to one of its databases (#164,
 * #127).
 *
 * OrbitDB hands an existing entry to a newcomer only in its join-time heads
 * exchange, and that does not reach a browser that first meets the owner over
 * the relay's circuit: the protocol is refused on a limited connection and not
 * tried again (AGENTS.md). The relay may hold the database, but only when its
 * queue gets to the topic in time. So the owner's browser answers every peer
 * that joins the database's topic itself, with its heads over gossipsub, which
 * crosses a circuit -- as `Sync.add()` publishes a new entry. OrbitDB fetches
 * the rest of the log and the signer's identity by bitswap, which crosses the
 * circuit too (p2p.js).
 *
 * Measured for the account directory in #164 and moved here from
 * chain/account-directory.js, so that sealed lists' key stores
 * (sealed/key-store.js) answer the same way: a writer granted while the owner
 * is online must get his copy, whoever got to the relay first.
 *
 * Fetching by CID did not hold up either (#127): late in the long local suite
 * bitswap delivered nothing between two browsers, not the signer's identity
 * document and not an older entry, though gossipsub between them worked. So an
 * answer carries what the newcomer needs to accept it without a fetch: first
 * the identity documents of its writers (./identity-blocks.js), then -- for a
 * small database, as directories and key stores are -- every entry, oldest
 * first, so that each one's predecessors are already there.
 */
import { offerIdentityBlocks } from './identity-blocks.js';

/** The owner answers a newcomer twice: at once, and again in case gossipsub had no stream to it yet. */
export const ANSWER_AGAIN_AFTER_MS = 3_000;
/** Joins that come closer together than this get one answer. */
export const MIN_ANSWER_INTERVAL_MS = 1_000;
/** Up to this many entries an answer carries the whole log; beyond it, the heads. */
export const MAX_ENTRIES_CARRIED = 64;
/** The identity documents an answer carries at most. */
export const MAX_SIGNERS_CARRIED = 8;

/**
 * What an answer publishes for `database`: the writers' identity documents,
 * then its entries -- all of them, oldest first, for a small log; its heads
 * otherwise.
 *
 * @param {any} database
 * @param {any} identities the session's OrbitDB identities, or nothing
 * @returns {Promise<{ documents: Uint8Array[], entries: Uint8Array[] }>}
 */
export async function answerFor(database, identities) {
	const all = await database.log.values();
	const carried = all.length <= MAX_ENTRIES_CARRIED ? all : await database.log.heads();
	/** @type {Uint8Array[]} */
	const documents = [];
	const signers = [...new Set(carried.map((/** @type {any} */ entry) => entry.identity))];
	for (const hash of signers.filter(Boolean).slice(0, MAX_SIGNERS_CARRIED)) {
		const identity = await identities?.getIdentity?.(hash).catch(() => null);
		if (identity?.bytes) documents.push(identity.bytes);
	}
	/** @type {Uint8Array[]} */
	const entries = [];
	for (const entry of carried) {
		const bytes = await database.log.storage.get(entry.hash);
		if (bytes) entries.push(bytes);
	}
	return { documents, entries };
}

/**
 * @param {() => any} getPubsub the session's gossipsub service, or nothing
 * @param {() => any} [getIdentities] the session's OrbitDB identities, whose
 *   documents of the writers an answer carries
 */
export function createNewcomerAnswers(getPubsub, getIdentities = () => null) {
	/** How this session answers for a database, by address. @type {Map<string, () => void>} */
	const serving = new Map();

	return {
		/**
		 * Answer every peer that joins the database, from the browser that owns
		 * it: its heads on the database's topic. A peer that has them already
		 * drops them again in its log.
		 *
		 * Peers on the topic before this browser started answering never join in
		 * its sight; the caller answers them at once with what this returns.
		 *
		 * @param {any} database
		 * @returns {(() => void) | undefined}
		 */
		serve(database) {
			const topic = String(database.address);
			const pubsub = getPubsub();
			if (!pubsub) return undefined;
			const known = serving.get(topic);
			if (known) return known;

			const announce = async () => {
				const { documents, entries } = await answerFor(database, getIdentities());
				await offerIdentityBlocks(pubsub, documents);
				// Nobody on the topic: nobody to tell.
				for (const bytes of entries) await pubsub.publish(topic, bytes).catch(() => {});
			};
			let answeredAt = 0;
			const answer = () => {
				if (Date.now() - answeredAt < MIN_ANSWER_INTERVAL_MS) return;
				answeredAt = Date.now();
				void announce().catch(() => {});
				setTimeout(() => void announce().catch(() => {}), ANSWER_AGAIN_AFTER_MS);
			};
			/** @param {any} event */
			const onSubscriptionChange = (event) => {
				const joined = (event.detail?.subscriptions ?? []).some(
					(/** @type {any} */ subscription) =>
						subscription.subscribe && subscription.topic === topic
				);
				if (joined) answer();
			};
			pubsub.addEventListener('subscription-change', onSubscriptionChange);
			database.events.once('close', () => {
				pubsub.removeEventListener('subscription-change', onSubscriptionChange);
				serving.delete(topic);
			});
			serving.set(topic, answer);
			return answer;
		},

		/**
		 * Answer the peers already on the topic, which joined before this browser
		 * listened.
		 *
		 * @param {any} database
		 * @param {(() => void) | undefined} answer what `serve` returned
		 */
		answerThoseThere(database, answer) {
			const pubsub = getPubsub();
			if (answer && (pubsub?.getSubscribers?.(String(database.address)) ?? []).length > 0) {
				answer();
			}
		},

		/**
		 * Join the database's topic again, which its owner answers with the
		 * heads. Through gossipsub alone: OrbitDB's Sync keeps listening, and
		 * only the subscription is sent anew.
		 *
		 * @param {any} database
		 */
		askAgain(database) {
			const topic = String(database.address);
			const pubsub = getPubsub();
			if (!pubsub) return;
			pubsub.unsubscribe(topic);
			pubsub.subscribe(topic);
		}
	};
}
