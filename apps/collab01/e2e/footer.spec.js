import { test, expect } from '@playwright/test';
import { expectCredit } from '@simple-todo/e2e-kit/footer.mjs';

// The footer is there before anybody has agreed to anything: it sits under the
// consent dialog, and it says who made the page the dialog is asking about.
test.describe('Footer', () => {
	test('signs the page: Made with [heart] Le Space', async ({ page }) => {
		await page.goto('/');
		await expectCredit(page, expect);
	});
});
