import { test, expect } from '@playwright/test';
import { PHONE_VIEWPORT, expectNothingWiderThanViewport } from '@simple-todo/e2e-kit/phone.mjs';

// The page fits a phone: the header's right-hand group wraps instead of
// pushing the page past the viewport (#78, measured first in archived01).
// This chapter has no consent screen; the list is ready on arrival.

const readyTimeout = 90000;

test('nothing is wider than a phone', async ({ browser }) => {
	test.setTimeout(readyTimeout * 2);
	const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
	const page = await context.newPage();
	try {
		await page.goto('/');
		await expect(page.getByPlaceholder('What needs doing?')).toBeEnabled({ timeout: readyTimeout });
		await expectNothingWiderThanViewport(page);
	} finally {
		await context.close();
	}
});
