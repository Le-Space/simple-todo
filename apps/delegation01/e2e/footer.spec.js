import { test, expect } from '@playwright/test';
import { expectCredit, expectNoEnglishThemeToggle } from '@simple-todo/e2e-kit/footer.mjs';

// The footer is there before anybody has agreed to anything: it sits under the
// consent dialog, and it says who made the page the dialog is asking about.
test.describe('Footer', () => {
	test('signs the page: Made with [heart] Le Space', async ({ page }) => {
		await page.goto('/');
		await expectCredit(page, expect);
	});

	test.describe('in German', () => {
		test.use({ locale: 'de-DE' });

		test('signs it in German, and no shared control stays English', async ({ page }) => {
			await page.goto('/');
			await expectCredit(page, expect, { language: 'de' });
			await expectNoEnglishThemeToggle(page, expect);
		});
	});
});
