/**
 * Does the relay replicate a todo without being asked to? (Le-Space/simple-todo#64)
 *
 * Two browsers share the default list through the local relay, as
 * default-database-collaboration.spec.js does. Alice writes todos one at a
 * time; for each one this records when its relay chip settled and on what,
 * in both browsers, when it reached Bob, and how many stream resets the pages
 * saw. At the end it reads what the relay itself reports. RELAY_PROOF_MODE
 * picks the arm: `sync` (today's proof, POST /pinning/sync every round) or
 * `observe` (POST /pinning/has-entry only). One run is one arm;
 * relay-proof-experiment.sh alternates them and relay-proof-summary.mjs adds
 * the runs up.
 *
 *   RELAY_PROOF_MODE=observe pnpm exec playwright test -c playwright.relay-proof.config.js
 *
 * Not part of `test:e2e`. The relay must be a build of orbitdb-relay main at
 * or after NiKrause/orbitdb-relay#60 (E2E_RELAY_CLI_PATH): the one in
 * node_modules hangs up on browsers during the fresh pass that `sync` asks for,
 * which would be measured as the relay's weakness rather than the proof's.
 */
import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';

const MODE = process.env.RELAY_PROOF_MODE === 'observe' ? 'observe' : 'sync';
const TODOS = Number(process.env.RELAY_PROOF_TODOS || 5);
const LABEL = (process.env.BENCH_LABEL ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
/** The proof's own budget is 60 s; a little more lets the chip repaint. */
const SETTLE_TIMEOUT_MS = 70_000;
const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 250;

/** @typedef {{ status: string, t: number }} Transition */

test.describe('relay proof mode', () => {
	test(`todos settle on the relay chip in ${MODE} mode`, async ({ browser }) => {
		test.setTimeout(READY_TIMEOUT_MS * 2 + TODOS * (SETTLE_TIMEOUT_MS + 10_000));

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		for (const context of [aliceContext, bobContext]) {
			// The build reads this in E2E builds only (relay-proof.js); one build
			// serves both arms.
			await context.addInitScript((mode) => {
				localStorage.setItem('relay-proof-mode', mode);
			}, MODE);
		}
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();
		const errors = { alice: watchErrors(alice), bob: watchErrors(bob) };

		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		/** @type {Record<string, unknown>} */
		const result = {
			date: new Date().toISOString(),
			mode: MODE,
			...(LABEL ? { label: LABEL } : {}),
			machine: {
				cpus: cpus()[0]?.model ?? '?',
				cores: cpus().length,
				memGB: Math.round(totalmem() / 2 ** 30)
			},
			relay: await relayInfo(),
			todos: /** @type {Record<string, unknown>[]} */ ([])
		};

		try {
			const tStart = Date.now();
			await Promise.all([openReadyApp(alice), openReadyApp(bob)]);
			const [alicePeerId, bobPeerId] = await Promise.all([getPeerId(alice), getPeerId(bob)]);
			const met = await peersMeet(alice, bobPeerId, bob, alicePeerId);
			result.setup = { readyMs: Date.now() - tStart, peersMet: met, alicePeerId, bobPeerId };

			for (let i = 1; i <= TODOS; i++) {
				const text = `alice-${runId}-todo-${i}`;
				const t0 = Date.now();
				await getTodoInput(alice).fill(text);
				await alice.getByRole('button', { name: 'Add TODO' }).click();
				const [aliceChip, bobArrival] = await Promise.all([
					settleOfChip(alice, text, t0),
					arrivalAt(bob, text, t0)
				]);
				// Bob proves what he received, too — that is today's app, on both sides.
				const bobChip = bobArrival.arrivedMs == null ? null : await settleOfChip(bob, text, t0);
				const todo = {
					i,
					alice: aliceChip,
					bob: { ...bobArrival, chip: bobChip },
					connections: {
						alice: await connectedPeers(alice),
						bob: await connectedPeers(bob)
					}
				};
				/** @type {Record<string, unknown>[]} */ (result.todos).push(todo);
				console.log(
					`todo ${i}: alice chip ${aliceChip.final} after ${aliceChip.settledMs ?? '-'} ms, ` +
						`bob got it after ${bobArrival.arrivedMs ?? '-'} ms, bob chip ${bobChip?.final ?? '-'}`
				);
			}

			result.relayAfter = await relayState(result.relay);
			result.errors = {
				alice: summariseErrors(errors.alice),
				bob: summariseErrors(errors.bob)
			};
		} finally {
			await bobContext.close();
			await aliceContext.close();
			await keep(result);
		}

		expect(/** @type {unknown[]} */ (result.todos)).toHaveLength(TODOS);
	});
});

/** @param {import('@playwright/test').Page} page */
function watchErrors(page) {
	/** @type {Array<{ name: string, message: string }>} */
	const list = [];
	page.on('pageerror', (error) => list.push({ name: error.name, message: error.message }));
	return list;
}

/** @param {Array<{ name: string, message: string }>} list */
function summariseErrors(list) {
	/** @type {Record<string, number>} */
	const byName = {};
	for (const e of list) byName[e.name] = (byName[e.name] ?? 0) + 1;
	return {
		total: list.length,
		streamResets: list.filter((e) => e.name === 'StreamResetError').length,
		byName
	};
}

/**
 * The chip of one todo, polled until it settles: every status it showed and
 * when, the final one, and the time to it. `pending` and `unknown` are not
 * final while the budget runs; `unknown` after the budget is how the proof
 * gives up.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {number} t0
 */
async function settleOfChip(page, text, t0) {
	const chip = page
		.getByTestId('todo-item')
		.filter({ has: page.getByText(text, { exact: true }) })
		.getByTestId('todo-relay-status');
	/** @type {Transition[]} */
	const transitions = [];
	let last = '';
	let budgetOver = false;
	while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
		const status = (await chip.getAttribute('data-status').catch(() => null)) ?? 'absent';
		const t = Date.now() - t0;
		if (status !== last) {
			transitions.push({ status, t });
			last = status;
		}
		if (status === 'pinned' || status === 'unavailable') break;
		budgetOver = t > 60_000;
		if (status === 'unknown' && budgetOver && transitions.length > 1) break;
		await page.waitForTimeout(POLL_MS);
	}
	const final = last || 'absent';
	return {
		final,
		settledMs:
			final === 'pinned' || final === 'unavailable' ? (transitions.at(-1)?.t ?? null) : null,
		transitions
	};
}

/**
 * When the todo text became visible on the other browser.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {number} t0
 */
async function arrivalAt(page, text, t0) {
	const locator = page.getByText(text, { exact: true });
	while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
		if (await locator.isVisible().catch(() => false)) return { arrivedMs: Date.now() - t0 };
		await page.waitForTimeout(POLL_MS);
	}
	return { arrivedMs: null };
}

/** @param {import('@playwright/test').Page} page */
async function openReadyApp(page) {
	await page.goto('/');
	await passConsent(page);
	await expect(getTodoInput(page)).toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout: READY_TIMEOUT_MS });
}

/** @param {import('@playwright/test').Page} page */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}

/** @param {import('@playwright/test').Page} page */
async function getPeerId(page) {
	await expect
		.poll(() => page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null), {
			timeout: READY_TIMEOUT_MS
		})
		.toBeTruthy();
	return /** @type {Promise<string>} */ (page.evaluate(() => window.__simpleTodoE2E.getPeerId()));
}

/** @param {import('@playwright/test').Page} page */
function connectedPeers(page) {
	return page.evaluate(() => window.__simpleTodoE2E?.getConnectedPeerIds?.() ?? []);
}

/**
 * Whether the two browsers see each other within the ready timeout. Not a
 * precondition — a run where they never meet is a result too.
 *
 * @param {import('@playwright/test').Page} alice
 * @param {string} bobPeerId
 * @param {import('@playwright/test').Page} bob
 * @param {string} alicePeerId
 */
async function peersMeet(alice, bobPeerId, bob, alicePeerId) {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const [a, b] = await Promise.all([connectedPeers(alice), connectedPeers(bob)]);
		if (a.includes(bobPeerId) && b.includes(alicePeerId)) return true;
		await alice.waitForTimeout(POLL_MS);
	}
	return false;
}

/** What start-e2e-server.mjs wrote about the relay it started. */
async function relayInfo() {
	try {
		return JSON.parse(await readFile(new URL('./relay-info.json', import.meta.url), 'utf8'));
	} catch {
		return null;
	}
}

/**
 * The relay's own account, read-only: its stats and database listing.
 *
 * @param {any} info
 */
async function relayState(info) {
	const origin = info?.httpOrigin;
	if (!origin) return null;
	const get = async (/** @type {string} */ path) => {
		try {
			const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
			return response.ok ? await response.json() : { status: response.status };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	};
	return { stats: await get('/pinning/stats'), databases: await get('/pinning/databases') };
}

/** @param {Record<string, unknown>} result */
async function keep(result) {
	const dir = new URL('./results/', import.meta.url);
	await mkdir(dir, { recursive: true });
	const stamp = String(result.date).replace(/[:.]/g, '-');
	const file = new URL(`relay-proof-${stamp}-${MODE}${LABEL ? `-${LABEL}` : ''}.json`, dir);
	await writeFile(file, JSON.stringify(result, null, '\t') + '\n');
	console.log(`kept ${file.pathname}`);
}
