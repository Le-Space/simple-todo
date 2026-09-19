import { get } from 'svelte/store';
import { readable, writable } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { setTranslator, t } from './i18n.js';

afterEach(() => setTranslator(null));

describe('the translator registry', () => {
	it('uses the fallback when no chapter has registered one', () => {
		expect(get(t)('consent.storageLegend', 'Where your todos are stored')).toBe(
			'Where your todos are stored'
		);
	});

	it('uses the chapter translation once it is registered', () => {
		setTranslator(readable((/** @type {string} */ key) => `translated:${key}`));
		expect(get(t)('consent.storageLegend', 'Where your todos are stored')).toBe(
			'translated:consent.storageLegend'
		);
	});

	it('falls back for a key the catalogue does not have', () => {
		// svelte-i18n returns the key itself when it finds nothing, which would
		// otherwise put `consent.storageLegend` on screen.
		setTranslator(readable((/** @type {string} */ key) => key));
		expect(get(t)('consent.storageLegend', 'Where your todos are stored')).toBe(
			'Where your todos are stored'
		);
	});

	it('falls back while a catalogue is still loading', () => {
		setTranslator(
			readable(() => {
				throw new Error('not loaded');
			})
		);
		expect(get(t)('consent.storageLegend', 'English')).toBe('English');
	});

	it('follows the store when the locale changes', () => {
		const format = writable((/** @type {string} */ key) => `en:${key}`);
		setTranslator(format);
		expect(get(t)('a.key', 'fallback')).toBe('en:a.key');
		format.set((/** @type {string} */ key) => `de:${key}`);
		expect(get(t)('a.key', 'fallback')).toBe('de:a.key');
	});

	it('drops the previous translator instead of leaving it subscribed', () => {
		const first = writable((/** @type {string} */ key) => `first:${key}`);
		setTranslator(first);
		setTranslator(readable((/** @type {string} */ key) => `second:${key}`));

		// The old store is still there and can still change; it must not be heard.
		first.set((/** @type {string} */ key) => `first-again:${key}`);
		expect(get(t)('a.key', 'fallback')).toBe('second:a.key');
	});

	it('unregisters when handed nothing', () => {
		setTranslator(readable((/** @type {string} */ key) => `translated:${key}`));
		setTranslator(null);
		expect(get(t)('a.key', 'fallback')).toBe('fallback');
	});
});
