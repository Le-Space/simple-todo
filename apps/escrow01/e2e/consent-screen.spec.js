import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';
import {
	backToStart,
	consentModal,
	isConsentOpen,
	openAdvanced,
	passConsent,
	waitForConsent
} from '@simple-todo/e2e-kit/consent.mjs';
import { openSection } from './sections.mjs';

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
		// A tick asked people to confirm notices they had not opened, and the
		// button beside it said only "Start". Now the button names what its press
		// does, and the sentence under it says the press is the consent.
		await page.goto('/');
		await waitForConsent(page);

		const proceed = page.getByTestId('consent-proceed');
		await expect(proceed).toHaveText('Create a passkey and start');
		await expect(proceed).toHaveAttribute('aria-disabled', 'false');
		await expect(page.getByTestId('consent-accept')).toHaveCount(0);
		await expect(page.getByTestId('consent-agreement')).toContainText(
			'By starting you accept the notices.'
		);

		// Without a passkey: this profile has no authenticator to create one with.
		await page.getByTestId('consent-identity-anonymous').click();
		await expect(proceed).toHaveText('Start without a passkey');
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

	test('names the requirement that is actually holding the button, and leads to it', async ({
		page
	}) => {
		// The share code holds the button only for somebody who asked to join a
		// list. A press then leads to the field that is wrong, with the cursor in it.
		await page.goto('/');
		await waitForConsent(page);

		const proceed = page.getByTestId('consent-proceed');
		const hint = page.getByTestId('consent-hint');
		await expect(hint).toHaveCount(0);

		await openAdvanced(page);
		await page.getByTestId('consent-join-list').check();
		const field = page.getByTestId('shared-list-mnemonic-input');
		await field.fill('not a mnemonic at all');
		await expect(proceed).toHaveAttribute('aria-disabled', 'true');
		await expect(hint).toContainText('Enter a valid share code under “Settings”');

		await backToStart(page);
		// `dispatchEvent`, because Playwright refuses to click an aria-disabled button.
		await proceed.dispatchEvent('click');
		await expect(page.getByTestId('consent-settings')).toBeVisible();
		await expect(field).toBeFocused();
		expect(await isConsentOpen(page)).toBe(true);

		await field.fill('brisa-arena-sal');
		await expect(proceed).toHaveAttribute('aria-disabled', 'false');
		// Unticked, the words typed are not what the start opens, so they hold nothing.
		await field.fill('still not a mnemonic');
		await page.getByTestId('consent-join-list').uncheck();
		await expect(proceed).toHaveAttribute('aria-disabled', 'false');
	});

	test('waits neutrally: the app colour while it can go, grey while it waits', async ({ page }) => {
		// A faded coral read as an error before anybody had done anything.
		await page.goto('/');
		await waitForConsent(page);

		const proceed = page.getByTestId('consent-proceed');
		const colour = () => proceed.evaluate((el) => getComputedStyle(el).backgroundColor);
		const ready = await colour();
		const [r, g, b] = ready.match(/\d+/g).map(Number);
		// Coral: red well above the others.
		expect(r - Math.max(g, b)).toBeGreaterThan(80);

		await openAdvanced(page);
		await page.getByTestId('consent-join-list').check();
		await expect.poll(colour).not.toBe(ready);
		const [wr, wg, wb] = (await colour()).match(/\d+/g).map(Number);
		// Grey: no channel far from the others.
		expect(Math.max(wr, wg, wb) - Math.min(wr, wg, wb)).toBeLessThan(30);
	});

	test('the first screen is the story, three sentences and the button; the rest is on the second', async ({
		page
	}) => {
		await page.goto('/');
		await waitForConsent(page);

		await expect(page.getByTestId('consent-promise')).toBeVisible();
		await expect(page.getByTestId('one-passkey-pay')).toBeVisible();
		const summary = page.getByTestId('consent-summary').locator('li');
		await expect(summary).toHaveCount(3);
		await expect(summary.nth(1)).toContainText('Todos and lists are not encrypted');
		await expect(summary.nth(2)).toContainText('without extensions');
		await expect(page.getByTestId('consent-settings')).toBeHidden();
		// The words that belong to the technical view are not on the first screen.
		const shown = await page.evaluate(() => document.querySelector('qr-intro')?.innerText ?? '');
		for (const term of ['DID', 'OrbitDB', 'IndexedDB', 'Kubo', 'IPFS', 'Sepolia', 'WebAuthn']) {
			expect(shown, term).not.toContain(term);
		}
		expect(shown).not.toContain('mnemonic');
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

		// For somebody who already has one: no second identity by accident.
		await page.getByTestId('consent-identity-existing').click();
		await expect(proceed).toHaveText('Sign in with your passkey and start');
		await expect(page.getByTestId('consent-identity-create')).toBeVisible();

		await page.getByTestId('consent-identity-anonymous').click();
		await expect(proceed).toHaveText('Start without a passkey');
		await expect(page.getByTestId('consent-anonymous-note')).toContainText('cannot lock a budget');
		expect((await clauses(page)).join(' ')).toContain('Without a passkey you cannot lock a budget');
		// Nothing started on the way.
		expect(await isConsentOpen(page)).toBe(true);
	});

	test('a failed start is readable, and the button can be pressed again at once', async ({
		page
	}) => {
		// Every failure in the proceed handler reopens the dialog, and the alert
		// it sets renders in <main> — behind it. The consent screen coming back
		// with nothing to read was the app's whole failure signal. And the tick it
		// had was empty again after a failure (the dialog mounts anew), so a second
		// try meant ticking twice.
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

		await context.close();
	});

	test('the storage sentence follows the box that decides it', async ({ page }) => {
		// The storage choice is the only decision in this dialog that changes what
		// the app does rather than what has been read, so the statement names the
		// consequence of the choice actually made instead of describing both and
		// leaving the reader to work out which one is theirs.
		await page.goto('/');
		await waitForConsent(page);

		await openAdvanced(page);
		const keep = page.getByTestId('storage-keep');
		// Ticked unless somebody unticks it.
		await expect(keep).toBeChecked();
		const kept = (await clauses(page)).join(' ');
		expect(kept).toContain('survive a reload');
		expect(kept).not.toContain('nothing is written to this device');

		await keep.uncheck();
		const memory = (await clauses(page)).join(' ');
		expect(memory).toContain('nothing is written to this device');
		expect(memory).toContain('this dialog asks again');
	});

	test('says what this chapter does to your data, in plain words', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const statement = (await clauses(page)).join(' ');

		// Both kinds of list, because naming only one would be false either way.
		expect(statement).toContain('three Spanish words');
		expect(statement).toContain('who may write');

		// And the sentence this chapter exists to make people read: write access
		// is not read access. Todos and lists are not encrypted, so an address is
		// enough to read everything — including for the relay that stores it.
		expect(statement).toContain('does not decide who may read');
		expect(statement).toContain('Todos and lists are not encrypted');

		// What a browser extension can see, which no setting here changes.
		expect(statement).toContain('A browser extension with access to this page');
	});

	test('says which part is encrypted and which is not, under separate headings', async ({
		page
	}) => {
		// "Nothing here is encrypted" used to stand beside "Budgets, encrypted".
		// Both were true of different things; the headings now say which.
		await page.goto('/');
		await waitForConsent(page);

		const headings = await page.$$eval('[data-testid="consent-clauses"] h4', (items) =>
			items.map((item) => item.textContent?.trim() ?? '')
		);
		expect(headings).toContain('Todos and lists — not encrypted');
		expect(headings.some((heading) => heading.startsWith('Amounts'))).toBe(true);
		expect((await clauses(page)).join(' ')).not.toContain('Nothing here is encrypted');
	});

	test('marks the lines a choice rewrote, and only those', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);
		await page.getByTestId('consent-notices').evaluate((el) => (el.open = true));

		const before = await clauses(page);
		await page.getByTestId('consent-identity-anonymous').click();
		await expect.poll(async () => (await clauses(page)).join('|')).not.toBe(before.join('|'));

		const rewritten = (await clauses(page)).filter((line) => !before.includes(line));
		expect(rewritten.length).toBeGreaterThan(0);
		const marked = await page.$$eval(
			'[data-testid="consent-clauses"] li.consent-changed',
			(items) => items.map((item) => item.textContent?.trim() ?? '')
		);
		expect(marked.sort()).toEqual(rewritten.sort());
	});

	test('offers the technical view beside the plain one', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		const isTechnical = () =>
			page.$eval('[data-testid="consent-modal"]', (el) => el.technical === true);

		expect(await isTechnical()).toBe(false);
		await page.getByTestId('consent-technical').click();
		await expect.poll(isTechnical).toBe(true);

		// The same switch on the settings screen, for somebody who looks there.
		await openAdvanced(page);
		const row = page.getByTestId('consent-technical-row');
		await expect(row).toBeChecked();
		await row.uncheck();
		await expect.poll(isTechnical).toBe(false);
	});

	for (const viewport of [
		{ width: 1512, height: 800 },
		{ width: 390, height: 844 },
		{ width: 360, height: 640 }
	]) {
		test(`fits a ${viewport.width}x${viewport.height} window, and the dialog itself never scrolls`, async ({
			browser
		}) => {
			// The element capped its height on the content box, so padding and
			// border came on top: at 800px the dialog ran 5px past both edges of
			// the window. With the old "Advanced" open, the dialog itself scrolled:
			// the wheel moved the title and the language switch out of view and
			// left an empty band under the button. The settings are a second screen
			// now; with all notices open, only the body scrolls.
			const context = await browser.newContext({ viewport });
			const page = await context.newPage();
			await page.goto('/');
			await waitForConsent(page);

			const measure = () =>
				page.evaluate(() => {
					const host = document.querySelector('[data-testid="consent-modal"]');
					const dialog = host?.shadowRoot?.querySelector('dialog');
					const body = host?.shadowRoot?.querySelector('.body');
					const of = (/** @type {string} */ id) =>
						document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
					return {
						dialog: dialog?.getBoundingClientRect(),
						dialogScroll: dialog ? dialog.scrollHeight - dialog.clientHeight : null,
						bodyScroll: body ? body.scrollHeight - body.clientHeight : null,
						button: of('consent-proceed'),
						agreement: of('consent-agreement')
					};
				});
			const inside = (/** @type {DOMRect | undefined} */ box) =>
				!!box && box.top >= 0 && box.bottom <= viewport.height;

			for (const screen of ['start', 'settings']) {
				if (screen === 'settings') {
					await page.getByTestId('consent-open-notices').click();
					await expect(page.getByTestId('consent-notices')).toHaveAttribute('open', '');
					// The wheel over the dialog, as somebody reading the notices would.
					await page.mouse.move(viewport.width / 2, viewport.height / 2);
					await page.mouse.wheel(0, 2000);
					await page.waitForTimeout(300);
				}
				const boxes = await measure();
				expect(inside(boxes.dialog), `${screen}: ${JSON.stringify(boxes.dialog)}`).toBe(true);
				expect(boxes.dialogScroll, `${screen}: the dialog itself scrolls`).toBeLessThanOrEqual(1);
				expect(inside(boxes.button), `${screen}: button`).toBe(true);
				expect(inside(boxes.agreement), `${screen}: agreement`).toBe(true);
				expect(boxes.agreement.top).toBeGreaterThan(boxes.button.top);
			}

			await context.close();
		});
	}

	test('the first screen fits a phone without scrolling', async ({ browser }) => {
		// 1109 to 1244 px of dialog on an 844 px phone, before: the sentences about
		// the data sat below the tick that claimed they had been read.
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

	for (const [locale, code] of /** @type {const} */ ([
		['en-US', 'en'],
		['de-DE', 'de']
	])) {
		test(`marks the language on screen, and nothing else (${code})`, async ({ browser }) => {
			// The dialog opened with the cursor on the first control — the German
			// flag — and its focus ring read as "German is selected" on an English
			// page. The cursor now starts at the text, and only the language on
			// screen is marked.
			const context = await browser.newContext({ locale });
			const page = await context.newPage();
			await page.goto('/');
			await waitForConsent(page);

			const modal = consentModal(page);
			await expect(modal.getByTestId(`language-${code}`)).toHaveAttribute('aria-pressed', 'true');
			await expect(modal.getByTestId(`language-${code === 'de' ? 'en' : 'de'}`)).toHaveAttribute(
				'aria-pressed',
				'false'
			);
			expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
				'consent-start'
			);
			expect(await page.evaluate(() => document.documentElement.lang)).toBe(code);

			// And a switch changes both.
			const other = code === 'de' ? 'en' : 'de';
			await modal.getByTestId(`language-${other}`).click();
			await expect(modal.getByTestId(`language-${other}`)).toHaveAttribute('aria-pressed', 'true');
			await expect(page.getByTestId('consent-proceed')).toHaveText(
				other === 'de' ? 'Passkey anlegen und starten' : 'Create a passkey and start'
			);

			await context.close();
		});
	}

	test('the tab and the dialog say what the app is for', async ({ page }) => {
		await page.goto('/');
		await waitForConsent(page);

		await expect(page).toHaveTitle('Confidential escrow by passkey · escrow01');
		expect(await page.evaluate(() => document.querySelector('qr-intro')?.strings.title)).toBe(
			'Confidential escrow payments with a passkey'
		);
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
			expect(statement).toContain('nicht verschlüsselt');
			// Not a single English clause left behind: a half-translated statement
			// reads as a decision rather than an omission.
			expect(statement).not.toContain('We run no server');
		} finally {
			await context.close();
		}
	});

	test('behind the dialog, a German browser gets a German page without the plumbing', async ({
		browser
	}) => {
		// The dialog was German while the page behind it still said "Create a
		// private list" and "P2P network ready", with peer IDs and multiaddrs in
		// front of people who came to delegate a todo.
		const context = await browser.newContext({ locale: 'de-DE' });
		const page = await context.newPage();

		try {
			await page.goto('/');
			await passConsent(page, { identity: 'anonymous' });
			await expect(page.getByPlaceholder('Was ist zu tun?')).toBeEnabled({ timeout });
			expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');

			// The simple view: whether the app is ready, and which list is open.
			await expect(page.getByTestId('p2p-status-nav')).toHaveAttribute('data-view', 'simple');
			// escrow01 starts in a list of one's own, named in the reader's language.
			await expect(page.getByTestId('active-list-heading')).toContainText('Private Liste');
			await expect(page.getByTestId('active-list-name')).toHaveText('Meine Aufgaben');
			await expect(page.getByTestId('p2p-status-step')).toHaveCount(0);
			await expect(page.getByTestId('network-details')).toHaveCount(0);

			await openSection(page, 'listen');
			await expect(page.getByTestId('active-list-kind')).toHaveText('Private Liste');
			await page.getByTestId('new-list-name').fill('Prüfbericht');
			await page.getByTestId('new-list-create').click();
			await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });
			await expect(page.getByTestId('new-list-created')).toContainText('ist angelegt');
			await expect(page.getByTestId('active-list-kind')).toHaveText('Private Liste');

			// Read tab by tab: `innerText` leaves out whatever is hidden, so reading
			// the page once would only ever check the tab that happens to be open.
			for (const section of /** @type {const} */ (['aufgaben', 'listen', 'konto', 'netzwerk'])) {
				await openSection(page, section);
				const shown = await page.evaluate(() => document.body.innerText);
				for (const english of [
					'Create a private list',
					'Open a shared list by address',
					'Write permissions',
					'Your lists',
					'Switch list',
					'Your passkey',
					'Open the auditor view',
					'Appearance',
					'P2P network ready',
					'Network details',
					'A local-first peer-to-peer PWA'
				]) {
					expect(shown, `${english} (${section})`).not.toContain(english);
				}
				for (const tab of ['Aufgaben', 'Listen', 'Konto', 'Netzwerk']) {
					expect(shown, `tab ${tab} (${section})`).toContain(tab);
				}
			}

			// One switch brings all of it back.
			await page.getByTestId('technical-toggle').click();
			await expect(page.getByTestId('network-details')).toContainText('Netzwerkdetails');
			await expect(page.getByTestId('p2p-status-step')).toHaveCount(8);
		} finally {
			await context.close();
		}
	});

	test('kept in this browser, the decision is kept too: no dialog after a reload', async ({
		page
	}) => {
		// "Don't show this again" did nothing in the default mode: it wrote to the
		// tab, and the reload asked again. "Keep in this browser" is ticked now,
		// and what it keeps includes the decision to start.
		await page.goto('/');
		await passConsent(page);

		const savedMnemonic = await page.evaluate(() =>
			localStorage.getItem('simpleTodo.sharedListMnemonic.v1')
		);
		expect(savedMnemonic).toMatch(/^.+-.+-.+$/);

		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
		await page.reload();

		// The dialog is asked, not measured: the host is 0x0 once it upgrades.
		await page.waitForTimeout(3000);
		expect(await isConsentOpen(page)).toBe(false);
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

		// The lists tab opens with the open list's details already unfolded.
		await openSection(page, 'listen');
		const sharedListDetails = page.getByTestId('shared-list-details');
		await expect(sharedListDetails).toBeVisible({ timeout });
		await expect(sharedListDetails).toHaveAttribute('open', '');
		await expect(sharedListDetails.getByTestId('active-shared-list-name')).toHaveText(
			savedMnemonic ?? ''
		);
	});

	test('unticked, nothing is kept, the decision included: a reload asks again', async ({
		page
	}) => {
		await page.goto('/');
		await passConsent(page, { persistent: false });
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
		expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

		await page.reload();
		await waitForConsent(page);
		expect(await isConsentOpen(page)).toBe(true);
	});

	test('a return to the address the app wrote is not a link; a real link says so', async ({
		page,
		browser
	}) => {
		// After a start the app writes the open list into the address. Read back
		// on the next load, it greeted every return with "this address opens the
		// shared list …", for a link nobody had followed.
		await page.goto('/');
		await passConsent(page, { persistent: false });
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
		await expect.poll(() => new URL(page.url()).hash).toContain('list=');
		const own = decodeURIComponent(new URL(page.url()).hash.match(/list=([^&]+)/)?.[1] ?? '');

		await page.reload();
		await waitForConsent(page);
		await expect(page.getByTestId('consent-linked-list')).toHaveCount(0);
		await openAdvanced(page);
		await expect(page.getByTestId('consent-join-list')).not.toBeChecked();
		// Memory mode forgot the way taken too, so it is taken again.
		await passConsent(page);
		await openSection(page, 'listen');
		await expect(page.getByTestId('active-shared-list-name')).toHaveText(own, { timeout });

		// Somebody else's browser, sent the same address: that is a link.
		const context = await browser.newContext();
		const guest = await context.newPage();
		try {
			await guest.goto(`/#list=${encodeURIComponent(own)}`);
			await waitForConsent(guest);
			await expect(guest.getByTestId('consent-linked-list')).toContainText(
				`You came through a link to the shared list “${own}”`
			);
			await expect(guest.getByTestId('shared-list-mnemonic-input')).toHaveValue(own);
		} finally {
			await context.close();
		}
	});
});

// `consentModal` is exported for specs that need the host itself; referenced
// here so the import stays honest about what this file uses.
void consentModal;
