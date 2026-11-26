import { browser } from '$app/environment';
import { get } from 'svelte/store';

export const prerender = true;
export const trailingSlash = 'always';
export const ssr = false;

/**
 * "Forget me on this browser" ends in a reload; this is the page after it.
 *
 * A `load` because the start dialog waits for it: the databases are deleted
 * before anything can open one and before the page asks whether somebody is
 * coming back (`returningWithPasskey()`). Without the note the click left, this
 * costs one `sessionStorage` read (forget-this-browser.js).
 */
export async function load() {
	if (!browser) return {};
	const [{ finishForgettingThisBrowser, followForgettingInOtherTabs }, { locale }] =
		await Promise.all([import('$lib/forget-this-browser.js'), import('$lib/i18n/index.js')]);
	followForgettingInOtherTabs({ lang: () => get(locale) ?? null });
	await finishForgettingThisBrowser();
	return {};
}
