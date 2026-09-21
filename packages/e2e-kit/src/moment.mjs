/**
 * A moment on the page — a deadline, a build — written the way the Le-Space
 * time and date convention asks: in this reader's locale, clock and zone, the
 * same instant in UTC on hover, and in `datetime` for machines.
 */
import { localStamp, utcStamp } from '@simple-todo/todo/moment.js';

/**
 * @param {import('@playwright/test').Page} page the reader, whose locale and zone decide
 * @param {import('@playwright/test').Locator} time a `<time datetime>` element
 * @param {typeof import('@playwright/test').expect} expect
 */
export async function expectReadersMoment(page, time, expect) {
	await expect(time).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
	const instant = new Date(/** @type {string} */ (await time.getAttribute('datetime')));
	const reader = await page.evaluate(() => {
		const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
		return { locale, timeZone };
	});

	await expect(time).toHaveAttribute('title', utcStamp(instant));
	expect(plain(await time.innerText()), `the reader's clock in ${reader.locale}, ${reader.timeZone}`).toBe(
		plain(localStamp(instant, reader.locale, reader.timeZone))
	);
}

/** Whitespace as a reader sees it: ICU puts narrow no-break spaces before AM/PM. */
const plain = (/** @type {string} */ text) => text.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
