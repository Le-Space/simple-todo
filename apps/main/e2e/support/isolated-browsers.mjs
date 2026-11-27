/**
 * Browsers that reach only what a spec starts for them.
 *
 * The heads-exchange specs measure `@orbitdb/core`, so nothing else may carry
 * an entry: not the suite's `orbitdb-relay`, which pins every database, and not
 * the public relays. Those hold the public `simple-todos` - the same address,
 * since name, type and access controller are the same - and the app dials
 * them on its own: when no relay the build knows has answered for 20 seconds
 * (`RELAY_RECOVERY_GRACE_MS` in `+page.svelte`), it asks the Aleph directory.
 * Blocking the suite's relay is therefore what triggers that, and an unpatched
 * run once went green because a public relay delivered the entry.
 *
 * So a context here may reach the preview server and the WebSockets it is
 * given, and nothing else, and `foreignConnections` lets a spec refuse a run in
 * which a browser met anyone it did not start.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';

import { chapterPorts } from '@simple-todo/e2e-kit/chapter-ports.mjs';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';

export const timeout = 90000;

/** gossipsub keeps a message for a few heartbeats (one second each); wait well past that. */
export const GOSSIP_FORGETS_MS = 8000;

/**
 * Start a helper from this folder and wait for the `READY {json}` line it
 * prints once it listens.
 *
 * @param {string} script - file name in `e2e/support/`
 * @param {string[]} [args]
 * @returns {Promise<Record<string, any> & { stop: () => Promise<void> }>}
 */
export async function startHelper(script, args = []) {
	const child = spawn(
		process.execPath,
		[fileURLToPath(new URL(`./${script}`, import.meta.url)), ...args],
		{ stdio: ['ignore', 'pipe', 'pipe'] }
	);
	child.stderr.on('data', (data) => process.stderr.write(`[${script}] ${data}`));

	const ready = await new Promise((resolve, reject) => {
		let buffer = '';
		const timer = setTimeout(() => reject(new Error(`${script} did not start`)), 60000);
		child.on('exit', (code) => reject(new Error(`${script} exited (${code})`)));
		child.stdout.on('data', (data) => {
			buffer += data;
			const line = buffer.split('\n').find((l) => l.startsWith('READY '));
			if (line) {
				clearTimeout(timer);
				resolve(JSON.parse(line.slice('READY '.length)));
			}
		});
	});

	return {
		...ready,
		stop: async () => {
			if (child.exitCode != null) return;
			child.kill('SIGTERM');
			await new Promise((resolve) => child.once('exit', resolve));
		}
	};
}

/** @param {string} address - a `/ip4/…/tcp/<port>/ws/…` multiaddr */
export function wsPort(address) {
	const port = address.match(/\/tcp\/(\d+)\/ws/)?.[1];
	if (!port) throw new Error(`no WebSocket port in ${address}`);
	return port;
}

/**
 * A browser context that reaches the preview server and the given WebSocket
 * ports on this machine, and nothing else.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string[]} webSocketPorts
 */
export async function isolatedContext(browser, webSocketPorts) {
	const local = new Set(['localhost', '127.0.0.1']);
	const previewPort = String(chapterPorts().preview);
	const allowed = new Set(webSocketPorts.map(String));

	const context = await browser.newContext();
	await context.routeWebSocket(
		(url) => !(local.has(url.hostname) && allowed.has(url.port)),
		(ws) => ws.close()
	);
	await context.route(
		(url) => !(local.has(url.hostname) && url.port === previewPort),
		(route) => route.abort()
	);
	return context;
}

/**
 * Open the app with WebRTC off, so that two browsers can meet only over a
 * circuit, and with the relay proof in `observe` mode. In `sync` mode the
 * proof restarts Sync (`todoDB.sync.stop(); todoDB.sync.start()`) for up to a
 * minute after a write, and every restart is a fresh subscription for the
 * other side - an app-level re-arm that would hide the gaps measured here.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openIsolatedApp(page) {
	await page.addInitScript(() => {
		// Seeded on the device, so the app has to be in the mode that reads it.
		localStorage.setItem('simpleTodo.persistentStorageEnabled', 'true');
		localStorage.setItem('simpleTodo.webrtcEnabled', 'false');
		localStorage.setItem('relay-proof-mode', 'observe');
	});
	await page.goto('/');
	await passConsent(page, { relay: true });
	await expect(getTodoInput(page)).toBeEnabled({ timeout });
	expect(await page.evaluate(() => window.__simpleTodoE2E.getWebRTCEnabled())).toBe(false);
}

/**
 * Connections a browser opened during the run to anyone it was not meant to
 * meet.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Set<string>} known
 */
export async function foreignConnections(page, known) {
	const events = await page.evaluate(() => window.__simpleTodoE2E.getConnectionEvents());
	return events.filter((event) => event.event === 'open' && !known.has(event.peer));
}

/** @param {import('@playwright/test').Page} page @param {string} address */
export async function connect(page, address) {
	await page.evaluate((target) => window.__simpleTodoE2E.connectToMultiaddr(target), address);
}

/** @param {import('@playwright/test').Page} page */
export async function getPeerId(page) {
	await expect
		.poll(() => page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null), { timeout })
		.toBeTruthy();
	return page.evaluate(() => window.__simpleTodoE2E.getPeerId());
}

/** @param {import('@playwright/test').Page} page */
export const databaseAddress = (page) =>
	page.evaluate(() => window.__simpleTodoE2E.getDatabaseAddress());

/** @param {import('@playwright/test').Page} page */
export const databasePeers = (page) =>
	page.evaluate(() => window.__simpleTodoE2E.getDatabasePeers());

/** @param {import('@playwright/test').Page} page */
export const connectionCount = (page) =>
	page.evaluate(() => window.__simpleTodoE2E.getConnectionCount());

/** @param {import('@playwright/test').Page} page */
export const multiaddrs = (page) => page.evaluate(() => window.__simpleTodoE2E.getMultiaddrs());

/** @param {import('@playwright/test').Page} page @param {string} peerId */
export function connectionsTo(page, peerId) {
	return page.evaluate(
		(id) =>
			window.__simpleTodoE2E
				.getConnections()
				.filter((connection) => connection.remotePeer === id)
				.map((connection) => ({
					limited: connection.limited === true,
					multiplexer: connection.multiplexer ?? null
				})),
		peerId
	);
}

/** @param {import('@playwright/test').Page} page */
export const getTodoInput = (page) => page.getByRole('textbox', { name: 'What needs to be done?' });

/** @param {import('@playwright/test').Page} page @param {string} text */
export async function addTodo(page, text) {
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/**
 * Resolve once `text` is visible, or after `ms` without it.
 *
 * @param {import('@playwright/test').Page} page @param {string} text @param {number} ms
 */
export function arrives(page, text, ms) {
	return page
		.getByText(text, { exact: true })
		.waitFor({ state: 'visible', timeout: ms })
		.then(
			() => true,
			() => false
		);
}
