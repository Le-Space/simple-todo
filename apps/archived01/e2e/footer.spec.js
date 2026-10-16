import { test, expect } from '@playwright/test';
import {
	expectBuildStamp,
	expectCredit,
	expectLocalFirstLink,
	expectNoEnglishThemeToggle
} from '@simple-todo/e2e-kit/footer.mjs';

// The footer is there before anybody has agreed to anything: it sits under the
// consent dialog, and it says who made the page the dialog is asking about.
test.describe('Footer', () => {
	test('signs the page, and its mark links to the local-first stack', async ({ page }) => {
		await page.goto('/');
		await expectCredit(page, expect);
		await expectLocalFirstLink(page, expect);
	});

	test.describe('in German', () => {
		test.use({ locale: 'de-DE' });

		test('signs it in German, and no shared control stays English', async ({ page }) => {
			await page.goto('/');
			await expectCredit(page, expect, { language: 'de' });
			await expectLocalFirstLink(page, expect, { language: 'de' });
			await expectNoEnglishThemeToggle(page, expect);
		});
	});

	// Two readers on two continents: the same instant, each in their own clock.
	for (const reader of [
		{ locale: 'de-DE', timezoneId: 'Europe/Berlin' },
		{ locale: 'en-US', timezoneId: 'America/New_York' }
	]) {
		test.describe(`read in ${reader.timezoneId}`, () => {
			test.use(reader);

			test('says which commit is deployed, and when, in the reader’s clock', async ({ page }) => {
				await page.goto('/');
				await expectBuildStamp(page, expect, {
					locale: reader.locale,
					timeZone: reader.timezoneId
				});
			});
		});
	}
});
