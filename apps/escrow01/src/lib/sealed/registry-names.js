/**
 * A sealed list's readable name in one's own list registry (#127).
 *
 * The registry (list-registry.js) is an OrbitDB database only its identity
 * writes, under a name nobody else can derive. That keeps strangers from
 * finding it, not from reading it: the relay pins it like any database it
 * sees. A sealed list's database name is random and its readable name sits
 * sealed in the list (`meta/name`); written into the registry in the clear,
 * the name would be readable there after all.
 *
 * So a sealed list's registry entry keeps `name` empty and carries the name
 * sealed to the identity's own X25519 key (`sealedName`). Each name stands on
 * its own — no registry-wide key that two devices could create at once and
 * overwrite — and opens on every device the passkey derives the same key on.
 * Its slot is the list's address, so a sealed name moved to another entry
 * does not open.
 *
 * Addresses, roles and dates stay readable, as for every list: metadata
 * (user decision, 26.11.2026).
 */
import { isSealedForReader, openTextSealedFor, sealTextFor } from './key-agreement.js';

/** @param {string} address */
const slotFor = (address) => `registry-name/${address}`;

/**
 * @param {string} name
 * @param {{ address: string, publicKey: Uint8Array }} owner the list's address,
 *   and the registry owner's own public key
 * @returns {Promise<import('./key-agreement.js').SealedForReader>}
 */
export function sealRegistryName(name, { address, publicKey }) {
	return sealTextFor(name, publicKey, { slot: slotFor(address) });
}

/**
 * The name in a registry entry: the sealed one when it opens, null when it is
 * sealed and does not, and the plain `name` of an entry that is not sealed.
 *
 * @param {{ address: string, name?: string, sealedName?: unknown }} entry
 * @param {import('./key-agreement.js').AgreementKey | null} own
 * @returns {Promise<string | null>}
 */
export async function openRegistryName(entry, own) {
	if (entry.sealedName === undefined) return typeof entry.name === 'string' ? entry.name : null;
	if (!own || !isSealedForReader(entry.sealedName)) return null;
	try {
		return await openTextSealedFor(entry.sealedName, own, { slot: slotFor(entry.address) });
	} catch {
		return null;
	}
}

/**
 * Registry entries with their sealed names opened, for the list switcher.
 * An entry whose name stays sealed keeps `name: ''` and is marked, so the
 * switcher can say so rather than show nothing.
 *
 * @template {{ address: string, name: string, sealedName?: unknown }} E
 * @param {E[]} entries
 * @param {import('./key-agreement.js').AgreementKey | null} own
 * @returns {Promise<(E & { nameSealed: boolean })[]>}
 */
export async function withOpenedNames(entries, own) {
	return Promise.all(
		entries.map(async (entry) => {
			if (entry.sealedName === undefined) return { ...entry, nameSealed: false };
			const name = await openRegistryName(entry, own);
			return { ...entry, name: name ?? '', nameSealed: name === null };
		})
	);
}
