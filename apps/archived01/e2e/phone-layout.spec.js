import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';

// Chapter (archived01): the page fits a phone after the consent screen.
//
// The header's right-hand group — DID badge, language flags, theme, page QR,
// social icons — grew past a phone's width, the page scrolled sideways, and
// pinch-zoom was the only way to see all of it (2026-10-17, a Fold). The
// group wraps now; this measures that nothing is wider than the viewport.

const readyTimeout = 90000;

test('nothing is wider than a phone after consent', async ({ browser }) => {
	test.setTimeout(readyTimeout * 2);
	const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
	const page = await context.newPage();
	try {
		await page.goto('/');
		await passConsent(page, { identity: 'anonymous', p2p: false });
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({
			timeout: readyTimeout
		});
		const widths = await page.evaluate(() => ({
			viewport: window.innerWidth,
			document: document.documentElement.scrollWidth,
			header: document.querySelector('header')?.scrollWidth ?? 0
		}));
		expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
		expect(widths.header).toBeLessThanOrEqual(widths.viewport);
	} finally {
		await context.close();
	}
});
