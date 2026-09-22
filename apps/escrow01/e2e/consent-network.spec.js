import { test, expect } from '@playwright/test';
import { waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import {
	iceServersAsked,
	introCaveats,
	introSectionShown,
	recordPeerConnections
} from '@simple-todo/e2e-kit/network-check.mjs';

// escrow01 connects through a relay. The consent dialog is the WebRTC-QR
// element, whose network check is about a direct connection this chapter never
// makes -- and used to ask STUN servers at Google and Cloudflare for the
// reader's address before anybody had agreed to anything. Its caveat list
// stays, carrying what this chapter is made of instead.
for (const [locale, heading, first] of [
	['en-US', 'Under the hood', 'Passkey: a WebAuthn key with ES256 (P-256)'],
	['de-DE', 'Unter der Haube', 'Passkey: ein WebAuthn-Schlüssel mit ES256 (P-256)']
]) {
	test.describe(locale, () => {
		test.use({ locale });

		test('asks no STUN server, and the technical view explains the stack', async ({ page }) => {
			await recordPeerConnections(page);
			await page.addInitScript(() => localStorage.setItem('simpleTodo.technicalView', 'true'));
			await page.goto('/');
			await waitForConsent(page);
			// The element measures on its first open; give it the time it takes.
			await page.waitForTimeout(3000);

			expect(await iceServersAsked(page)).toEqual([]);
			expect(await introSectionShown(page, 'consent-modal', '.check')).toBe(false);
			expect(await introSectionShown(page, 'consent-modal', '.tech')).toBe(true);
			// The measured addresses sit inside the caveats; they go with the check.
			expect(await introSectionShown(page, 'consent-modal', '.tech .details')).toBe(false);

			const caveats = await introCaveats(page, 'consent-modal');
			expect(caveats.heading).toBe(heading);
			expect(caveats.lines).toHaveLength(10);
			expect(caveats.lines[0].startsWith(first)).toBe(true);
			// Nothing of the element's own WebRTC notes is left.
			expect(caveats.lines.join(' ')).not.toMatch(/Carrier|DuckDuckGo|VPN/);
		});
	});
}
