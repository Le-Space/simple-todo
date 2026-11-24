import { test, expect } from '@playwright/test';
import { waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';

/**
 * What a link preview reads: the static HTML, without running anything.
 *
 * LinkedIn, X and the messengers build a preview from a page's own tags, so the
 * app's language switch never reaches them, and LinkedIn has no setting for the
 * language of one. The app's address previews in German; /en/ is the same
 * preview in English, built by english-link-preview.js, for a link shared with
 * somebody who reads no German.
 */

/**
 * @param {string} html
 * @param {string} key
 */
const meta = (html, key) =>
	html.match(new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`))?.[1] ?? null;

test.describe('Link previews', () => {
	test('the app’s address previews in German, and names the English one', async ({ request }) => {
		const html = await (await request.get('/')).text();
		expect(meta(html, 'og:locale')).toBe('de_DE');
		expect(meta(html, 'og:title')).toBe('Vertrauliche Treuhand für delegierte Aufgaben');
		// Declared as what it is: a crawler reads this page as German.
		expect(html).toContain('<html lang="de">');
		expect(html).toContain('hreflang="en" href="https://escrow01.le-space.de/en/"');
	});

	test('/en/ previews in English, under an address of its own', async ({ request }) => {
		const response = await request.get('/en/');
		expect(response.ok()).toBe(true);
		const html = await response.text();

		expect(html).toContain('<html lang="en">');
		expect(meta(html, 'og:locale')).toBe('en_US');
		expect(meta(html, 'og:title')).toBe('Confidential escrow for delegated tasks');
		expect(meta(html, 'twitter:title')).toBe('Confidential escrow for delegated tasks');
		// Its own og:url and canonical: LinkedIn follows the canonical, and one
		// pointing at / would fetch the German preview after all.
		expect(meta(html, 'og:url')).toBe('https://escrow01.le-space.de/en/');
		expect(html).toContain('<link rel="canonical" href="https://escrow01.le-space.de/en/" />');
		// A script redirect, which a crawler does not run; a refresh it might follow.
		expect(html).not.toContain('http-equiv="refresh"');

		expect(meta(html, 'og:image')).toBe('https://escrow01.le-space.de/og/escrow01-en.jpg');
		const card = await request.get('/og/escrow01-en.jpg');
		expect(card.ok()).toBe(true);
		expect(card.headers()['content-type']).toContain('image/jpeg');
	});

	test('a German browser that follows /en/ gets the app in English, at the plain address', async ({
		browser
	}) => {
		const context = await browser.newContext({ locale: 'de-DE' });
		const page = await context.newPage();
		try {
			await page.goto('/en/');
			await waitForConsent(page);
			await expect(page.getByTestId('consent-proceed')).toHaveText('Create a passkey and start');
			expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
			// Taken from the address and removed from it: a later switch of the flag
			// is not undone by a reload, and a copied address is the plain one.
			// Polled: the layout takes it out once the router runs, which can be
			// after the dialog has opened.
			await expect.poll(() => new URL(page.url()).searchParams.has('lang')).toBe(false);
			expect(new URL(page.url()).pathname).toBe('/');
			// And nothing was written down for it before anybody agreed to anything.
			expect(await page.evaluate(() => localStorage.getItem('simpleTodo.locale'))).toBeNull();
		} finally {
			await context.close();
		}
	});

	test('?lang=de opens the app in German in an English browser', async ({ browser }) => {
		const context = await browser.newContext({ locale: 'en-US' });
		const page = await context.newPage();
		try {
			await page.goto('/?lang=de');
			await waitForConsent(page);
			await expect(page.getByTestId('consent-proceed')).toHaveText('Passkey anlegen und starten');
			expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
		} finally {
			await context.close();
		}
	});
});
