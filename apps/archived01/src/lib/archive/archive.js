// The archive: every change to the list, shipped as a sealed increment soon
// after it is made, to a store outside this device (archived01).
//
// What this module does, and in which order:
//
//   1. **Unlock.** One PRF read of the passkey (or the one the start already
//      made) gives the archive account and the backup key (`keys.js`). Both
//      live in memory until the tab closes; what is persisted is the
//      account's public address, the choice of store, and — sealed with the
//      backup key — a service's API key, if the store needs one.
//   2. **Watch.** The storage bridge's `createLiveBackup` watches the open
//      todo database. A few seconds after a write (`settle`), and at least
//      every half minute while something is pending, it walks from the heads
//      back to what it last shipped and uploads what it finds as one small
//      CAR, sealed. On Aleph the upload is followed by a STORE message the
//      archive account signs — that is what keeps it, and what the account's
//      credits pay for. A store that cannot be reached loses nothing: the next
//      increment is larger.
//   3. **Find and restore.** The increments an account has kept are listed by
//      the account (Aleph's messages API, by owner) or by the service's own
//      listing; a wiped browser, after the same passkey, downloads them and
//      joins them into the open list, which is then what it was.
//
// Nothing here is a backend: the bridge's drivers do Aleph, Pinata and
// Lighthouse, and `local-backend.js` keeps increments in this browser for
// trying it out.

import { writable, get } from 'svelte/store';
import {
	readPrfOutput,
	PrfUnavailableError
} from '@le-space/orbitdb-identity-provider-webauthn-did';
import { deriveArchiveKeys, sealer, sealText, openText } from './keys.js';
import { createLocalBackend } from './local-backend.js';
import { todoDBStore, orbitdbStore, loadTodos } from '../db-actions.js';
import { recall, remember, forget } from '@simple-todo/todo/browser-memory.js';

/** The stores an archive can go to. */
export const BACKEND_KINDS = /** @type {const} */ (['aleph', 'pinata', 'lighthouse', 'local']);
/** @typedef {(typeof BACKEND_KINDS)[number]} BackendKind */

/** Every STORE the archive account sends names this channel, so a listing by owner and channel finds exactly the archive. */
export const ALEPH_CHANNEL = 'SIMPLE-TODO-ARCHIVED01';

/** Milliseconds after the last write before an increment goes out. */
export const SETTLE_MS = 3_000;
/** How often, at most, while something is pending. */
export const EVERY_MS = 30_000;

const SETTINGS_KEY = 'simpleTodo.archive';
const stateKey = (/** @type {string} */ kind, /** @type {string} */ address) =>
	`simpleTodo.archive.state.${kind}.${address}`;
const secretKey = (/** @type {string} */ kind, /** @type {string} */ address) =>
	`simpleTodo.archive.secret.${kind}.${address}`;

/**
 * @typedef {object} ArchiveSettings
 * @property {boolean} enabled - the archive starts with the list, after the passkey
 * @property {BackendKind} backend
 * @property {string | null} address - the archive account, public
 */

/** @returns {ArchiveSettings} */
export function readArchiveSettings() {
	try {
		const parsed = JSON.parse(recall(SETTINGS_KEY) ?? 'null');
		if (parsed && typeof parsed === 'object') {
			return {
				enabled: parsed.enabled === true,
				backend: BACKEND_KINDS.includes(parsed.backend) ? parsed.backend : 'aleph',
				address: typeof parsed.address === 'string' ? parsed.address : null
			};
		}
	} catch {
		// No storage, or something that is not ours: the defaults.
	}
	return { enabled: false, backend: 'aleph', address: null };
}

/** @param {Partial<ArchiveSettings>} patch */
function saveArchiveSettings(patch) {
	const next = { ...readArchiveSettings(), ...patch };
	try {
		remember(SETTINGS_KEY, JSON.stringify(next));
	} catch {
		// The choice holds for this session and no longer.
	}
	archiveStore.update((s) => ({ ...s, enabled: next.enabled, backend: next.backend }));
	return next;
}

/**
 * @typedef {object} ArchiveStatus
 * @property {boolean} enabled
 * @property {BackendKind} backend
 * @property {boolean} unlocked - the keys are in memory
 * @property {boolean} running - the watcher is on
 * @property {string | null} address - the archive account
 * @property {number} sequence - of the last increment shipped
 * @property {number} pending - updates not yet shipped
 * @property {{ sequence: number, at: Date, bytes: number, entries: number, id: string, kept: boolean } | null} lastShipped
 * @property {string | null} lastError
 * @property {number} failures
 * @property {{ id: string, name?: string, size?: number, time?: number, sequence?: number, entries?: number }[] | null} increments - the last listing
 * @property {'' | 'unlocking' | 'shipping' | 'listing' | 'restoring' | 'deleting'} busy
 * @property {{ forgotten: number, rejected: number } | null} deleted - what the last deletion did
 * @property {{ joined: number, heads: number, increments: number, skipped: number, copied?: number } | null} restored - `copied`: todos taken over from archived lists other than the open one
 * @property {{ stage: 'listing' | 'downloading' | 'joining' | 'collecting' | 'uploading' | 'keeping' | 'deleting', done: number, total: number } | null} progress - what a restore or a backup is doing now; `total` 0 when no share makes sense
 * @property {{ credits: number, hourly: number | null, mib: number | null, days: number | null, at: number } | null} credits - the archive account on Aleph: balance, last full hour's expense, and how long the balance lasts at that rate
 */

const initial = readArchiveSettings();

/** @type {import('svelte/store').Writable<ArchiveStatus>} */
export const archiveStore = writable({
	enabled: initial.enabled,
	backend: initial.backend,
	unlocked: false,
	running: false,
	address: initial.address,
	sequence: 0,
	pending: 0,
	lastShipped: null,
	lastError: null,
	failures: 0,
	increments: null,
	busy: '',
	restored: null,
	credits: null,
	progress: null,
	deleted: null
});

/** @param {Partial<ArchiveStatus>} patch */
const patch = (patch) => archiveStore.update((s) => ({ ...s, ...patch }));

/** @type {import('./keys.js').ArchiveKeys | null} */
let keys = null;
/** @type {Uint8Array | null} */
let rememberedPrf = null;
/** @type {any} */
let live = null;
/** @type {any} */
let backend = null;
/** @type {any} */
let watchedDb = null;
/** @type {(() => void) | null} */
let offUpdate = null;

/**
 * The start already read the PRF output (one touch for identity and archive):
 * keep it, so unlocking asks nothing more.
 *
 * @param {Uint8Array | null | undefined} prfOutput
 */
export function rememberPrfOutput(prfOutput) {
	rememberedPrf = prfOutput instanceof Uint8Array ? prfOutput : null;
}

/** @param {unknown} error */
const message = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Derive the keys: from the PRF output the start kept, or with one touch of
 * the passkey now. Starts the watcher when the archive is enabled.
 *
 * @param {{ credential: any, prfOutput?: Uint8Array | null }} params
 * @returns {Promise<{ address: string }>}
 */
export async function unlockArchive({ credential, prfOutput = null }) {
	patch({ busy: 'unlocking', lastError: null });
	try {
		const prf = prfOutput ?? rememberedPrf ?? (await readPrfOutput(credential));
		keys = await deriveArchiveKeys(prf);
		// Derived; the secret itself has no further use in this tab.
		rememberedPrf = null;
		saveArchiveSettings({ address: keys.address });
		patch({ unlocked: true, address: keys.address });
		void refreshCredits();
		if (get(archiveStore).enabled) await startArchive();
		return { address: keys.address };
	} catch (error) {
		patch({
			lastError: error instanceof PrfUnavailableError ? 'prf-unavailable' : message(error)
		});
		throw error;
	} finally {
		patch({ busy: '' });
	}
}

/** Is a service key needed, and is one stored, for this kind of store? */
export function hasBackendSecret(/** @type {BackendKind} */ kind) {
	const address = get(archiveStore).address ?? '';
	return kind !== 'aleph' && kind !== 'local' ? Boolean(recall(secretKey(kind, address))) : true;
}

/**
 * Keep a service's key, sealed with the backup key.
 *
 * @param {BackendKind} kind
 * @param {string} secret
 */
export async function setBackendSecret(kind, secret) {
	if (!keys) throw new Error('unlock the archive first');
	if (!secret.trim()) {
		forget(secretKey(kind, keys.address));
		return;
	}
	remember(secretKey(kind, keys.address), await sealText(keys.aesKey, secret.trim()));
}

/** @param {BackendKind} kind */
async function backendSecret(kind) {
	if (!keys) throw new Error('unlock the archive first');
	const sealed = recall(secretKey(kind, keys.address));
	if (!sealed) throw new Error(`no key stored for ${kind}`);
	return openText(keys.aesKey, sealed);
}

/**
 * The store, sealed: whichever driver, behind `withEncryption` with the
 * backup key, so every driver sees ciphertext only.
 *
 * @param {BackendKind} kind
 */
async function buildBackend(kind) {
	if (!keys) throw new Error('unlock the archive first');
	const { withEncryption } = await import('@le-space/orbitdb-storage-bridge/backends/encryption');
	/** @type {any} */
	let inner;
	if (kind === 'aleph') {
		const [{ createAlephBackend }, { createAlephPin }] = await Promise.all([
			import('@le-space/orbitdb-storage-bridge/backends/aleph'),
			import('@le-space/orbitdb-storage-bridge/backends/aleph-pin')
		]);
		const { address, sign } = keys;
		inner = createAlephBackend({
			pin: createAlephPin({
				sender: address,
				sign: (_address, text) => sign(text),
				channel: ALEPH_CHANNEL
			})
		});
	} else if (kind === 'pinata') {
		const { createPinataBackend } = await import(
			'@le-space/orbitdb-storage-bridge/backends/pinata'
		);
		inner = createPinataBackend({ jwt: await backendSecret('pinata') });
	} else if (kind === 'lighthouse') {
		const { createLighthouseBackend } = await import(
			'@le-space/orbitdb-storage-bridge/backends/lighthouse'
		);
		inner = createLighthouseBackend({ apiKey: await backendSecret('lighthouse') });
	} else {
		inner = createLocalBackend();
	}
	return withEncryption(inner, sealer(keys.aesKey));
}

/**
 * What the store already holds for this database: the newest increment's
 * sequence, id and heads, as the watcher's state. Null when the store holds
 * nothing (or cannot be asked), so the watcher starts at 1.
 *
 * @param {string} address
 */
async function stateFromStore(address) {
	try {
		const items = await listArchive();
		if (items.length === 0 || !backend) return null;
		const { readIncrement } = await import('@le-space/orbitdb-storage-bridge/live-backup');
		const newest = await readIncrement(await backend.getBlob(items[0].id));
		const described = /** @type {any} */ (newest.manifest.metadata).databases.find(
			(/** @type {any} */ d) => String(d.address) === address
		);
		if (!described) return null;
		return {
			v: 1,
			sequence: newest.manifest.sequence,
			base: newest.manifest.base ?? null,
			previous: items[0].id,
			databases: { [address]: { heads: described.heads } }
		};
	} catch (error) {
		console.warn('archive: could not read the state from the store', error);
		return null;
	}
}

/**
 * A todo as this app writes it; anything else from an archived list is left
 * where it is rather than copied into the open one.
 * @param {unknown} value
 */
function looksLikeTodo(value) {
	if (!value || typeof value !== 'object') return false;
	const v = /** @type {Record<string, unknown>} */ (value);
	return typeof v.text === 'string' && typeof v.completed === 'boolean';
}

/** The name every increment goes up under; the listing filters by it. */
const NAME_PREFIX = 'archived01-';

function refresh() {
	if (!live) return;
	const s = live.status();
	patch({
		running: s.running,
		sequence: s.sequence,
		pending: s.pending,
		failures: s.failures,
		lastError: s.lastError ? message(s.lastError) : get(archiveStore).lastError
	});
}

/**
 * Watch the open todo database and ship its changes. Called on unlock when
 * the archive is enabled, and again when the list changes.
 */
export async function startArchive() {
	const db = get(todoDBStore);
	if (!keys || !db) return;
	if (live && watchedDb === db) return;
	await stopArchive();

	const kind = get(archiveStore).backend;
	backend = await buildBackend(kind);
	const address = String(db.address);
	const key = stateKey(kind, address);
	const { createLiveBackup } = await import('@le-space/orbitdb-storage-bridge/live-backup');
	live = createLiveBackup({
		databases: [db],
		backend,
		after: 1,
		settle: SETTLE_MS,
		// Aleph says "pending" first and may refuse later — no credit, no grant.
		// The increment counts as shipped only once the STORE is processed; a
		// refusal fails the flush, and the next one ships it all again.
		confirm:
			kind === 'aleph'
				? async (/** @type {any} */ kept) => {
						if (kept?.status !== 'pending' || !kept.itemHash) return kept;
						const { waitForMessage } = await import(
							'@le-space/orbitdb-storage-bridge/backends/aleph-pin'
						);
						const final = await waitForMessage(kept.itemHash, { timeout: 60_000, interval: 2_000 });
						return { ...kept, ...final, retained: final.status === 'processed' };
					}
				: undefined,
		every: EVERY_MS,
		state: {
			// Remembered where the storage choice allows; otherwise, or on a
			// device that has never shipped, the store's newest increment says
			// where the numbering stands, so nothing goes out twice.
			load: async () => JSON.parse(recall(key) ?? 'null') ?? (await stateFromStore(address)),
			save: async (/** @type {unknown} */ state) => remember(key, JSON.stringify(state))
		},
		name: (/** @type {number} */ sequence, /** @type {Date} */ at) =>
			// Opaque: the service sees a sequence number, not the list or the time.
			`${NAME_PREFIX}${String(sequence).padStart(6, '0')}-${at.getTime().toString(36).slice(-4)}.car`,
		onShipped: (/** @type {any} */ shipped) => {
			patch({
				lastShipped: {
					sequence: shipped.sequence,
					at: shipped.at,
					bytes: shipped.bytes,
					entries: shipped.entries,
					id: String(shipped.handle?.id ?? ''),
					kept: shipped.kept ? shipped.kept.retained !== false : shipped.handle?.retained !== false
				},
				lastError: null
			});
			refresh();
			void refreshCredits({ shippedBytes: shipped.bytes });
		},
		onError: (/** @type {unknown} */ error) => {
			patch({ lastError: message(error) });
			refresh();
		}
	});
	watchedDb = db;
	const onUpdate = () => refresh();
	const events = /** @type {any} */ (db.events);
	events?.on?.('update', onUpdate);
	offUpdate = () => events?.off?.('update', onUpdate);
	await live.start();
	refresh();
}

export async function stopArchive() {
	offUpdate?.();
	offUpdate = null;
	if (live) await live.stop();
	live = null;
	watchedDb = null;
	patch({ running: false });
}

/** Ship what is pending now. */
export async function flushArchive() {
	if (!live) throw new Error('the archive is not running');
	patch({ busy: 'shipping', progress: { stage: 'collecting', done: 0, total: 0 } });
	try {
		return await live.flush();
	} finally {
		patch({ busy: '', progress: null });
		refresh();
	}
}

/**
 * Switch the archive on: it starts now, and on every start after the passkey.
 *
 * @param {{ backend?: BackendKind }} [choice]
 */
export async function enableArchive({ backend: kind } = {}) {
	saveArchiveSettings({ enabled: true, ...(kind ? { backend: kind } : {}) });
	await startArchive();
}

export async function disableArchive() {
	await stopArchive();
	saveArchiveSettings({ enabled: false });
}

/**
 * Change the store. The watcher restarts against it; what the old store holds
 * stays there.
 *
 * @param {BackendKind} kind
 */
export async function chooseBackend(kind) {
	saveArchiveSettings({ backend: kind });
	patch({ increments: null, restored: null, credits: null });
	if (kind === 'aleph') void refreshCredits();
	if (keys && get(archiveStore).enabled) {
		await stopArchive();
		await startArchive();
	}
}

/**
 * The increments the store holds for this account, newest first.
 *
 * On Aleph the question goes to the messages API by owner and channel: it
 * answers for a device that has stored nothing, which is the case that
 * matters. Elsewhere the service's own listing, filtered by name.
 */
export async function listArchive() {
	if (!keys) throw new Error('unlock the archive first');
	const kind = get(archiveStore).backend;
	patch({ busy: 'listing', lastError: null, progress: { stage: 'listing', done: 0, total: 0 } });
	try {
		/** @type {{ id: string, name?: string, size?: number, time?: number }[]} */
		let items;
		if (kind === 'aleph') {
			const { listAlephStores } = await import(
				'@le-space/orbitdb-storage-bridge/backends/aleph-pin'
			);
			// Every page: the API cuts at 50 by default, and a chain of increments is
			// longer than that after a few sessions. The oldest entries live there.
			/** @type {any[]} */
			const stores = [];
			for (let page = 1; ; page++) {
				const { stores: some, total } = await listAlephStores({
					owner: keys.address,
					channel: ALEPH_CHANNEL,
					pagination: 100,
					page
				});
				stores.push(...some);
				if (some.length === 0 || (total != null && stores.length >= total)) break;
				if (total == null && some.length < 100) break;
			}
			items = stores.map((s) => ({ id: s.cid, time: s.time * 1000 }));
		} else {
			const b = backend ?? (await buildBackend(kind));
			const listed = typeof b.list === 'function' ? await b.list() : [];
			items = listed
				.filter((/** @type {any} */ h) => !h.name || String(h.name).startsWith(NAME_PREFIX))
				.map((/** @type {any} */ h) => ({
					id: String(h.id),
					...(h.name ? { name: h.name } : {}),
					...(typeof h.size === 'number' ? { size: h.size } : {}),
					...(typeof h.time === 'number' ? { time: h.time } : {})
				}))
				.sort((/** @type {any} */ a, /** @type {any} */ b) => (b.time ?? 0) - (a.time ?? 0));
		}
		patch({ increments: items });
		return items;
	} catch (error) {
		patch({ lastError: message(error) });
		throw error;
	} finally {
		patch({ busy: '', progress: null });
	}
}

/**
 * Download every increment the store holds and join it into the open list.
 * Joining merges: what is here stays, what the archive holds is added. A blob
 * that is not an increment — or that this key does not open — is skipped and
 * counted, not fatal.
 */
export async function restoreArchive() {
	if (!keys) throw new Error('unlock the archive first');
	const db = get(todoDBStore);
	if (!db) throw new Error('no list is open');
	const items = get(archiveStore).increments ?? (await listArchive());
	patch({
		busy: 'restoring',
		lastError: null,
		restored: null,
		progress: { stage: 'downloading', done: 0, total: items.length }
	});
	try {
		const b = backend ?? (await buildBackend(get(archiveStore).backend));
		const { readIncrement, joinIncrements } = await import(
			'@le-space/orbitdb-storage-bridge/live-backup'
		);
		/** @type {Awaited<ReturnType<typeof readIncrement>>[]} */
		const increments = [];
		let skipped = 0;
		for (const [index, item] of items.entries()) {
			try {
				increments.push(await readIncrement(await b.getBlob(item.id)));
			} catch (error) {
				console.warn(`archive: skipping ${item.id}: ${message(error)}`);
				skipped++;
			}
			patch({ progress: { stage: 'downloading', done: index + 1, total: items.length } });
		}
		patch({ progress: { stage: 'joining', done: items.length, total: items.length } });
		// Which list the increments are about. The open list is joined in place.
		// Increments of other lists — the list's address changed when it became
		// the passkey's, or an earlier device opened other words — are restored
		// under their own addresses (the increments carry the manifest, so this
		// works with the network off) and their todos copied into the open list,
		// written anew by this identity: what somebody pressing "restore" wants is
		// everything the archive holds, in the list in front of them.
		/** @type {Map<string, typeof increments>} */
		const byAddress = new Map();
		for (const increment of increments) {
			for (const d of /** @type {any} */ (increment.manifest.metadata).databases ?? []) {
				const address = String(d.address);
				byAddress.set(address, [...(byAddress.get(address) ?? []), increment]);
			}
		}
		const current = String(db.address);
		let result = { joined: 0, heads: 0 };
		let count = 0;
		let copied = 0;
		const mine = byAddress.get(current);
		if (mine) {
			count += mine.length;
			result = await joinIncrements(db, { increments: mine });
		}
		const others = [...byAddress.entries()].filter(([address]) => address !== current);
		if (others.length > 0) {
			const orbitdb = get(orbitdbStore);
			if (!orbitdb) throw new Error('OrbitDB is not open');
			const { restoreFromIncrements } = await import(
				'@le-space/orbitdb-storage-bridge/live-backup'
			);
			for (const [address, theirs] of others) {
				count += theirs.length;
				patch({ progress: { stage: 'joining', done: count, total: increments.length } });
				const restored = await restoreFromIncrements(orbitdb, {
					increments: theirs,
					open: { type: 'keyvalue', sync: false }
				});
				const other = /** @type {any} */ (
					restored.databases.find((/** @type {any} */ d) => String(d.address) === address)
				)?.database;
				if (!other) continue;
				// Only a list this identity may write — the archive is sealed, but a
				// store that could forge a sealed blob must not be able to put words
				// into the owner's mouth: what is copied is written anew by this DID.
				const writers = /** @type {string[]} */ (other.access?.write ?? []);
				const mine = writers.includes('*') || writers.includes(String(orbitdb.identity?.id));
				if (!mine) {
					console.warn(`archive: not copying from ${address}: this identity may not write there`);
					await other.close();
					continue;
				}
				for (const { key, value } of await other.all()) {
					if ((await db.get(key)) !== undefined) continue;
					if (!looksLikeTodo(value)) continue;
					await db.put(key, value);
					copied++;
				}
				await other.close();
			}
		}
		await loadTodos();
		const restored = {
			joined: result.joined,
			heads: result.heads,
			increments: count,
			skipped,
			...(copied ? { copied } : {})
		};
		patch({ restored });
		// What is here now counts as shipped: the watcher must not send it back.
		if (live) await live.rebase();
		refresh();
		return restored;
	} catch (error) {
		patch({ lastError: message(error) });
		throw error;
	} finally {
		patch({ busy: '', progress: null });
	}
}

/**
 * A fresh browser, the same passkey, the list gone: unlock (one touch, unless
 * the start already read the PRF output), find the increments, and join them —
 * the whole way from one button, which is where somebody who has lost a
 * browser will look for it.
 *
 * @param {{ credential: any }} params
 */
export async function recoverFromArchive({ credential }) {
	if (!keys) await unlockArchive({ credential });
	await listArchive();
	return restoreArchive();
}

/** Aleph's public API; the balance of any address is readable without a key. */
export const ALEPH_API = 'https://api2.aleph.im';

/** Measured 2026-10-03: 107.8 credits kept 2 MiB for a day. */
export const CREDITS_PER_MIB_DAY = 54;

/**
 * The archive account's credits on Aleph, and how long they last.
 *
 * Two public reads, no key: the balance, and the credit history, whose
 * hourly `credit_expense` rows say what Aleph charged for the hour before
 * (a storage charge carries the MiB it covered). The newest row can be a
 * partial hour, so the rate comes from the first row that was preceded by
 * another at least an hour earlier. With no expense yet — a fresh account —
 * the rate is estimated from what this device has shipped and kept.
 *
 * @param {{ shippedBytes?: number }} [hint] - bytes kept so far, for the estimate
 */
export async function refreshCredits({ shippedBytes = 0 } = {}) {
	const { address, backend: kind } = get(archiveStore);
	if (!address || kind !== 'aleph') return null;
	try {
		const [balance, history] = await Promise.all([
			fetch(`${ALEPH_API}/api/v0/addresses/${address}/balance`).then((r) =>
				r.ok ? r.json() : null
			),
			fetch(`${ALEPH_API}/api/v0/addresses/${address}/credit_history?pagination=6`).then((r) =>
				r.ok ? r.json() : null
			)
		]);
		const credits = Number(balance?.credit_balance ?? 0);
		/** @type {any[]} */
		const rows = (history?.credit_history ?? []).filter(
			(/** @type {any} */ r) => r.payment_method === 'credit_expense'
		);
		let hourly = null;
		let mib = null;
		for (let i = 0; i + 1 < rows.length; i++) {
			const gap =
				(Date.parse(rows[i].message_timestamp) - Date.parse(rows[i + 1].message_timestamp)) /
				3_600_000;
			if (gap >= 0.95) {
				hourly = Math.abs(Number(rows[i].amount));
				mib = rows[i].expense_size_mib != null ? Number(rows[i].expense_size_mib) : null;
				break;
			}
		}
		const perHour =
			hourly ?? (shippedBytes > 0 ? ((shippedBytes / 1048576) * CREDITS_PER_MIB_DAY) / 24 : null);
		const days = perHour && perHour > 0 ? credits / perHour / 24 : null;
		const result = { credits, hourly, mib, days, at: Date.now() };
		patch({ credits: result });
		return result;
	} catch (error) {
		console.warn('archive: could not read credits', error);
		return null;
	}
}

/**
 * Delete the whole archive at the store: every increment this account keeps
 * there. On Aleph a signed FORGET per batch, which the archive account sends
 * for itself — it is the owner, no wallet needed; elsewhere the service's
 * own `remove` per blob. Afterwards the watcher starts from nothing, so the
 * next increment carries the whole list again: deleting the archive is not
 * deleting the list.
 *
 * Increments never go away by themselves, and each costs by the hour; this is
 * the way to stop paying for a chain nobody will restore from.
 *
 * @returns {Promise<{ forgotten: number, rejected: number }>}
 */
export async function deleteArchive() {
	if (!keys) throw new Error('unlock the archive first');
	const kind = get(archiveStore).backend;
	patch({
		busy: 'deleting',
		lastError: null,
		deleted: null,
		progress: { stage: 'deleting', done: 0, total: 0 }
	});
	try {
		await stopArchive();
		let forgotten = 0;
		let rejected = 0;
		if (kind === 'aleph') {
			const { createAlephForget, forgetAlephStores } = await import(
				'@le-space/orbitdb-storage-bridge/backends/aleph-pin'
			);
			const { address, sign } = keys;
			const result = await forgetAlephStores({
				owner: address,
				channel: ALEPH_CHANNEL,
				forget: createAlephForget({
					sender: address,
					sign: (_address, text) => sign(text),
					channel: ALEPH_CHANNEL
				}),
				reason: 'archive deleted by its owner (simple-todo archived01)',
				onProgress: (/** @type {{ done: number, total: number }} */ p) =>
					patch({ progress: { stage: 'deleting', done: p.done, total: p.total } })
			});
			forgotten = result.forgotten.length;
			rejected = result.rejected.length;
		} else {
			const b = backend ?? (await buildBackend(kind));
			const items = typeof b.list === 'function' ? await b.list() : [];
			const mine = items.filter(
				(/** @type {any} */ h) => !h.name || String(h.name).startsWith(NAME_PREFIX)
			);
			for (const [index, item] of mine.entries()) {
				try {
					if (typeof b.remove !== 'function') throw new Error(`${kind} cannot delete`);
					await b.remove(item);
					forgotten++;
				} catch (error) {
					console.warn(`archive: could not delete ${item.id}: ${message(error)}`);
					rejected++;
				}
				patch({ progress: { stage: 'deleting', done: index + 1, total: mine.length } });
			}
		}
		// The watcher's memory of what was shipped is memory of what is gone.
		const db = get(todoDBStore);
		if (db) forget(stateKey(kind, String(db.address)));
		const deleted = { forgotten, rejected };
		patch({ deleted, increments: [], restored: null, sequence: 0, lastShipped: null });
		if (get(archiveStore).enabled) await startArchive();
		void refreshCredits();
		return deleted;
	} catch (error) {
		patch({ lastError: message(error) });
		throw error;
	} finally {
		patch({ busy: '', progress: null });
	}
}

/** Forget the keys; the settings stay. */
export async function lockArchive() {
	await stopArchive();
	keys = null;
	rememberedPrf = null;
	backend = null;
	patch({ unlocked: false });
}

// The list changes (a different mnemonic, a restart): the watcher follows it.
todoDBStore.subscribe((db) => {
	if (!db || !keys || !get(archiveStore).enabled) return;
	if (db !== watchedDb) void startArchive().catch((error) => patch({ lastError: message(error) }));
});
