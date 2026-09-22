import { test, expect } from '@playwright/test';
import { acceptNotice, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import {
	iceServersAsked,
	introSectionShown,
	recordPeerConnections
} from '@simple-todo/e2e-kit/network-check.mjs';

// main offers the WebRTC-QR handover, so its consent dialog keeps the network
// check -- but the check asks STUN servers at Google and Cloudflare for the
// reader's address, and it waits for the statement to be accepted.
test('the network check waits for consent, then measures with STUN', async ({ page }) => {
	await recordPeerConnections(page);
	await page.goto('/');
	await waitForConsent(page);
	await page.waitForTimeout(3000);

	expect(await iceServersAsked(page)).toEqual([]);
	expect(await introSectionShown(page, 'consent-modal', '.check')).toBe(false);

	await acceptNotice(page);

	await expect.poll(() => iceServersAsked(page)).not.toEqual([]);
	expect((await iceServersAsked(page)).every((url) => url.startsWith('stun:'))).toBe(true);
	await expect.poll(() => introSectionShown(page, 'consent-modal', '.check')).toBe(true);
});
