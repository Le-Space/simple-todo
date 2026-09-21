/**
 * The page QR, and the list it carries.
 *
 * A scanned code is only as good as what it encodes, so the check here is not
 * "an image appeared": the code on screen is compared, module for module, with
 * the code `uqr` draws for the address bar's URL — the same library, the same
 * options — and that URL has to name the list that is open.
 */
import { renderSVG } from 'uqr';
import { generateSpanishMnemonic } from '@simple-todo/todo/spanish-mnemonic.js';
import { readListLink, withoutFragmentKeys } from '@simple-todo/todo/list-link.js';

export { readListLink };

/** Three fresh words, so two runs never land in each other's list. */
export const freshListWords = () => generateSpanishMnemonic();

/**
 * Open the page QR, check it encodes this page, and close it again.
 *
 * @param {import('@playwright/test').Page} page
 * @param {typeof import('@playwright/test').expect} expect
 * @returns {Promise<string>} the URL the code carries
 */
export async function expectPageQr(page, expect) {
	await page.getByTestId('page-qr-button').click();
	const dialog = page.getByTestId('page-qr-dialog');
	await expect(dialog).toBeVisible();

	// A WebRTC invite is a one-time offer: the page's code leaves it out.
	const url = withoutFragmentKeys(page.url(), ['invite']);
	await expect(dialog.getByTestId('page-qr-url')).toHaveText(url);

	const drawn = await dialog.locator('svg').first().evaluate((svg) => ({
		viewBox: svg.getAttribute('viewBox'),
		modules: [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d')),
		plaque: getComputedStyle(/** @type {HTMLElement} */ (svg.parentElement)).backgroundColor,
		width: svg.getBoundingClientRect().width
	}));
	const expected = renderSVG(url, { border: 2 });
	expect(drawn.viewBox).toBe(/viewBox="([^"]+)"/.exec(expected)?.[1]);
	expect(drawn.modules, 'the code on screen encodes the address bar').toEqual(
		[...expected.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => match[1])
	);
	// A camera reads it, not the theme: white in dark mode too, and big enough.
	expect(drawn.plaque).toBe('rgb(255, 255, 255)');
	expect(drawn.width).toBeGreaterThan(150);

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	return url;
}
