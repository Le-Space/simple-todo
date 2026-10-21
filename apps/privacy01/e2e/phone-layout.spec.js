import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { PHONE_VIEWPORT, expectNothingWiderThanViewport } from '@simple-todo/e2e-kit/phone.mjs';

// The page fits a phone after the consent screen: the header's right-hand
// group wraps instead of pushing the page past the viewport (#78, measured
// first in archived01).

const readyTimeout = 90000;

test('nothing is wider than a phone after consent', async ({ browser }) => {
	test.setTimeout(readyTimeout * 2);
	const context = await browser.newContext({ viewport: PHONE_VIEWPORT });
	const page = await context.newPage();
	try {
		await page.goto('/');
		await passConsent(page, { identity: 'anonymous' });
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({
			timeout: readyTimeout
		});
		await expectNothingWiderThanViewport(page);
	} finally {
		await context.close();
	}
});
