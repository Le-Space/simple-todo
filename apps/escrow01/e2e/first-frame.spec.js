import { test, expect } from '@playwright/test';
import { waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';

/**
 * The first frames of a first visit.
 *
 * Until 2026-11-26 the start dialog arrived in two steps: its content was put
 * on the page with the app, and `<qr-intro>`, the element that makes it a
 * dialog, was fetched only after that. In between — 2.3 s on a slow phone
 * line, measured — the dialog's text stood unstyled at the very top of the
 * page, the app's header below it, and only then did it become the modal over
 * a dimmed app. On escrow01 that was the first thing a visitor saw.
 *
 * What is asserted is what was painted, as near as a page can tell: a sample
 * on every animation frame from the first, which is the moment just before the
 * browser draws. Any frame that has the dialog on the page has it modal, and
 * the app's own content starts at the top, with nothing laid out above it.
 *
 * The page is given a slow round trip, because the old way's gap was one round
 * trip wide: on localhost it may fall between two frames, behind the latency it
 * cannot.
 */

const LATENCY_MS = 150;

/**
 * One sample per animation frame, from before the app's first script runs.
 * Installed before every document; read back with `samplesOf`.
 */
function recordFrames() {
	/** @type {any[]} */
	const samples = [];
	/** @type {any} */ (window).__firstFrames = samples;
	const t0 = performance.now();
	const tick = () => {
		const host = document.querySelector('qr-intro');
		const dialog = host?.shadowRoot?.querySelector('dialog') ?? null;
		const main = document.querySelector('main');
		const splash = document.getElementById('app-splash');
		samples.push({
			t: Math.round(performance.now() - t0),
			dialogOnPage: host !== null,
			defined: customElements.get('qr-intro') !== undefined,
			modal: dialog !== null && dialog.open && dialog.matches(':modal'),
			// The host's own box: zero once upgraded (its dialog is in the top
			// layer), the size of the whole text while it is an ordinary element.
			hostHeight: host ? Math.round(host.getBoundingClientRect().height) : 0,
			mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
			splashShown: splash !== null && getComputedStyle(splash).display !== 'none'
		});
		if (performance.now() - t0 < 20_000) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

/**
 * Every call a page makes for a passkey, so a test can say there were none.
 */
function countPasskeyPrompts() {
	/** @type {any} */ (window).__passkeyPrompts = 0;
	const credentials = navigator.credentials;
	if (!credentials) return;
	for (const name of /** @type {const} */ (['create', 'get'])) {
		const original = credentials[name]?.bind(credentials);
		if (!original) continue;
		credentials[name] = (/** @type {any} */ options) => {
			/** @type {any} */ (window).__passkeyPrompts += 1;
			return original(options);
		};
	}
}

/** @param {import('@playwright/test').Page} page */
const samplesOf = (page) => page.evaluate(() => /** @type {any} */ (window).__firstFrames);

/** @param {import('@playwright/test').Page} page */
async function slowRoundTrips(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Network.enable');
	await cdp.send('Network.emulateNetworkConditions', {
		offline: false,
		latency: LATENCY_MS,
		downloadThroughput: -1,
		uploadThroughput: -1
	});
}

test.describe('First frame', () => {
	test('the start dialog is modal in the first frame that shows it, and nothing stands above the app', async ({
		page
	}) => {
		await page.addInitScript(recordFrames);
		await page.addInitScript(countPasskeyPrompts);
		await slowRoundTrips(page);

		await page.goto('/');
		await waitForConsent(page);
		// A few frames more than the one that opened it.
		await page.waitForTimeout(500);
		const samples = await samplesOf(page);

		const withDialog = samples.filter((/** @type {any} */ s) => s.dialogOnPage);
		expect(withDialog.length, 'frames recorded with the dialog on the page').toBeGreaterThan(0);

		// The bug itself: the dialog's content on the page before `<qr-intro>`
		// could make it a dialog.
		const notModal = withDialog.filter((/** @type {any} */ s) => !s.modal);
		expect(notModal, 'frames with the dialog on the page but not modal').toEqual([]);
		const laidOut = withDialog.filter((/** @type {any} */ s) => s.hostHeight > 0);
		expect(laidOut, 'frames with the dialog laid out in the page').toEqual([]);

		// What the visitor saw of it: the app pushed down by the dialog's text.
		const pushedDown = samples.filter(
			(/** @type {any} */ s) => s.mainTop !== null && s.mainTop > 0
		);
		expect(pushedDown, 'frames with something laid out above the app').toEqual([]);

		// The splash hands over in the same frame, and is never under the dialog.
		const both = withDialog.filter((/** @type {any} */ s) => s.splashShown);
		expect(both, 'frames with the splash and the dialog').toEqual([]);
		await expect(page.locator('#app-splash')).toHaveCount(0);
		await expect(page.locator('#app-root')).not.toHaveAttribute('aria-busy', 'true');

		// Loading never asks for a passkey; only a press on the dialog does.
		expect(await page.evaluate(() => /** @type {any} */ (window).__passkeyPrompts)).toBe(0);
	});

	test('a page whose code never arrives says so, instead of a splash that turns for ever', async ({
		page
	}) => {
		// Nothing of the app is let through: what is left is app.html.
		await page.route('**/_app/immutable/**', (route) => route.abort());
		await page.goto('/');

		const splash = page.getByTestId('app-splash');
		await expect(splash).toHaveAttribute('role', 'status');
		await expect(splash).toContainText('Loading escrow01');
		// Faded in after its wait, not straight away.
		await expect
			.poll(() => splash.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
			.toBe('1');
		await expect(page.locator('#app-root')).toHaveAttribute('aria-busy', 'true');

		// Nothing to focus while it only waits: the reload links are hidden.
		const slow = page.getByTestId('app-splash-slow');
		await expect(slow).toBeHidden();
		await page.keyboard.press('Tab');
		expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('A');

		// Then it says that this is not normal, and offers the way out.
		await expect(slow).toBeVisible({ timeout: 20_000 });
		await expect(slow.getByRole('link', { name: 'Reload' })).toBeVisible();
		await expect(slow.getByRole('link', { name: 'Neu laden' })).toBeVisible();
	});

	test('the splash keeps still for somebody who asked for less motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.route('**/_app/immutable/**', (route) => route.abort());
		await page.goto('/');

		const splash = page.getByTestId('app-splash');
		await expect
			.poll(() => splash.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5_000 })
			.toBe('1');
		const flows = await page
			.locator('#app-splash .flow')
			.evaluateAll((lines) => lines.map((line) => getComputedStyle(line).animationName));
		expect(flows.length).toBeGreaterThan(0);
		expect(flows.every((name) => name === 'none')).toBe(true);
	});
});
