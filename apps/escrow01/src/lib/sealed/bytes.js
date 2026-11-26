/**
 * Bytes to text and back, for what a sealed list writes into OrbitDB (#127).
 *
 * OrbitDB stores entry values as dag-cbor, which would take a `Uint8Array` as
 * it is. The envelopes still carry base64 strings: a delegate's renamed text
 * has to be a string for the delegated controller to accept it, and one form
 * for every envelope keeps a reader from having to guess which one it got.
 */

const CHUNK = 0x8000;

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toBase64(bytes) {
	// In chunks: spreading a long ciphertext into one call overflows the stack.
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}
	return btoa(binary);
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 * @throws {Error} when `text` is not base64
 */
export function fromBase64(text) {
	if (typeof text !== 'string') throw new TypeError('Base64 must be a string.');
	return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/**
 * Base64 that decodes, or null. For values read from a peer, where anything
 * may arrive.
 *
 * @param {unknown} text
 * @returns {Uint8Array | null}
 */
export function base64OrNull(text) {
	if (typeof text !== 'string') return null;
	try {
		return fromBase64(text);
	} catch {
		return null;
	}
}

/** @param {string} text */
export const utf8 = (text) => new TextEncoder().encode(text);
