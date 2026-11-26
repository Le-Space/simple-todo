/**
 * Who reads sealed lists in this session (#127): the identity's DID and its
 * X25519 key (./own-agreement-key.js).
 *
 * p2p.js sets it once OrbitDB has its identity and clears it when the network
 * stops. The list code takes it from here rather than deriving a key of its
 * own: one key per session, from the start's single PRF read.
 */
import { get, writable } from 'svelte/store';

/**
 * @typedef {{ did: string, agreementKey: import('./key-agreement.js').AgreementKey }} SealedReader
 */

/** @type {import('svelte/store').Writable<SealedReader | null>} */
export const sealedReaderStore = writable(null);

/** This session's reader, or null before the identity exists. */
export function currentReader() {
	return get(sealedReaderStore);
}
