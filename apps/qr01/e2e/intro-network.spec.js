import { test, expect } from '@playwright/test';
import {
	iceServersAsked,
	introSectionShown,
	recordPeerConnections
} from '@simple-todo/e2e-kit/network-check.mjs';

const intro = (/** @type {import('@playwright/test').Page} */ page) =>
	page.getByTestId('intro-dialog');

// qr01 is the WebRTC-QR chapter, so its introduction keeps the network check --
// but the check asks STUN servers for the reader's address, and it waits until
// the statement in the introduction is accepted.
test('the network check waits for the accepted statement, then measures with STUN', async ({
	page
}) => {
	await recordPeerConnections(page);
	await page.goto('/');
	await page.waitForFunction(
		() =>
			/** @type {any} */ (document.querySelector('[data-testid="intro-dialog"]'))?.isOpen === true
	);
	await page.waitForTimeout(3000);

	expect(await iceServersAsked(page)).toEqual([]);
	expect(await introSectionShown(page, 'intro-dialog', '.check')).toBe(false);

	await intro(page).locator('input[part=accept]').check();

	await expect.poll(() => iceServersAsked(page)).not.toEqual([]);
	expect((await iceServersAsked(page)).every((url) => url.startsWith('stun:'))).toBe(true);
	await expect.poll(() => introSectionShown(page, 'intro-dialog', '.check')).toBe(true);
});
