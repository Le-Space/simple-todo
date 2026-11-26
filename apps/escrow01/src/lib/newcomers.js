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
 */

/** The owner answers a newcomer twice: at once, and again in case gossipsub had no stream to it yet. */
export const ANSWER_AGAIN_AFTER_MS = 3_000;
/** Joins that come closer together than this get one answer. */
export const MIN_ANSWER_INTERVAL_MS = 1_000;

/**
 * @param {() => any} getPubsub the session's gossipsub service, or nothing
 */
export function createNewcomerAnswers(getPubsub) {
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
				for (const head of await database.log.heads()) {
					const bytes = await database.log.storage.get(head.hash);
					// Nobody on the topic: nobody to tell.
					if (bytes) await pubsub.publish(topic, bytes).catch(() => {});
				}
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
