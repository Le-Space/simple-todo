/**
 * The LED under the list's name says how the other browser on the list is
 * reached: directly over WebRTC, only through the relay, or not at all. It is
 * in the simple view, so these tests never open the technical one.
 *
 * Each test checks the LED against what libp2p itself reports for the other
 * browser: an unlimited WebRTC connection for "direct", and only limited
 * (circuit) connections for "relay". An LED that agreed with itself would
 * prove nothing.
 */
import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';

const timeout = 90000;

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {{ mnemonic: string, webrtc: boolean }} options
 */
async function openBrowser(browser, { mnemonic, webrtc }) {
	const context = await browser.newContext();
	if (!webrtc) {
		// The app reads this at start; kept storage, so the reading reaches it.
		await context.addInitScript(() => {
			try {
				localStorage.setItem('simpleTodo.webrtcEnabled', 'false');
			} catch {
				// Storage blocked; the LED would then show "direct" and fail below.
			}
		});
	}
	const page = await context.newPage();
	await page.goto('/');
	await passConsent(page, { mnemonic, ...(webrtc ? {} : { persistent: true }) });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
	return { context, page };
}

/** @param {import('@playwright/test').Page} page */
const led = (page) => page.getByTestId('list-peer-led');

/** @param {import('@playwright/test').Page} page */
const peerId = (page) => page.evaluate(() => window.__simpleTodoE2E.getPeerId());

/**
 * What libp2p reports for the connections to one peer.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} remotePeer
 */
const connectionsTo = (page, remotePeer) =>
	page.evaluate(
		(peer) =>
			(window.__simpleTodoE2E?.getConnections?.() ?? []).filter(
				(/** @type {any} */ connection) => connection.remotePeer === peer
			),
		remotePeer
	);

test.describe('The LED under the list name', () => {
	test('turns green when the other browser on the list is connected over WebRTC', async ({
		browser
	}) => {
		test.setTimeout(timeout * 3);
		const mnemonic = 'luna-camino-verde';
		const alice = await openBrowser(browser, { mnemonic, webrtc: true });
		let bob;
		try {
			// Alone first: the relay is on the list too, but it is not a browser.
			await expect(led(alice.page)).toHaveAttribute('data-state', 'alone', { timeout });
			await expect(led(alice.page)).toContainText('No other browser in this list');

			bob = await openBrowser(browser, { mnemonic, webrtc: true });
			for (const page of [alice.page, bob.page]) {
				await expect(led(page)).toHaveAttribute('data-state', 'direct', { timeout });
				await expect(led(page)).toHaveAttribute('data-direct', '1');
				await expect(led(page)).toContainText('Direct P2P with 1 browser');
				await expect(led(page)).toBeVisible();
				// Green text (identity-800), not the link cyan app.css gives every <a>.
				await expect(led(page)).toHaveCSS('color', 'rgb(21, 94, 66)');
			}

			// Checked against libp2p: an unlimited WebRTC connection to the other browser.
			const [aliceId, bobId] = await Promise.all([peerId(alice.page), peerId(bob.page)]);
			for (const [page, other] of [
				[alice.page, bobId],
				[bob.page, aliceId]
			]) {
				const connections = await connectionsTo(page, other);
				expect(
					connections.some(
						(/** @type {any} */ connection) =>
							!connection.limited &&
							connection.remoteAddr.includes('/webrtc') &&
							!connection.remoteAddr.includes('/webrtc-direct')
					),
					JSON.stringify(connections)
				).toBe(true);
			}
		} finally {
			await bob?.context.close();
			await alice.context.close();
		}
	});

	test('turns amber when the other browser can only be reached through the relay', async ({
		browser
	}) => {
		test.setTimeout(timeout * 3);
		const mnemonic = 'mar-pájaro-tren';
		const alice = await openBrowser(browser, { mnemonic, webrtc: false });
		let bob;
		try {
			bob = await openBrowser(browser, { mnemonic, webrtc: false });
			for (const page of [alice.page, bob.page]) {
				await expect(led(page)).toHaveAttribute('data-state', 'relay', { timeout });
				await expect(led(page)).toHaveAttribute('data-relayed', '1');
				await expect(led(page)).toContainText('Via the relay with 1 browser');
				// Amber text (data-800), not the link cyan.
				await expect(led(page)).toHaveCSS('color', 'rgb(111, 78, 19)');
			}

			// Checked against libp2p: no unlimited connection to the other browser,
			// so nothing it shows can have come directly.
			const [aliceId, bobId] = await Promise.all([peerId(alice.page), peerId(bob.page)]);
			for (const [page, other] of [
				[alice.page, bobId],
				[bob.page, aliceId]
			]) {
				const connections = await connectionsTo(page, other);
				expect(
					connections.every((/** @type {any} */ connection) => connection.limited),
					JSON.stringify(connections)
				).toBe(true);
				await expect(led(page)).not.toHaveAttribute('data-state', 'direct');
			}
		} finally {
			await bob?.context.close();
			await alice.context.close();
		}
	});
});
