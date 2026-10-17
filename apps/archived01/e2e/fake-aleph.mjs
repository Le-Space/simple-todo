// A stand-in for Aleph, as strict as the real one where the chapter can be
// wrong: who signed, whose STORE it is, and what the owner granted.
//
// The archive-owner spec puts an owner account between the browser and the
// bill. Nothing in that path can be tested against api2.aleph.im without the
// owner's key and credits, so this fake answers the four hosts' worth of
// endpoints the chapter talks to and checks what Aleph checks: the EIP-191
// signature over `chain\nsender\ntype\nitem_hash`, the item hash over the
// content, the `security` grant of the account in `content.address` to the
// sender (type and channel), and that the paying account holds credit. A
// message that fails is `rejected`, like Aleph's, not an HTTP error, so the
// chapter's confirm path runs. Blobs get a real CIDv1 (raw, sha-256), so the
// bridge's gateway check passes for what was uploaded and fails for anything
// else.

import { createHash } from 'node:crypto';
import { verifyMessage } from 'viem';

const API = 'https://api2.aleph.im';
const IPFS = 'https://ipfs.aleph.cloud';

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
	String(a).toLowerCase() === String(b).toLowerCase();

/** CIDv1, raw codec, sha2-256, base32lower — what `ipfs add --raw-leaves --cid-version 1` would say. @param {Buffer} bytes */
export function rawCid(bytes) {
	const digest = createHash('sha256').update(bytes).digest();
	const cid = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
	const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of cid) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += alphabet[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
	return `b${out}`;
}

/**
 * The first file part of a multipart body.
 * @param {Buffer} body
 * @param {string} contentType
 * @returns {{ name: string, bytes: Buffer }}
 */
function firstFile(body, contentType) {
	const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
	if (!boundary) throw new Error('multipart without a boundary');
	const start = body.indexOf(`--${boundary}`);
	const headersEnd = body.indexOf('\r\n\r\n', start);
	const headers = body.subarray(start, headersEnd).toString('utf8');
	const name = /filename="([^"]*)"/.exec(headers)?.[1] ?? 'blob';
	const end = body.indexOf(`\r\n--${boundary}`, headersEnd + 4);
	return { name, bytes: body.subarray(headersEnd + 4, end) };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ credits?: Record<string, number> }} [options] - balances by address
 */
export async function fakeAleph(page, options = {}) {
	/** @type {Record<string, number>} */
	const credits = Object.fromEntries(
		Object.entries(options.credits ?? {}).map(([address, n]) => [address.toLowerCase(), n])
	);
	/** @type {Map<string, { authorizations: any[] }>} the `security` aggregate by owner (lower-case) */
	const security = new Map();
	/** @type {Map<string, Buffer>} */
	const blobs = new Map();
	/** @type {Map<string, any>} accepted STORE messages by item hash */
	const stores = new Map();
	/** @type {Map<string, { status: string, error_code?: string }>} every message's fate */
	const fates = new Map();
	/** @type {{ type: string, status: string, sender: string, address: string, reason?: string }[]} */
	const log = [];

	/** @param {string} owner @param {string} sender @param {string} type @param {string} channel */
	const granted = (owner, sender, type, channel) => {
		if (same(owner, sender)) return true;
		const list = security.get(owner.toLowerCase())?.authorizations ?? [];
		return list.some(
			(a) =>
				same(a.address, sender) &&
				(!Array.isArray(a.types) || a.types.includes(type)) &&
				(!Array.isArray(a.channels) || a.channels.includes(channel))
		);
	};

	/** What Aleph decides about a posted message. @param {any} message */
	async function judge(message) {
		const content = JSON.parse(message.item_content);
		const hash = createHash('sha256').update(message.item_content).digest('hex');
		if (hash !== message.item_hash) return { status: 'rejected', error_code: 'item_hash' };
		const payload = [message.chain, message.sender, message.type, message.item_hash].join('\n');
		const ok = await verifyMessage({
			address: message.sender,
			message: payload,
			signature: message.signature
		}).catch(() => false);
		if (!ok) return { status: 'rejected', error_code: 'signature' };
		if (!granted(content.address, message.sender, message.type, message.channel)) {
			return { status: 'rejected', error_code: 'permission' };
		}
		if (message.type === 'STORE') {
			if (content.payment?.type !== 'credit') return { status: 'rejected', error_code: 'payment' };
			if (!(credits[String(content.address).toLowerCase()] > 0)) {
				return { status: 'rejected', error_code: 'insufficient_credit' };
			}
			if (!blobs.has(content.item_hash)) return { status: 'rejected', error_code: 'unknown_file' };
			stores.set(message.item_hash, { ...message, content });
			return { status: 'processed' };
		}
		if (message.type === 'FORGET') {
			for (const h of content.hashes) {
				const kept = stores.get(h);
				if (!kept || !same(kept.content.address, content.address)) {
					return { status: 'rejected', error_code: 'not_yours' };
				}
			}
			for (const h of content.hashes) stores.delete(h);
			return { status: 'processed' };
		}
		return { status: 'rejected', error_code: 'type' };
	}

	/** @param {import('@playwright/test').Route} route @param {number} status @param {unknown} body */
	const json = (route, status, body) =>
		route.fulfill({
			status,
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': '*' },
			body: JSON.stringify(body)
		});

	await page.route(`${IPFS}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (request.method() === 'POST' && url.pathname === '/api/v0/add') {
			const body = request.postDataBuffer();
			if (!body) return json(route, 400, { error: 'no body' });
			const { name, bytes } = firstFile(body, request.headers()['content-type'] ?? '');
			const cid = rawCid(Buffer.from(bytes));
			blobs.set(cid, Buffer.from(bytes));
			return json(route, 200, { Name: name, Hash: cid, Size: String(bytes.length) });
		}
		const cid = /^\/ipfs\/([^/?]+)/.exec(url.pathname)?.[1];
		const bytes = cid ? blobs.get(cid) : undefined;
		if (!bytes) return json(route, 404, { error: 'not here' });
		return route.fulfill({
			status: 200,
			contentType: 'application/octet-stream',
			headers: { 'access-control-allow-origin': '*' },
			body: bytes
		});
	});

	await page.route(`${API}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		if (request.method() === 'POST' && path === '/api/v0/messages') {
			const { message } = JSON.parse(request.postData() ?? '{}');
			const fate = await judge(message);
			fates.set(message.item_hash, fate);
			const content = JSON.parse(message.item_content);
			log.push({
				type: message.type,
				status: fate.status,
				sender: message.sender,
				address: content.address,
				...(fate.error_code ? { reason: fate.error_code } : {})
			});
			// Aleph takes the message first and decides afterwards: the chapter
			// must follow a pending answer, so that is what it gets.
			return json(route, 202, { message_status: 'pending' });
		}
		let m;
		if ((m = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(path))) {
			const fate = fates.get(m[1]);
			return fate ? json(route, 200, fate) : json(route, 404, {});
		}
		if (path === '/api/v0/messages.json') {
			const owner = url.searchParams.get('owners') ?? '';
			const channel = url.searchParams.get('channels');
			const pagination = Number(url.searchParams.get('pagination') ?? 50);
			const pageNo = Number(url.searchParams.get('page') ?? 1);
			const all = [...stores.values()]
				.filter((s) => same(s.content.address, owner) && (!channel || s.channel === channel))
				.sort((a, b) => b.time - a.time);
			const messages = all.slice((pageNo - 1) * pagination, pageNo * pagination).map((s) => ({
				item_hash: s.item_hash,
				sender: s.sender,
				channel: s.channel,
				time: s.time,
				content: s.content
			}));
			return json(route, 200, { messages, pagination_total: all.length, pagination_page: pageNo });
		}
		if ((m = /^\/api\/v0\/aggregates\/([^/.]+)\.json$/.exec(path))) {
			const entry = security.get(m[1].toLowerCase());
			return entry
				? json(route, 200, { address: m[1], data: { security: entry } })
				: json(route, 404, { detail: 'not found' });
		}
		if ((m = /^\/api\/v0\/addresses\/([^/]+)\/balance$/.exec(path))) {
			return json(route, 200, {
				address: m[1],
				balance: 0,
				credit_balance: credits[m[1].toLowerCase()] ?? 0
			});
		}
		if (/^\/api\/v0\/addresses\/[^/]+\/credit_history$/.test(path)) {
			return json(route, 200, { credit_history: [] });
		}
		return json(route, 404, { detail: `the fake knows no ${path}` });
	});

	return {
		/** What the owner would have written with the CLI. @param {string} owner @param {any[]} authorizations */
		grant(owner, authorizations) {
			security.set(owner.toLowerCase(), { authorizations });
		},
		stores: () => [...stores.values()],
		blobs: () => [...blobs.keys()],
		log: () => [...log]
	};
}
