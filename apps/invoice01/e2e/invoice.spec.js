import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

/**
 * Writing an invoice, from an empty list to a PDF.
 *
 * Two of these assertions are here because the feature shipped without them and
 * broke in exactly that way:
 *
 * - the totals are read out of the form while it is being typed into. A prop is
 *   not deeply reactive, so `draft.lines[0].quantity = 2` left "0,00 €" on
 *   screen beside the figures somebody had just entered.
 * - issuing is pressed once. The action used to look the draft up in the store
 *   right after saving it, and the store is only refilled when the log has been
 *   re-read — so the first press failed and the second worked.
 */

const testUrl = '/';
const timeout = 90000;

test.describe('Invoices', () => {
	test('a draft becomes an issued invoice with a number, and a PDF', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);
		await openPrivateList(page);
		await page.getByTestId('section-invoices').click();

		// Nothing yet, and the reason is stated rather than implied.
		await expect(page.getByTestId('invoice-empty')).toBeVisible({ timeout });

		await fillIssuer(page);

		await page.getByTestId('invoice-new').click();
		const number = (await page.getByTestId('invoice-next-number').textContent())?.trim() ?? '';
		// The series carries the year and this identity's five digits.
		expect(number).toMatch(/\d{4}-\d{5}-001/);

		await page.getByTestId('invoice-customer-name').fill('Müller & Söhne GmbH');
		await page.getByTestId('invoice-customer-address').fill('Kölner Straße 9\n50667 Köln');
		await page.getByTestId('invoice-line-description').fill('Tagessatz Entwicklung');
		await page.getByTestId('invoice-line-quantity').fill('2');
		await page.getByTestId('invoice-line-price').fill('500,00');

		// The figures follow what is being typed, while it is being typed.
		await expect(page.getByTestId('invoice-line-net')).toHaveText(/1\.000,00/, { timeout: 10_000 });
		await expect(page.getByTestId('invoice-gross')).toHaveText(/1\.190,00/);

		// What the line was about, and what was actually done: neither changes
		// a figure, and both have to survive issuing.
		await page.getByTestId('invoice-line-subtitle').fill('Doichain Core 31.1 · Aufwand 9,5 Std.');
		await page
			.getByTestId('invoice-line-details')
			.fill('LWMA und DigiShield erklärt\n\nMainnet-Node synchronisiert');
		await expect(page.getByTestId('invoice-gross')).toHaveText(/1\.190,00/);

		// A second line, to prove the editor adds up rather than shows one line.
		await page.getByTestId('invoice-add-line').click();
		await page.getByTestId('invoice-line-description').nth(1).fill('Fahrtkosten');
		await page.getByTestId('invoice-line-quantity').nth(1).fill('1');
		await page.getByTestId('invoice-line-price').nth(1).fill('45,00');
		await expect(page.getByTestId('invoice-gross')).toHaveText(/1\.243,55/, { timeout: 10_000 });

		// One press. The message names the number rather than a word, because
		// this suite runs in whichever language the browser asks for.
		await page.getByTestId('invoice-issue').click();
		await expect(page.getByTestId('invoice-message')).toContainText(/\d{4}-\d{5}-001/, {
			timeout
		});

		const row = page.getByTestId('invoice-row').first();
		await expect(row).toContainText('Müller & Söhne GmbH');
		await expect(row).toContainText('1.243,55');
		// An issued invoice is the only kind that can be exported or cancelled.
		await expect(row.getByTestId('invoice-pdf')).toBeVisible();

		// The PDF is a real file, named after the invoice.
		const download = page.waitForEvent('download', { timeout });
		await page.getByTestId('invoice-pdf').click();
		const file = await download;
		expect(file.suggestedFilename()).toMatch(/^Rechnung-\d{4}-\d{5}-001\.pdf$/);
	});

	test('an issued invoice is cancelled, not edited', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);
		await openPrivateList(page);
		await page.getByTestId('section-invoices').click();
		await fillIssuer(page);

		await page.getByTestId('invoice-new').click();
		await page.getByTestId('invoice-customer-name').fill('Acme GmbH');
		await page.getByTestId('invoice-customer-address').fill('Teststraße 2\n10115 Berlin');
		await page.getByTestId('invoice-line-description').fill('Beratung');
		await page.getByTestId('invoice-line-quantity').fill('1');
		await page.getByTestId('invoice-line-price').fill('250,00');
		await page.getByTestId('invoice-issue').click();
		await expect(page.getByTestId('invoice-message')).toContainText(/\d{4}-\d{5}-001/, {
			timeout
		});

		// An issued invoice offers no edit — §31 Abs. 5 UStDV corrects, it does
		// not change what was handed over.
		const row = page.getByTestId('invoice-row').first();
		await expect(row.getByTestId('invoice-edit')).toHaveCount(0);

		page.once('dialog', (dialog) => dialog.accept());
		await row.getByTestId('invoice-storno').click();

		// The Storno arrives as a draft to look at, with the amounts taken back.
		await expect(page.getByTestId('invoice-form')).toBeVisible({ timeout });
		await expect(page.getByTestId('invoice-gross')).toHaveText(/-297,50/, { timeout: 10_000 });
	});
});

async function openReadyApp(page) {
	const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	await page.goto(testUrl);
	await passConsent(page, { identity: 'create', label: `User ${runId}` });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

/** Invoices need a list this identity owns; the shared list is everyone's. */
async function openPrivateList(page) {
	await page.getByTestId('new-list-name').fill(`invoices-${Date.now().toString(36)}`);
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });
}

/**
 * §14 Abs. 4 UStG: an invoice names who is charging — and the footer names
 * where the money goes, which is also what fills the GiroCode.
 */
async function fillIssuer(page) {
	await page.getByTestId('invoice-settings-open').click();
	await page.getByTestId('issuer-name').fill('Le Space UG (haftungsbeschränkt)');
	await page.getByTestId('issuer-address').fill('Pfarrkirchener Str. 12\n84307 Eggenfelden');
	await page.getByTestId('issuer-vatid').fill('DE313937008');
	await page.getByTestId('register-court').fill('Amtsgericht Leipzig');
	await page.getByTestId('register-number').fill('HRB 25885');
	await page.getByTestId('register-director').fill('Nico Krause');
	await page.getByTestId('bank-name').fill('Beispielbank');
	await page.getByTestId('bank-iban').fill('DE89370400440532013000');
	await page.getByTestId('bank-bic').fill('GENODEM1GLS');
	await page.getByTestId('invoice-settings-save').click();
	await expect(page.getByTestId('invoice-message')).toBeVisible({ timeout });
}

test.describe('Settings', () => {
	test('a series carried over from another program continues where it left off', async ({
		page
	}) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);
		await openPrivateList(page);
		await page.getByTestId('section-invoices').click();
		await fillIssuer(page);

		// "The first number here is …-042": what a migration from SumUp looks
		// like. The circle keeps it as its floor.
		await page.getByTestId('invoice-settings-open').click();
		const pattern = (await page.getByTestId('invoice-series').textContent())?.trim() ?? '';
		const first = pattern.replace('{YYYY}', '2026').replace('{NNN}', '042');
		await page.getByTestId('series-start').fill(first);
		await page.getByTestId('invoice-settings-save').click();
		await expect(page.getByTestId('invoice-message')).toBeVisible({ timeout });

		await page.getByTestId('invoice-new').click();
		await expect(page.getByTestId('invoice-next-number')).toContainText('042', { timeout });
	});
});

test.describe('The template', () => {
	test('is edited with a preview, saved, and downloaded as Markdown', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);
		await openPrivateList(page);
		await page.getByTestId('section-invoices').click();
		await fillIssuer(page);

		await page.getByTestId('invoice-template-open').click();
		await page
			.getByTestId('template-source')
			.fill(
				'## Anschreiben\n\nGuten Tag {{kunde.name}}, hier ist **{{nummer}}**.\n\n## Mahnung\n\nBitte zahlen\n\n## Schluss\n\nBis bald\n{{aussteller.nmae}}'
			);

		// The preview fills in what it knows and says what it does not.
		const preview = page.getByTestId('template-preview');
		await expect(preview).toContainText('Guten Tag', { timeout: 10_000 });
		await expect(page.getByTestId('template-unknown-heading')).toContainText('Mahnung');
		await expect(page.getByTestId('template-unknown-placeholder')).toContainText('aussteller.nmae');

		// Markdown leaves the app as a file.
		const download = page.waitForEvent('download', { timeout });
		await page.getByTestId('template-download').click();
		expect((await download).suggestedFilename()).toBe('rechnung-vorlage.md');

		await page.getByTestId('template-save').click();
		await expect(page.getByTestId('invoice-message')).toBeVisible({ timeout });

		// And the invoice goes out with it.
		await page.getByTestId('invoice-new').click();
		await page.getByTestId('invoice-customer-name').fill('Acme GmbH');
		await page.getByTestId('invoice-customer-address').fill('Teststraße 2\n10115 Berlin');
		await page.getByTestId('invoice-line-description').fill('Beratung');
		await page.getByTestId('invoice-line-quantity').fill('1');
		await page.getByTestId('invoice-line-price').fill('250,00');
		await page.getByTestId('invoice-issue').click();
		await expect(page.getByTestId('invoice-message')).toContainText(/\d{4}-\d{5}-/, { timeout });

		const pdf = page.waitForEvent('download', { timeout });
		await page.getByTestId('invoice-pdf').click();
		expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
	});
});
