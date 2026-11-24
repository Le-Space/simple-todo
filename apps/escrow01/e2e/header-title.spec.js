import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';

/**
 * The page title keeps its words.
 *
 * The header shares one row between the title, the state (status badges, the
 * auditor's badge, "Back to the todos", the network dot) and the switches. The
 * state used to take the row first, and the title was what gave way: "A…" in
 * the auditor view at 900px, "Confidential esc…" beside "Release confirmed" --
 * at every desktop width, since the page is never wider than 56rem. Found in
 * the demo film's dry run (#136).
 *
 * The long status badge is written into the badge by hand: reaching a real one
 * takes a delegated write, and what is measured here is only whether the row
 * makes room for it without cutting the title.
 */

const timeout = 90000;
const LONG_BADGE = {
	'en-US': 'Read access kept on this device',
	'de-DE': 'Lesezugriff auf diesem Gerät gesichert'
};

/** @param {import('@playwright/test').Page} page */
const titleIsCut = (page) =>
	page
		.getByRole('main')
		.getByRole('heading', { level: 1 })
		.evaluate((heading) => heading.scrollWidth > heading.clientWidth);

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
const showBadge = (page, text) =>
	page.getByTestId('delegated-auth-state').evaluate((badge, label) => {
		badge.classList.remove('hidden');
		badge.textContent = label;
	}, text);

for (const viewport of [
	{ width: 900, height: 800 },
	{ width: 390, height: 844 }
]) {
	for (const locale of /** @type {const} */ (['en-US', 'de-DE'])) {
		test(`the title keeps its words at ${viewport.width}px (${locale})`, async ({ browser }) => {
			test.setTimeout(timeout * 2);
			const context = await browser.newContext({ viewport, locale });
			const page = await context.newPage();
			try {
				await page.goto('/');
				await passConsent(page, { identity: 'anonymous' });
				await expect(page.locator('main input[type="text"]').first()).toBeEnabled({ timeout });

				for (const section of ['#aufgaben', '#pruefstelle']) {
					await page.evaluate((hash) => (location.hash = hash), section);
					await expect(page.getByTestId('section-aufgaben')).toBeAttached();
					await page.waitForTimeout(200);
					expect(await titleIsCut(page), `${section}`).toBe(false);
					await showBadge(page, LONG_BADGE[locale]);
					expect(await titleIsCut(page), `${section} with a status badge`).toBe(false);
				}
			} finally {
				await context.close();
			}
		});
	}
}
