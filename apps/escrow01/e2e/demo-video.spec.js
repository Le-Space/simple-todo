import { test, expect } from '@playwright/test';
import { isConsentOpen, passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';

/**
 * The demo video: a teaser in the start dialog's top row, a link in the page
 * header, and one player over either.
 *
 * Until the video exists there is nothing to see, so these tests hand the
 * page entries of their own before it loads (`__escrow01DemoVideos`, read by
 * E2E builds only) and answer the files themselves. What they guard:
 *
 * - no entry, nothing on screen;
 * - before a click only the poster is fetched: no video, no captions, and
 *   nothing from YouTube, which is a plain link;
 * - the player is its own dialog over the start dialog, Escape closes only
 *   the player, and watching is not consent.
 */

const timeout = 90000;
const FILES = '/__demo-video-test';
// A 1x1 PNG.
const POSTER = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

/** @param {import('@playwright/test').Page} page */
/**
 * @param {import('@playwright/test').Page} page
 * @param {{ de?: boolean }} [options] an entry for German too
 */
async function withVideos(page, { de = false } = {}) {
	await page.addInitScript(
		({ files, de }) => {
			const entry = (/** @type {string} */ language) => ({
				src: `${files}/escrow01-${language}.mp4`,
				poster: `${files}/escrow01-${language}.png`,
				thumb: `${files}/escrow01-${language}-thumb.png`,
				captions: `${files}/escrow01-${language}.vtt`,
				youtubeId: 'dQw4w9WgXcQ',
				duration: '1:30'
			});
			/** @type {any} */ (globalThis).__escrow01DemoVideos = {
				en: entry('en'),
				de: de ? entry('de') : null
			};
		},
		{ files: FILES, de }
	);
	/** @type {string[]} */
	const fetched = [];
	await page.route(`**${FILES}/**`, (route) => {
		const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
		fetched.push(name);
		if (name.endsWith('.png')) {
			return route.fulfill({ contentType: 'image/png', body: POSTER });
		}
		if (name.endsWith('.vtt')) {
			return route.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n' });
		}
		return route.fulfill({ status: 404, body: '' });
	});
	const google = [];
	page.on('request', (request) => {
		if (/youtube|google|ytimg/.test(new URL(request.url()).hostname)) google.push(request.url());
	});
	return { fetched, google };
}

const player = (/** @type {import('@playwright/test').Page} */ page) =>
	page.getByTestId('demo-video-player');
const playerOpen = (/** @type {import('@playwright/test').Page} */ page) =>
	player(page).evaluate((dialog) => /** @type {HTMLDialogElement} */ (dialog).open);

test.describe('Demo video', () => {
	test('without an entry for the language, there is no teaser and no link', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);
		await expect(page.getByTestId('demo-video-teaser')).toHaveCount(0);
		await expect(page.getByTestId('demo-video-link')).toHaveCount(0);
		await expect(player(page)).toHaveCount(0);
	});

	test('the teaser plays over the start dialog; Escape closes only the player', async ({
		page
	}) => {
		const { fetched, google } = await withVideos(page);
		await page.goto('/');
		await waitForConsent(page);

		const teaser = page.getByTestId('demo-video-teaser');
		await expect(teaser).toBeVisible();
		await expect(teaser).toHaveAccessibleName('How it works, 1:30');
		await expect(teaser).toContainText('How it works · 1:30');
		// In the row of the switches, left of them.
		const [teaserBox, switchBox] = await Promise.all([
			teaser.boundingBox(),
			page.getByTestId('consent-modal').getByTestId('language-en').boundingBox()
		]);
		expect(
			Math.abs(
				(teaserBox?.y ?? 0) +
					(teaserBox?.height ?? 0) / 2 -
					((switchBox?.y ?? 0) + (switchBox?.height ?? 0) / 2)
			)
		).toBeLessThan(8);
		expect(teaserBox?.x ?? 0).toBeLessThan(switchBox?.x ?? 0);

		// Before the click: the teaser's own small picture, and nothing else of
		// the video -- not even the player's poster.
		await expect.poll(() => fetched).toContain('escrow01-en-thumb.png');
		expect(fetched.filter((name) => name !== 'escrow01-en-thumb.png')).toEqual([]);

		await teaser.click();
		await expect.poll(() => playerOpen(page)).toBe(true);
		await expect(player(page).getByTestId('demo-video')).toHaveAttribute('preload', 'none');
		await expect(player(page).locator('track')).toHaveAttribute('srclang', 'en');
		await expect(player(page).getByTestId('demo-video-youtube')).toHaveAttribute(
			'href',
			'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
		);
		await expect(player(page).getByTestId('demo-video-close')).toBeFocused();

		await page.keyboard.press('Escape');
		await expect.poll(() => playerOpen(page)).toBe(false);
		// The start dialog is still there, nothing was accepted, and the cursor
		// is back on the teaser.
		await page.waitForTimeout(300);
		expect(await isConsentOpen(page)).toBe(true);
		await expect(teaser).toBeFocused();
		await expect(page.getByPlaceholder('What needs to be done?')).toBeDisabled();
		expect(google).toEqual([]);

		// The close button does the same.
		await teaser.click();
		await expect.poll(() => playerOpen(page)).toBe(true);
		await player(page).getByTestId('demo-video-close').click();
		await expect.poll(() => playerOpen(page)).toBe(false);
		expect(await isConsentOpen(page)).toBe(true);
	});

	test('on a phone the teaser is short and adds no height', async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		await withVideos(page);
		await page.goto('/');
		await waitForConsent(page);
		const teaser = page.getByTestId('demo-video-teaser');
		await expect(teaser).toContainText('Video · 1:30');
		await expect(teaser).toHaveAccessibleName('How it works, 1:30');
		const sameRow = await page.evaluate(() => {
			const teaser = document.querySelector('[data-testid="demo-video-teaser"]');
			const technical = document.querySelector('[data-testid="consent-technical"]');
			const a = teaser?.getBoundingClientRect();
			const b = technical?.getBoundingClientRect();
			return !!a && !!b && Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 8;
		});
		expect(sameRow).toBe(true);
		await context.close();
	});

	test('a language without a video shows none, rather than the other one', async ({ browser }) => {
		const context = await browser.newContext({ locale: 'de-DE' });
		const page = await context.newPage();
		await withVideos(page);
		await page.goto('/');
		await waitForConsent(page);
		await expect(page.getByTestId('demo-video-teaser')).toHaveCount(0);
		await context.close();
	});

	for (const locale of ['en-US', 'de-DE']) {
		test(`on a phone the header link leaves the title whole (${locale})`, async ({ browser }) => {
			test.setTimeout(timeout * 2);
			const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
			const page = await context.newPage();
			try {
				await withVideos(page, { de: true });
				await page.goto('/');
				await passConsent(page);
				await expect(page.locator('main input[type="text"]').first()).toBeEnabled({ timeout });
				await expect(page.getByTestId('demo-video-link')).toBeVisible();
				// The heading truncates with an ellipsis; beside the switches, the
				// link cut the German "Treuhand" down to "Treuh…".
				const cut = await page
					.getByRole('main')
					.getByRole('heading', { level: 1 })
					.evaluate((heading) => heading.scrollWidth > heading.clientWidth);
				expect(cut).toBe(false);
			} finally {
				await context.close();
			}
		});
	}

	test('the header link opens the same player over the app', async ({ page }) => {
		test.setTimeout(timeout * 2);
		await withVideos(page);
		await page.goto('/');
		await passConsent(page);
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

		const link = page.getByTestId('demo-video-link');
		await expect(link).toBeVisible();
		await link.click();
		await expect.poll(() => playerOpen(page)).toBe(true);
		await page.keyboard.press('Escape');
		await expect.poll(() => playerOpen(page)).toBe(false);
		await expect(link).toBeFocused();
	});
});
