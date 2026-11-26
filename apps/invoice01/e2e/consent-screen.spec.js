import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openSection } from './sections.mjs';

import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';
import {
	consentModal,
	isConsentOpen,
	openAdvanced,
	passConsent,
	waitForConsent
} from '@simple-todo/e2e-kit/consent.mjs';

const timeout = 30000;

/**
 * The statement the dialog assembles, under "All notices". Read from the DOM
 * whether the section is unfolded or not: what is accepted is what is there.
 *
 * @param {import('@playwright/test').Page} page
 */
const clauses = (page) =>
	page.$$eval('[data-testid="consent-clauses"] li', (items) =>
		items.map((item) => item.textContent?.trim() ?? '')
	);

/** The English catalogue, which mirrors the element's own defaults. */
const en = JSON.parse(
	readFileSync(fileURLToPath(new URL('../src/lib/i18n/en.json', import.meta.url)), 'utf8')
);

test.describe('Consent screen', () => {
	test('the press on the button is the consent: no tick, and the button says what it does', async ({
		page
	}) => {
		// The dialog starts on "create a passkey" -- the invoice numbers hang off
		// the identity -- so the button says so, and its press is the consent.
		await addVirtualAuthenticator(page);
		await page.goto('/');
		await waitForConsent(page);

		const proceed = page.getByTestId('consent-proceed');
		await expect(proceed).toHaveText('Create a passkey and start');
		await expect(proceed).toHaveAttribute('aria-disabled', 'false');
		await expect(page.getByTestId('consent-accept')).toHaveCount(0);
		await expect(page.getByTestId('consent-agreement')).toContainText(
			'By starting you accept the notices.'
		);

		await proceed.click();
		expect(await isConsentOpen(page)).toBe(false);
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
	});

	test('Escape is not a way out, and starts nothing', async ({ page }) => {
		// With no tick to ask, the element would let the browser close the dialog
		// on Escape -- and a close is what starts the app. Only the button may.
		await page.goto('/');
		await waitForConsent(page);
		await page.getByTestId('consent-identity-anonymous').click();

		for (let press = 0; press < 3; press += 1) {
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);
			expect(await isConsentOpen(page), `after Escape #${press + 1}`).toBe(true);
		}
		await expect(page.getByPlaceholder('What needs to be done?')).toBeDisabled();

		// On the settings screen, Escape goes back to the first one.
		await openAdvanced(page);
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('consent-start')).toBeVisible();
		expect(await isConsentOpen(page)).toBe(true);
	});

	test('the first screen is the promise, three sentences and the button; the rest is on the second', async ({
		page
	}) => {
		await page.goto('/');
		await waitForConsent(page);

		await expect(page.getByTestId('consent-promise')).toContainText(
			'Write invoices beside your todos'
		);
		const summary = page.getByTestId('consent-summary').locator('li');
		await expect(summary).toHaveCount(3);
		await expect(summary.nth(0)).toContainText('not encrypted unless you seal a list');
		await expect(summary.nth(1)).toContainText('take that back');
		await expect(summary.nth(2)).toContainText('Kept in this browser');
		await expect(page.getByTestId('consent-settings')).toBeHidden();
		// The words that belong to the technical view are not on the first screen.
		const shown = await page.evaluate(() => document.querySelector('qr-intro')?.innerText ?? '');
		for (const term of ['DID', 'OrbitDB', 'IndexedDB', 'Kubo', 'IPFS', 'WebAuthn', 'PRF']) {
			expect(shown, term).not.toContain(term);
		}
		expect(shown).not.toContain('previous chapter');

		// "Settings" and "notices" both lead to the second screen, and back.
		await page.getByTestId('consent-open-notices').click();
		await expect(page.getByTestId('consent-settings')).toBeVisible();
		await expect(page.getByTestId('consent-notices')).toHaveAttribute('open', '');
		await expect(page.getByTestId('consent-start')).toBeHidden();
		await page.getByTestId('consent-back').click();
		await expect(page.getByTestId('consent-start')).toBeVisible();
		await expect(page.getByTestId('consent-start')).toBeFocused();
	});

	test('a first start creates a passkey; the other ways are links under the button', async ({
		page
	}) => {
		await page.goto('/');
		await waitForConsent(page);

		const proceed = page.getByTestId('consent-proceed');
		await expect(proceed).toHaveText('Create a passkey and start');
		// No radios any more: the way taken is the choice.
		await expect(page.locator('[data-testid^="identity-mode-"]')).toHaveCount(0);
		// The new passkey's name is a setting, filled in already.
		await openAdvanced(page);
		await expect(page.getByTestId('passkey-label')).toHaveValue('Invoices');
		await page.getByTestId('consent-back').click();

		// For somebody who already has one: no second identity by accident.
		await page.getByTestId('consent-identity-existing').click();
		await expect(proceed).toHaveText('Sign in with your passkey and start');
		await expect(page.getByTestId('consent-identity-create')).toBeVisible();

		await page.getByTestId('consent-identity-anonymous').click();
		await expect(proceed).toHaveText('Start without a passkey');
		// Nothing started on the way.
		expect(await isConsentOpen(page)).toBe(true);
	});

	test('a failed start is readable, and the button can be pressed again at once', async ({
		page
	}) => {
		// Every failure in the proceed handler reopens the dialog, and the alert
		// it sets renders in <main> — behind it. The consent screen coming back
		// with nothing to read was the app's whole failure signal.
		await page.goto('/');
		await waitForConsent(page);

		// Nothing was ever registered in this profile, so recovery cannot succeed.
		await page.getByTestId('consent-identity-existing').click();
		await page.getByTestId('consent-proceed').click();

		const alert = page.getByTestId('consent-error');
		await expect(alert).toBeVisible({ timeout });
		await expect(alert).toContainText('No passkey is stored in this browser');
		// The message a person can act on, not the one about the network stack.
		await expect(alert).not.toContainText('P2P');
		expect(await isConsentOpen(page)).toBe(true);

		// And it is on top of the dialog, not merely present in the document.
		const onTop = await alert.evaluate((el) => {
			const box = el.getBoundingClientRect();
			const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
			return el === hit || el.contains(hit);
		});
		expect(onTop).toBe(true);

		// Ready for the next try, on the way that was chosen.
		const proceed = page.getByTestId('consent-proceed');
		await expect(proceed).toHaveAttribute('aria-disabled', 'false');
		await expect(proceed).toHaveText('Sign in with your passkey and start');
	});

	test('hands the element every string it has, in the language on screen', async ({ browser }) => {
		// The app used to pass three of the element's thirty-four strings, so the
		// rest stayed on its English defaults and the dialog mixed languages in
		// adjacent lines. Two failures are possible and both are silent, so both
		// are asserted: a key the element grew that this app does not translate,
		// and a key whose German is missing — `svelte-i18n` then falls back to
		// English, which looks like a decision rather than a hole.
		const context = await browser.newContext({ locale: 'de-DE' });
		const page = await context.newPage();
		await page.goto('/');
		await waitForConsent(page);

		const keys = await page.evaluate(() =>
			Object.keys(document.querySelector('[data-testid="consent-modal"]').strings)
		);

		const supplied = new Set([
			...Object.keys(en.consent.element),
			// Renamed on the way in, because this app already had names for them.
			'title',
			'close',
			'dontShow',
			// Functions of a count, so they cannot travel in the plain map.
			'relayReachable',
			'relayDiscovered'
		]);
		expect(keys.filter((key) => !supplied.has(key))).toEqual([]);

		const stillEnglish = await page.evaluate((defaults) => {
			const host = document.querySelector('[data-testid="consent-modal"]');
			const shown = `${host.shadowRoot?.textContent ?? ''} ${document.body.textContent ?? ''}`;
			return Object.entries(defaults)
				.filter(([, value]) => typeof value === 'string' && value.length > 20)
				.filter(([, value]) => shown.includes(value))
				.map(([key]) => key);
		}, en.consent.element);
		expect(stillEnglish).toEqual([]);

		// The short form's own wording, which comes from the shared catalogue.
		await expect(page.getByTestId('consent-proceed')).toHaveText('Passkey anlegen und starten');
		await expect(page.getByTestId('consent-agreement')).toContainText(
			'Mit dem Start akzeptieren Sie die Hinweise.'
		);
		await expect(page.getByTestId('consent-identity-existing')).toHaveText(
			'Schon einen Passkey? Damit anmelden'
		);

		await context.close();
	});

	test('the storage sentence follows the choice that decides it', async ({ page }) => {
		// The storage choice is the only decision in this dialog that changes what
		// the app does rather than what has been read, so the statement names the
		// consequence of the option actually selected instead of describing both
		// and leaving the reader to work out which one is theirs.
		await page.goto('/');
		await waitForConsent(page);
		await openAdvanced(page);

		// "Keep them in this browser", unless somebody chooses otherwise.
		await expect(page.getByTestId('storage-mode-indexeddb')).toBeChecked();
		const kept = (await clauses(page)).join(' ');
		expect(kept).toContain('survive a reload');
		expect(kept).not.toContain('nothing is written to this device');

		await page.getByTestId('storage-mode-memory').check();
		const memory = (await clauses(page)).join(' ');
		expect(memory).toContain('nothing is written to this device');
		expect(memory).toContain('it asks again');
		await page.getByTestId('consent-back').click();
		await expect(page.getByTestId('consent-summary')).toContainText('In memory only');
	});

	test('says what this chapter does to your data, in plain words', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const statement = (await clauses(page)).join(' ');

		// Both kinds of list, because naming only one would be false either way.
		expect(statement).toContain('three Spanish words');
		expect(statement).toContain('who may write');

		// And the sentence this chapter exists to make people read: write access
		// is not read access. Only a sealed list is encrypted, so an address is
		// enough to read every other one — including for the relay that stores it.
		expect(statement).toContain('does not decide who may read');
		expect(statement).toContain('Nothing here is encrypted unless you seal a list');
		// No "don't show this again" any more: what is kept follows the storage choice.
		expect(statement).not.toContain("don't show this again");
	});

	test('marks the lines a choice rewrote, and only those', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);
		await page.getByTestId('consent-notices').evaluate((el) => (el.open = true));

		const before = await clauses(page);
		// Away from the default, which is "create a passkey" in this chapter.
		await page.getByTestId('consent-identity-anonymous').click();
		await expect.poll(async () => (await clauses(page)).join('|')).not.toBe(before.join('|'));

		const rewritten = (await clauses(page)).filter((line) => !before.includes(line));
		expect(rewritten.length).toBe(1);
		const marked = await page.$$eval(
			'[data-testid="consent-clauses"] li.consent-changed',
			(items) => items.map((item) => item.textContent?.trim() ?? '')
		);
		expect(marked).toEqual(rewritten);
	});

	test('offers the technical view beside the plain one', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const isTechnical = () =>
			page.$eval('[data-testid="consent-modal"]', (el) => el.technical === true);

		expect(await isTechnical()).toBe(false);
		await page.getByTestId('consent-technical').click();
		await expect.poll(isTechnical).toBe(true);
		await expect(page.getByTestId('consent-summary')).toContainText('OrbitDB');

		// The same switch on the settings screen, for somebody who looks there.
		await openAdvanced(page);
		const row = page.getByTestId('consent-technical-row');
		await expect(row).toBeChecked();
		await row.uncheck();
		await expect.poll(isTechnical).toBe(false);
	});

	test('the first screen fits a phone without scrolling', async ({ browser }) => {
		for (const locale of ['en-US', 'de-DE']) {
			const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
			const page = await context.newPage();
			await page.goto('/');
			await waitForConsent(page);
			const overflow = await page.evaluate(() => {
				const body = document
					.querySelector('[data-testid="consent-modal"]')
					?.shadowRoot?.querySelector('.body');
				return body ? body.scrollHeight - body.clientHeight : null;
			});
			expect(overflow, locale).toBeLessThanOrEqual(1);
			await context.close();
		}
	});

	test('the close control that does nothing is not on screen', async ({ page }) => {
		// The element disables its own close on purpose — this dialog is a
		// decision, not something to dismiss. A visible cross that does nothing,
		// in the corner people reach for to get out, is worse than no cross.
		await page.goto('/');
		await waitForConsent(page);

		const dead = await page.$eval('[data-testid="consent-modal"]', (el) => {
			// Not disabled in the short form — there is no statement in the element
			// to gate it — and it would only bring the dialog straight back.
			const control = el.shadowRoot?.querySelector('button.close');
			return control ? { hidden: control.hidden, aria: control.getAttribute('aria-hidden') } : null;
		});
		expect(dead).toEqual({ hidden: true, aria: 'true' });
	});

	test('build metadata waits in the technical view', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		await expect(page.getByTestId('consent-version')).toHaveCount(0);
		await page.getByTestId('consent-technical').click();
		await expect(page.getByTestId('consent-version')).toBeVisible();
	});

	test('speaks German to a German browser', async ({ browser }) => {
		const context = await browser.newContext({ locale: 'de-DE' });
		const page = await context.newPage();

		try {
			await page.goto('/');
			await waitForConsent(page);

			const statement = (await clauses(page)).join(' ');
			expect(statement).toContain('Wir betreiben keinen Server');
			expect(statement).toContain('außer Sie versiegeln eine Liste');
			// Not a single English clause left behind: a half-translated statement
			// reads as a decision rather than an omission.
			expect(statement).not.toContain('We run no server');
			await expect(page.getByTestId('consent-summary')).toContainText('nicht verschlüsselt');
		} finally {
			await context.close();
		}
	});

	test('kept in this browser, the decision is kept too: no dialog after a reload', async ({
		page
	}) => {
		// "Don't show this again" is gone with the tick. Keeping things in this
		// browser keeps the decision with them, and the list it was made in.
		await page.goto('/');
		await passConsent(page, { identity: 'anonymous', persistent: true });
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

		// The list this visit started, so the reload can be held against it.
		await openSection(page, 'listen');
		const address = await page.getByTestId('active-database-address').textContent();
		expect(address).toMatch(/^\/orbitdb\//);

		// Not `reload()`: that keeps the fragment, and the fragment carries the
		// open list. Coming back to the bare address is what a bookmark does.
		await page.goto('/');

		// The dialog is asked, not measured: the host is 0x0 once it upgrades.
		await page.waitForTimeout(3000);
		expect(await isConsentOpen(page)).toBe(false);
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

		// Same list, with nothing in the address bar saying so: what is remembered
		// is the decision *and* the list it was made in.
		await openSection(page, 'listen');
		await expect(page.getByTestId('active-database-address')).toHaveText(address ?? '', {
			timeout
		});

		await page.evaluate(() => localStorage.clear());
	});

	test('in memory only, nothing is kept, the decision included: a reload asks again', async ({
		page
	}) => {
		await page.goto('/');
		await passConsent(page, { identity: 'anonymous', persistent: false });
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

		await page.goto('/');
		await waitForConsent(page);
		expect(await isConsentOpen(page)).toBe(true);
	});
});

// `consentModal` is exported for specs that need the host itself; referenced
// here so the import stays honest about what this file uses.
void consentModal;
