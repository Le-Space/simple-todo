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

	test('a link to a list by address is refused here, not half-followed', async ({ page }) => {
		test.setTimeout(timeout * 2);
		await page.goto('/#db=zdpuAr5JtXNGnPS6Tbsz5gR5Ho2A6CrD7wTzUDtT1N9vpv9mA');
		await passConsent(page);
		await expect(page.getByTestId('active-shared-list-name')).not.toBeEmpty({ timeout });
		// This chapter has only the three-word list, so that is what the link says.
		await expect.poll(() => readListLink(page.url())).toMatchObject({ address: null });
		expect(readListLink(page.url()).words).toMatch(/^\S+-\S+-\S+$/);
	});
});
