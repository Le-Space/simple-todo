// A storage backend that keeps the increments in this browser (archived01),
// as far as the storage choice allows: through `remember`/`recall`, so a
// device that asked to keep nothing keeps no ciphertext either.
//
// It archives nothing anywhere: the point of the chapter is a copy *outside*
// the device. It exists so the mechanism can be watched without an account —
// increments appear in the list as they are shipped, and a wiped database
// comes back from them — and so the end-to-end test needs no service. The
// same contract as every other driver (`putBlob`, `getBlob`, `list`,
// `remove`), so the archive code does not know which one it holds.
//
// Ids are the CID of the bytes, as the bridge's in-process driver issues them.

import { defineBackend, BackendError } from '@le-space/orbitdb-storage-bridge/backends/types';
import { CID } from 'multiformats/cid';
import { recall, remember, forget } from '@simple-todo/todo/browser-memory.js';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';

const INDEX_KEY = 'simpleTodo.archive.local.index';
const BLOB_KEY = 'simpleTodo.archive.local.blob.';

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(text);
}

/** @param {string} text */
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** @returns {{ id: string, name?: string, size: number, time: number }[]} */
function readIndex() {
	try {
		const parsed = JSON.parse(recall(INDEX_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** @param {{ id: string, name?: string, size: number, time: number }[]} index */
function writeIndex(index) {
	remember(INDEX_KEY, JSON.stringify(index));
}

/** Forget every increment kept here. */
export function clearLocalArchive() {
	for (const { id } of readIndex()) forget(BLOB_KEY + id);
	forget(INDEX_KEY);
}

export function createLocalBackend() {
	return defineBackend({
		name: 'local',
		capabilities: {
			pinByCid: false,
			carImport: false,
			preservesInnerCids: true,
			browserSafeAuth: true,
			delegation: false,
			listing: true,
			deletion: true,
			minBlobSize: 0
		},

		/**
		 * @param {Uint8Array} bytes
		 * @param {{ name?: string }} [meta]
		 */
		async putBlob(bytes, meta = {}) {
			const id = CID.create(1, raw.code, await sha256.digest(bytes)).toString();
			remember(BLOB_KEY + id, toBase64(bytes));
			const index = readIndex().filter((entry) => entry.id !== id);
			index.push({
				id,
				...(meta.name ? { name: meta.name } : {}),
				size: bytes.length,
				time: Date.now()
			});
			writeIndex(index);
			return {
				id,
				cid: id,
				backend: 'local',
				size: bytes.length,
				...(meta.name ? { name: meta.name } : {})
			};
		},

		/** @param {{ id: string } | string} handle */
		async getBlob(handle) {
			const id = typeof handle === 'string' ? handle : handle.id;
			const stored = recall(BLOB_KEY + id);
			if (!stored) throw new BackendError('NOT_FOUND', `No blob for ${id}`);
			return fromBase64(stored);
		},

		async list() {
			return readIndex()
				.slice()
				.sort((a, b) => b.time - a.time)
				.map((entry) => ({ ...entry, cid: entry.id, backend: 'local' }));
		},

		/** @param {{ id: string } | string} handle */
		async remove(handle) {
			const id = typeof handle === 'string' ? handle : handle.id;
			forget(BLOB_KEY + id);
			writeIndex(readIndex().filter((entry) => entry.id !== id));
		}
	});
}
