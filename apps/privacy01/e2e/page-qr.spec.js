import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { expectPageQr, freshListWords, readListLink } from '@simple-todo/e2e-kit/page-qr.mjs';

const timeout = 90000;

// The open list travels in the fragment, and the page QR carries the fragment:
// scanned on a phone, it opens this chapter *and* this list.
test.describe('Page QR and list link', () => {
	test('a link with three words opens that list, and the code carries it on', async ({ page }) => {
		test.setTimeout(timeout * 2);
		const words = freshListWords();
		await page.goto(`/#list=${encodeURIComponent(words)}`);
		// The words arrive in the dialog, where the reader sees them before joining.
		await expect(page.getByTestId('shared-list-mnemonic-input')).toHaveValue(words);
		await passConsent(page);

		await expect(page.getByTestId('active-shared-list-name')).toHaveText(words, { timeout });
		await expect.poll(() => readListLink(page.url()).words).toBe(words);
		const url = await expectPageQr(page, expect);
		expect(readListLink(url).words).toBe(words);
	});

	test('a private list goes into the link, and the link opens it in another browser', async ({
		browser
	}) => {
		test.setTimeout(timeout * 4);
		const ownerContext = await browser.newContext();
		const guestContext = await browser.newContext();
		const owner = await ownerContext.newPage();
		const guest = await guestContext.newPage();
		try {
			await owner.goto('/');
			await passConsent(owner);
			await expect(owner.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
			await owner.getByTestId('new-list-name').fill(`linked-${Date.now().toString(36)}`);
			await owner.getByTestId('new-list-create').click();
			await expect(owner.getByTestId('new-list-created')).toBeVisible({ timeout });
			const address = (await owner.getByTestId('new-list-created-address').textContent())?.trim();
			expect(address).toMatch(/^\/orbitdb\/z/);

			await expect.poll(() => readListLink(owner.url()).address).toBe(address);
			const url = await expectPageQr(owner, expect);
			expect(readListLink(url).address).toBe(address);

			// What a phone does with the code: open the URL, agree, and land in the list.
			await guest.goto(url);
			await passConsent(guest);
			await expect(guest.getByTestId('active-database-address')).toHaveText(String(address), {
				timeout
			});
			expect(readListLink(guest.url()).address).toBe(address);
		} finally {
			await ownerContext.close();
			await guestContext.close();
		}
	});
});
