import { recall, remember } from '@simple-todo/todo/browser-memory.js';
import { get } from 'svelte/store';
import {
	_ as formatter,
	addMessages,
	init,
	getLocaleFromNavigator,
	locale as i18nLocale
} from 'svelte-i18n';
import { setTranslator } from '@simple-todo/ui/i18n.js';
import { uiMessages } from '@simple-todo/ui/messages.js';
import de from './de.json';
import en from './en.json';

/**
 * Two languages, both compiled into the bundle.
 *
 * `addMessages` rather than `register()`: register fetches a dictionary over
 * the network on first use, and this app is served from IPFS gateways and is
 * expected to keep working when one of them is down. A language switch that
 * needed a request would fail exactly where the app claims to be resilient —
 * and it would fail quietly, showing raw message keys.
 *
 * The cost is that both dictionaries ship to everyone. Next to the libp2p
 * bundle that is a rounding error.
 *
 * Ported from `qr01`, deliberately as the same shape rather than a variation:
 * the chapters are read side by side, and a reader comparing them should find
 * the difference in what each chapter teaches, not in how it loads strings.
 */
// The shared components' own wording first, so this catalogue can still reword
// one of them without having to repeat the rest.
addMessages('de', uiMessages.de);
addMessages('en', uiMessages.en);
addMessages('de', de);
addMessages('en', en);

export const SUPPORTED = /** @type {const} */ (['de', 'en']);
const STORAGE_KEY = 'simpleTodo.locale';

/**
 * A language named by the address, `?lang=en` or `?lang=de`.
 *
 * It is how a link says which language it is for: escrow01's English preview
 * (/en/, built by english-link-preview.js) sends people here with `?lang=en`.
 * Read, not stored — storing it before the consent dialog would keep something
 * on a device whose reader has not chosen yet.
 *
 * @returns {'de' | 'en' | null}
 */
function localeFromAddress() {
	if (typeof location === 'undefined') return null;
	try {
		const asked = new URL(location.href).searchParams.get('lang');
		return asked === 'de' || asked === 'en' ? asked : null;
	} catch {
		return null;
	}
}

/**
 * The address without `?lang=`, or null when it has none. The layout puts it
 * in place once the router runs — this module is evaluated before SvelteKit
 * has started, and the router writes the address it started on back over an
 * earlier change. Removed so that a later switch of the flag is not undone by
 * the next reload, and so that the address somebody copies is the plain one.
 *
 * @returns {URL | null}
 */
export function addressWithoutLocale() {
	if (typeof location === 'undefined') return null;
	try {
		const url = new URL(location.href);
		if (!url.searchParams.has('lang')) return null;
		url.searchParams.delete('lang');
		return url;
	} catch {
		return null;
	}
}

/**
 * The language to start in.
 *
 * A language the address names wins: a link made for an English reader has to
 * open in English in a German browser. Then a stored choice, because somebody
 * who reached for the flag meant it and should not have to reach again.
 * Otherwise the browser's own setting decides — `de-AT` and `de-CH` are
 * speakers of German, so only the primary subtag is consulted. Anything else
 * lands on English.
 *
 * @returns {'de' | 'en'}
 */
export function initialLocale() {
	const fromAddress = localeFromAddress();
	if (fromAddress) return fromAddress;
	try {
		const stored = recall(STORAGE_KEY);
		if (stored === 'de' || stored === 'en') return stored;
	} catch {
		// Storage blocked; fall through to the browser's setting.
	}

	const fromBrowser = (getLocaleFromNavigator() || 'en').slice(0, 2).toLowerCase();
	return fromBrowser === 'de' ? 'de' : 'en';
}

/** @param {'de' | 'en'} next */
export function setLocale(next) {
	i18nLocale.set(next);
	try {
		remember(STORAGE_KEY, next);
	} catch {
		// Storage blocked: the choice holds for this session and no longer.
	}
}

/**
 * Initialised on import, and `_` is re-exported from here rather than from
 * `svelte-i18n` directly.
 *
 * The obvious placement — calling this from `+layout.svelte` — looks right and
 * is a trap: anything rendered without that layout has no locale, and
 * `svelte-i18n` does not degrade, it throws *"Cannot format a message without
 * first setting the initial locale"*.
 *
 * Tying setup to the import removes the ordering question: a module that can
 * translate has, by construction, already loaded the thing that makes
 * translation possible.
 *
 * The fallback is English so a key missing from the German dictionary shows the
 * English sentence rather than the key — a visible `todo.add` is worse than a
 * sentence in the wrong language.
 */
init({
	fallbackLocale: 'en',
	initialLocale: initialLocale()
});

// The components in `@simple-todo/ui` reach this catalogue through here. It is
// registered next to `init()` for the same reason `init()` is not in a layout:
// a module that can translate has, by construction, already loaded what makes
// translation possible. Keys this chapter does not have fall back to the
// English written at the component's call site.
setTranslator(formatter, { locale: i18nLocale, setLocale });

/*
	`app.html` declares one language for crawlers — German, as its link-preview
	tags are — and a page that declares a language it is not showing is read
	aloud by a screen reader with the wrong pronunciation. The document follows
	the language on screen instead.
*/
i18nLocale.subscribe((value) => {
	if (typeof document !== 'undefined' && value) document.documentElement.lang = value;
});

/**
 * A message in the language on screen, for code that is not a component: the
 * errors `db-actions.js` returns, the details `p2p.js` reports.
 *
 * Read once, when the message is made. An error on screen stays in the
 * language it was raised in if somebody switches while it is showing; it is
 * gone a moment later anyway, and the next one is raised in the new language.
 *
 * @param {string} id
 * @param {Record<string, string | number>} [values]
 * @returns {string}
 */
export function translate(id, values) {
	return get(formatter)(id, values ? { values } : undefined);
}

/**
 * Stands in for a value that is rendered as markup — a name in `<strong>`, a
 * DID in `<code>` — while the sentence around it is translated.
 */
export const SLOT = '\u0000';

/**
 * A translated sentence split around its one markup value.
 *
 * The languages put that value in different places ("Delegated to you by X" /
 * "Von X an Sie delegiert"), so the sentence is translated whole, with `SLOT`
 * as the value, and cut afterwards.
 *
 * @param {string} message
 * @returns {{ before: string, after: string }}
 */
export function around(message) {
	const [before = '', after = ''] = message.split(SLOT);
	return { before, after };
}

export { _, json, locale } from 'svelte-i18n';
