/**
 * How a shared component reaches a chapter's translations.
 *
 * The components in this package are used by nine apps, and each one owns its
 * own catalogue — different keys, different languages, in one chapter no
 * catalogue at all. Importing `$lib/i18n` from here would tie the package to
 * one app's file layout; giving every string its own prop turns a five-string
 * component into a twelve-attribute call.
 *
 * So a chapter registers its translator once, and the components ask for a key
 * *with the English text to use if that key is missing*. A chapter that has not
 * registered anything, or has not translated this particular string yet, shows
 * the English — never a raw key on screen, which is what a plain lookup would
 * do (svelte-i18n returns the key itself when it finds nothing).
 *
 * @example
 *   // once, where the app starts
 *   import { _ } from '$lib/i18n/index.js';
 *   import { setTranslator } from '@simple-todo/ui/i18n.js';
 *   setTranslator(_);
 *
 *   // in a shared component
 *   {$t('consent.storageLegend', 'Where your todos are stored')}
 */
import { derived, writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<((key: string) => string) | null>} */
const format = writable(null);

/** @type {(() => void) | null} */
let unsubscribe = null;

/**
 * Register the chapter's translator.
 *
 * Takes svelte-i18n's `_` as it is: a store whose value is the format function,
 * which changes when the locale does. A chapter calls this once at startup, so
 * the subscription lives as long as the page.
 *
 * The previous registration is dropped first. Without that, two translators
 * would both stay subscribed, and a locale change on the *old* one would
 * quietly put its wording back — rare in an app, ordinary in a test that
 * registers a second one.
 *
 * Passing nothing unregisters.
 *
 * @param {{ subscribe: (run: (value: any) => void) => unknown } | null} [store]
 */
export function setTranslator(store) {
	unsubscribe?.();
	unsubscribe = null;

	if (!store || typeof store.subscribe !== 'function') {
		format.set(null);
		return;
	}

	const stop = store.subscribe((value) => format.set(typeof value === 'function' ? value : null));
	unsubscribe = typeof stop === 'function' ? /** @type {() => void} */ (stop) : null;
}

/**
 * `$t(key, fallback)` — the translation, or the English written at the call site.
 *
 * @type {import('svelte/store').Readable<(key: string, fallback: string) => string>}
 */
export const t = derived(format, ($format) => {
	/**
	 * @param {string} key
	 * @param {string} fallback
	 */
	return (key, fallback) => {
		if (!$format) return fallback;
		let translated;
		try {
			translated = $format(key);
		} catch {
			// A catalogue that has not finished loading throws rather than misses.
			return fallback;
		}
		// svelte-i18n hands back the key when it has nothing for it.
		return !translated || translated === key ? fallback : translated;
	};
});
