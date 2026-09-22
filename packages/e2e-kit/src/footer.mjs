/**
 * What every chapter's footer has to show, checked the same way everywhere.
 *
 * The footer lives in `@simple-todo/ui`, so a chapter's Tailwind build only
 * styles it if `@source` names the package — and an unstyled footer still
 * renders, still has its link, and passes every text check. So the checks
 * here are computed values the styles alone produce: the mark's size, mark
 * and name side by side with the gap between them, the heart filled with the
 * theme's coral.
 */
import { chapterCommit } from '@simple-todo/todo/node/chapter-commit.js';
import { localStamp, utcStamp } from '@simple-todo/todo/moment.js';

/**
 * The signature line: "Made with [mark] Le Space", mark and name one link.
 *
 * @param {import('@playwright/test').Page} page
 * @param {typeof import('@playwright/test').expect} expect
 * @param {{ language?: 'en' | 'de' }} [options] the language the page is in
 */
export async function expectCredit(page, expect, { language = 'en' } = {}) {
	const footer = page.getByTestId('app-footer');
	await expect(footer).toBeAttached();
	await expect(footer).toContainText(language === 'de' ? 'Gebaut mit' : 'Made with');

	const link = footer.getByTestId('le-space-credit');
	await expect(link).toHaveAttribute('href', 'https://le-space.de');
	await expect(link).toHaveText('Le Space');

	const layout = await link.evaluate((element) => {
		const mark = /** @type {SVGSVGElement} */ (element.querySelector('svg'));
		const heart = /** @type {SVGPathElement} */ (mark.querySelector('path'));
		const box = mark.getBoundingClientRect();
		const name = /** @type {HTMLElement} */ (element.querySelector('span')).getBoundingClientRect();
		const before = /** @type {HTMLElement} */ (element.previousElementSibling).getBoundingClientRect();
		const probe = document.createElement('span');
		probe.style.color = 'var(--coral)';
		document.body.append(probe);
		const coral = getComputedStyle(probe).color;
		probe.remove();
		return {
			// Unstyled, the name would sit on the mark's baseline, not its middle.
			offCentre: Math.abs(box.top + box.height / 2 - (name.top + name.height / 2)),
			gap: name.left - box.right,
			// `gap-x-1.5` is written nowhere but in the footer, so this one fails
			// when the chapter's Tailwind build stops reading `@simple-todo/ui`.
			leading: element.getBoundingClientRect().left - before.right,
			width: box.width,
			height: box.height,
			heart: getComputedStyle(heart).fill,
			coral
		};
	});

	expect(layout.offCentre, 'mark and name share one centre line').toBeLessThan(2);
	expect(layout.gap, 'the gap between mark and name').toBeCloseTo(4, 0);
	expect(layout.leading, 'the gap after "Made with"').toBeCloseTo(6, 0);
	// 22 px is the credit variant's minimum; smaller and the heart stops reading as one.
	expect(layout.width).toBeCloseTo(22, 0);
	expect(layout.height).toBeCloseTo(22, 0);
	expect(layout.coral, 'the chapter defines --coral').toMatch(/^rgb/);
	expect(layout.heart, 'the heart is the theme’s coral').toBe(layout.coral);
}

/**
 * The header mark links to local-first.le-space.de, the stack behind the app.
 *
 * @param {import('@playwright/test').Page} page
 * @param {typeof import('@playwright/test').expect} expect
 * @param {{ language?: 'en' | 'de' }} [options]
 */
export async function expectLocalFirstLink(page, expect, { language = 'en' } = {}) {
	const link = page.getByTestId('local-first-link');
	await expect(link).toHaveCount(1);
	await expect(link).toHaveAttribute('href', 'https://local-first.le-space.de');
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute(
		'aria-label',
		language === 'de'
			? 'Le Space: der Local-First-Stack hinter dieser App'
			: 'Le Space: the local-first stack behind this app'
	);
	// The logo itself, not an empty link.
	await expect(link.locator('svg[role="img"]')).toHaveCount(1);
}

/**
 * No shared control left speaking English on a German page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {typeof import('@playwright/test').expect} expect
 */
export async function expectNoEnglishThemeToggle(page, expect) {
	await expect(page.locator('[aria-label^="Switch to"]')).toHaveCount(0);
}

/**
 * The build stamp: the chapter's last commit, at that commit's instant, in the
 * reader's locale, clock and zone — UTC on hover, UTC in `datetime`.
 *
 * The expectation is computed here, by the same two functions the page uses:
 * `chapterCommit` for which commit (asked of git, as the build did), and
 * `localStamp` for how a reader in `locale` and `timeZone` writes it. So a
 * reader in Berlin and one in New York each get exactly their own line, and a
 * stamp taken from the build clock, or from HEAD instead of the chapter's own
 * last commit, fails.
 *
 * @param {import('@playwright/test').Page} page
 * @param {typeof import('@playwright/test').expect} expect
 * @param {{ locale: string, timeZone: string, chapterDir?: string }} reader
 */
export async function expectBuildStamp(page, expect, { locale, timeZone, chapterDir = process.cwd() }) {
	const built = chapterCommit(chapterDir);
	expect(built.commit, 'the suite runs in a git checkout').toMatch(/^[0-9a-f]{40}$/);
	const instant = new Date(built.date);

	const stamp = page.getByTestId('app-footer').getByTestId('build-stamp');
	const time = stamp.locator('time[datetime]');
	await expect(time).toHaveCount(1);
	await expect(time).toHaveAttribute('datetime', instant.toISOString());
	await expect(time).toHaveAttribute('title', utcStamp(instant));
	expect(plain(await time.innerText()), `the reader's clock in ${locale}, ${timeZone}`).toBe(
		plain(localStamp(instant, locale, timeZone))
	);

	const link = stamp.getByRole('link');
	await expect(link).toHaveAttribute(
		'href',
		`https://github.com/Le-Space/simple-todo/commit/${built.commit}`
	);
	await expect(link).toHaveText(built.commit.slice(0, 7));
}

/** Whitespace as a reader sees it: ICU puts narrow no-break spaces before AM/PM. */
const plain = (/** @type {string} */ text) => text.replace(/[\s  ]+/g, ' ').trim();
