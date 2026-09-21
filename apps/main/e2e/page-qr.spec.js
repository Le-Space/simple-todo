import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { expectPageQr } from '@simple-todo/e2e-kit/page-qr.mjs';

// Every peer in this chapter opens the same list, so the page itself is the
// whole link: the code only has to bring a phone to this chapter.
test.describe('Page QR', () => {
	test('shows this page as a code a phone can scan', async ({ page }) => {
		await page.goto('/');
		await passConsent(page);
		await expectPageQr(page, expect);
	});
});
