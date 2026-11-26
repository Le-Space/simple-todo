import { test, expect } from '@playwright/test';
import { RelayButtonDriver } from '@le-space/playwright';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { PHONE_VIEWPORT, expectNothingWiderThanViewport } from '@simple-todo/e2e-kit/phone.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';
import { openSection } from './sections.mjs';

/**
 * The session's own DID is in the header on every tab, and a click copies it.
 *
 * It used to be on the Account tab only, so whoever was asked for it -- to
 * hand it to the person delegating a todo to them -- had to go there first.
 * The header shows the value the Account tab shows, shortened the same way,
 * and copies the whole of it.
 *
 * It arrives mid-start, with the page already on screen, so where it appears
 * must not move anything: the header is measured with the button and without
 * it, at a desktop width and a phone's, in the fullest state the header has --
 * the longest network word and the video link beside it. And the anonymous
 * identity has no DID: no button, and no room kept for one.
 */

const timeout = 90000;
const DESKTOP = { width: 1280, height: 800 };
/** @type {const} */
const TABS = ['aufgaben', 'listen', 'konto', 'netzwerk'];
const LONGEST_STATE = 'Connected directly';

/**
 * The header's DID button on screen. The header renders one for the phone's
 * second row and one for the corner under the switches, and shows one.
 *
 * @param {import('@playwright/test').Page} page
 */
const headerDid = (page) => page.locator('main header [data-testid="header-did"]:visible');

/**
 * The header's height with the DID and with it taken out, and whether the
 * title lost letters.
 *
 * @param {import('@playwright/test').Page} page
 */
const headerWithAndWithoutDid = (page) =>
	page.locator('main header').evaluate((header) => {
		const height = () => Math.round(header.getBoundingClientRect().height);
		const heading = /** @type {HTMLElement} */ (header.querySelector('h1'));
		const cut = () => heading.scrollWidth > heading.clientWidth;
		const buttons = /** @type {HTMLElement[]} */ ([
			...header.querySelectorAll('[data-testid="header-did"]')
		]);
		const withDid = { height: height(), cut: cut() };
		for (const button of buttons) button.style.display = 'none';
		const without = { height: height(), cut: cut() };
		for (const button of buttons) button.style.display = '';
		return { withDid, without };
	});

/**
 * The fullest the header's state gets: the longest network word, written into
 * the dot by hand, as `header-title.spec.js` writes its badge -- reaching the
 * real one takes a second browser, and what is measured is only the room.
 *
 * @param {import('@playwright/test').Page} page
 */
const showLongestState = (page) =>
	page.getByTestId('network-status-dot').evaluate((dot, word) => {
		const label = /** @type {HTMLElement} */ (
			dot.querySelector('span:not([aria-hidden]):not(.sr-only)')
		);
		label.textContent = word;
	}, LONGEST_STATE);

/**
 * A video entry, so the header's video link is on screen beside the DID, as it
 * will be once the film is out. Nothing is played; the files may 404.
 *
 * @param {import('@playwright/test').Page} page
 */
const withVideoLink = (page) =>
	page.addInitScript(() => {
		const entry = {
			src: '/__header-did-test/escrow01.mp4',
			poster: '/__header-did-test/escrow01.png',
			captions: '/__header-did-test/escrow01.vtt',
			duration: '1:30'
		};
		/** @type {any} */ (globalThis).__escrow01DemoVideos = { en: entry, de: entry };
	});

/**
 * Two boxes share some area.
 *
 * @param {{ x: number, y: number, width: number, height: number }} a
 * @param {{ x: number, y: number, width: number, height: number }} b
 */
const overlap = (a, b) =>
	a.x < b.x + b.width - 0.5 &&
	b.x < a.x + a.width - 0.5 &&
	a.y < b.y + b.height - 0.5 &&
	b.y < a.y + a.height - 0.5;

/**
 * Nothing else in the header shares the DID button's box, nor does the relay
 * button.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} did
 */
async function expectNothingOnTop(page, did) {
	const box = await did.boundingBox();
	if (!box) throw new Error('the header DID has no box');
	const others = await page.locator('main header').evaluate((header) =>
		[...header.querySelectorAll('a, button')]
			.filter((element) => element.getAttribute('data-testid') !== 'header-did')
			.filter((element) => element.checkVisibility())
			.map((element) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				return {
					name: element.getAttribute('data-testid') ?? element.textContent?.trim() ?? '',
					x,
					y,
					width,
					height
				};
			})
	);
	const touching = others.filter((other) => overlap(box, other)).map((other) => other.name);
	expect(touching, 'header controls on top of the DID').toEqual([]);
	const launcher = await new RelayButtonDriver(page).launcherBox();
	expect(overlap(box, launcher), 'the relay button on top of the DID').toBe(false);
}

/**
 * Each width in a browser of its own, opened at that width: the relay button
 * is placed for the screen it starts on (relay-fab-position.js), and a desktop
 * page narrowed to a phone keeps it over the Network tab -- which no phone
 * shows, and which leaves the tab unclickable.
 */
const LAYOUTS = [
	{ name: 'desktop', viewport: DESKTOP, placement: 'corner' },
	// Below 30rem only the last six characters fit beside the state and the
	// video link (HeaderDid.svelte).
	{ name: 'phone', viewport: PHONE_VIEWPORT, placement: 'row' }
];

for (const layout of LAYOUTS) {
	test(`the passkey DID is in the header on every tab, and a click copies it (${layout.name})`, async ({
		browser
	}) => {
		test.setTimeout(timeout * 3);
		const context = await browser.newContext({
			viewport: layout.viewport,
			locale: 'en-US',
			permissions: ['clipboard-read', 'clipboard-write']
		});
		const page = await context.newPage();
		try {
			await addVirtualAuthenticator(page);
			await withVideoLink(page);
			await page.goto('/');
			// No identity yet: nothing in the header.
			await expect(page.getByTestId('header-did')).toHaveCount(0);

			await passConsent(page, { identity: 'create', label: 'Header' });
			await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

			// The value the Account tab shows is the one the header shows.
			await openSection(page, 'konto');
			const did = await page.getByTestId('own-did-value').getAttribute('data-did');
			if (!did) throw new Error('the Account tab shows no DID');
			expect(did).toMatch(/^did:key:z/);
			const text =
				layout.placement === 'corner'
					? await page.getByTestId('own-did-value').textContent()
					: `…${did.slice(-6)}`;

			for (const tab of TABS) {
				await openSection(page, tab);
				const button = headerDid(page);
				await expect(button, tab).toHaveCount(1);
				await expect(button).toHaveAttribute('data-placement', layout.placement);
				await expect(button).toHaveAttribute('data-did', did);
				// What is on screen: the other form and "Copied ✓" are in the DOM too.
				await expect(button).toHaveText(/** @type {string} */ (text), { useInnerText: true });
				// The whole DID is in its name and its tooltip.
				await expect(button).toHaveAccessibleName(`Copy your DID, ${did}`);
				await expect(button).toHaveAttribute('title', `Your DID: ${did}. Click to copy it.`);
			}

			const button = headerDid(page);
			await expect(page.getByTestId('demo-video-link')).toBeVisible();
			await showLongestState(page);
			const { withDid, without } = await headerWithAndWithoutDid(page);
			expect(withDid, 'the header with its DID and without').toEqual(without);
			expect(withDid.cut, 'the title keeps its words').toBe(false);
			await expectNothingOnTop(page, button);
			await expectNothingWiderThanViewport(page);

			// A click copies the whole DID, says so in the button's place for a
			// moment, and gives the place back.
			await page.evaluate(() => navigator.clipboard.writeText(''));
			const width = (await button.boundingBox())?.width;
			await button.click();
			await expect(button).toHaveAttribute('data-copied', 'true');
			await expect(button.getByTestId('header-did-copied')).toBeVisible();
			await expect(button.getByTestId('header-did-copied')).toHaveText('Copied ✓');
			expect((await button.boundingBox())?.width, 'the button keeps its width').toBe(width);
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(did);
			await expect(button).toHaveAttribute('data-copied', 'false');
			await expect(button).toHaveText(/** @type {string} */ (text), { useInnerText: true });

			// The auditor view names the auditor's account, not this one.
			await page.evaluate(() => (location.hash = '#pruefstelle'));
			await expect(page.getByTestId('auditor-view-close')).toBeVisible();
			await expect(headerDid(page)).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
}

test('the anonymous identity has no DID in the header, and no room kept for one', async ({
	browser
}) => {
	test.setTimeout(timeout * 2);
	const context = await browser.newContext({ viewport: PHONE_VIEWPORT, locale: 'en-US' });
	const page = await context.newPage();
	try {
		await page.goto('/');
		await passConsent(page, { identity: 'anonymous' });
		await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });

		for (const tab of TABS) {
			await openSection(page, tab);
			await expect(page.getByTestId('header-did'), tab).toHaveCount(0);
		}
		// Not a hidden button either: the status line the button would have
		// beside it is not there.
		await expect(page.getByTestId('header-did-status')).toHaveCount(0);
		await expectNothingWiderThanViewport(page);
	} finally {
		await context.close();
	}
});
