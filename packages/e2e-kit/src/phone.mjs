import { expect } from '@playwright/test';

/**
 * The page fits a phone: nothing is wider than the viewport.
 *
 * The header's right-hand group — DID badge, language flags, theme, page QR,
 * social icons — grew past a phone's width in archived01, the page scrolled
 * sideways, and pinch-zoom was the only way to see all of it (2026-10-17, a
 * Fold). The group wraps now in every chapter that shares the markup, but
 * only archived01 measured it (#78). This is the measurement, for every
 * chapter: the document and the header are no wider than the viewport.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function expectNothingWiderThanViewport(page) {
	const widths = await page.evaluate(() => ({
		viewport: window.innerWidth,
		document: document.documentElement.scrollWidth,
		header: document.querySelector('header')?.scrollWidth ?? 0
	}));
	expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
	expect(widths.header, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
}

/** A phone's viewport, as the Fold showed the problem: 360 px wide. */
export const PHONE_VIEWPORT = { width: 360, height: 740 };
