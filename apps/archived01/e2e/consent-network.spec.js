import { test, expect } from '@playwright/test';
import { waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import {
	iceServersAsked,
	introSectionShown,
	recordPeerConnections
} from '@simple-todo/e2e-kit/network-check.mjs';

// This chapter connects through a relay. The consent dialog is the WebRTC-QR
// element, whose network check and caveats are about a direct connection this
// chapter never makes -- and whose check used to ask STUN servers at Google and
// Cloudflare for the reader's address before anybody had agreed to anything.
test('the consent dialog asks no STUN server and says nothing about WebRTC-QR', async ({
	page
}) => {
	await recordPeerConnections(page);
	await page.goto('/');
	await waitForConsent(page);
	// The technical view is where the caveats would show.
	await page.evaluate(() => {
		/** @type {any} */ (document.querySelector('[data-testid="consent-modal"]')).technical = true;
	});
	// The element measures on its first open; give it the time it takes.
	await page.waitForTimeout(3000);

	expect(await iceServersAsked(page)).toEqual([]);
	expect(await introSectionShown(page, 'consent-modal', '.check')).toBe(false);
	expect(await introSectionShown(page, 'consent-modal', '.tech')).toBe(false);
});
