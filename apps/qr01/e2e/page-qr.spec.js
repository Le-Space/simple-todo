import { test, expect } from '@playwright/test';
import { expectPageQr, freshListWords, readListLink } from '@simple-todo/e2e-kit/page-qr.mjs';
import { openListTab, openReadyApp, pinTechnicalView } from './open-app.mjs';

const timeout = 90000;

// The open list travels in the fragment, and the page QR carries the fragment:
// scanned on a phone, it opens this chapter *and* this list. The WebRTC codes
// of this chapter are something else — an offer and its answer — and stay so.
test.describe('Page QR and list link', () => {
	test('a link with three words opens that list straight away, and the code carries it on', async ({
		page
	}) => {
		test.setTimeout(timeout * 2);
		const words = freshListWords();
		await pinTechnicalView(page);
		// No dialog in this chapter: the link's list is simply the one it starts with.
		await openReadyApp(page, { url: `/#list=${encodeURIComponent(words)}` });

		await expect(page.getByTestId('active-shared-list-name')).toHaveText(words, { timeout });
		await expect.poll(() => readListLink(page.url()).words).toBe(words);
		const url = await expectPageQr(page, expect);
		expect(readListLink(url).words).toBe(words);
	});

	test('a private list goes into the link', async ({ page }) => {
		test.setTimeout(timeout * 2);
		await pinTechnicalView(page);
		await openReadyApp(page);

		await openListTab(page, 'create');
		await page.getByTestId('new-list-name').fill(`linked-${Date.now().toString(36)}`);
		await page.getByTestId('new-list-create').click();
		await expect(page.getByTestId('new-list-created')).toBeVisible({ timeout });
		const address = (await page.getByTestId('new-list-created-address').textContent())?.trim();

		await expect.poll(() => readListLink(page.url()).address).toBe(address);
		const url = await expectPageQr(page, expect);
		expect(readListLink(url).address).toBe(address);
	});
});
