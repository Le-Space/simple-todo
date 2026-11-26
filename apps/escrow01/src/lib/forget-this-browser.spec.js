import { describe, expect, it, vi } from 'vitest';
import {
	FORGETTING_KEY,
	FORGET_CHANNEL,
	finishForgettingThisBrowser,
	followForgettingInOtherTabs,
	forgetThisBrowser
} from './forget-this-browser.js';

// Each test hands in a page of its own. The real one would empty the
// localStorage that other test files in this browser share, and its
// `location.replace` would load the test runner anew. What the browser itself
// does with the databases is e2e/forget-this-browser.spec.js's to show.

/** A `Storage` in a Map; `refuse` makes it throw like a blocked one. */
class MemoryStorage {
	/** @param {{ refuse?: boolean }} [options] */
	constructor({ refuse = false } = {}) {
		/** @type {Map<string, string>} */
		this.items = new Map();
		this.refuse = refuse;
	}
	get length() {
		return this.items.size;
	}
	/** @param {number} index */
	key(index) {
		return [...this.items.keys()][index] ?? null;
	}
	/** @param {string} key */
	getItem(key) {
		return this.items.get(key) ?? null;
	}
	/** @param {string} key @param {string} value */
	setItem(key, value) {
		if (this.refuse) throw new DOMException('blocked', 'SecurityError');
		this.items.set(key, value);
	}
	/** @param {string} key */
	removeItem(key) {
		this.items.delete(key);
	}
	clear() {
		this.items.clear();
	}
	keys() {
		return [...this.items.keys()];
	}
}

/**
 * @param {{ pathname?: string, sessionStorage?: MemoryStorage,
 *   BroadcastChannel?: typeof BroadcastChannel }} [options]
 */
function aPage({ pathname = '/', sessionStorage = new MemoryStorage(), BroadcastChannel } = {}) {
	const localStorage = new MemoryStorage();
	const replace = vi.fn();
	const wipe = vi.fn(async () => ({ deleted: ['level-js-orbitdb/keystore'] }));
	const env = /** @type {any} */ ({
		localStorage,
		sessionStorage,
		location: { pathname, replace },
		wipe,
		BroadcastChannel
	});
	return { env, localStorage, sessionStorage, replace, wipe };
}

describe('forgetting this browser, the click', () => {
	it('empties both storages, leaves only the note, and loads the address without its list', async () => {
		const page = aPage({ pathname: '/' });
		page.localStorage.setItem('simpleTodo.webauthnCredential', '{"credentialId":"x"}');
		page.localStorage.setItem('webauthn-identity-proof:did:key:z', '{}');
		page.localStorage.setItem('simpleTodo.chainAccount.v1.did:key:z', '{}');
		page.localStorage.setItem('simpleTodo.persistentStorageEnabled', 'true');
		page.sessionStorage.setItem('something-a-tab-kept', '1');

		await forgetThisBrowser({ lang: 'de', tellOtherTabs: false }, page.env);

		expect(page.localStorage.keys()).toEqual([]);
		expect(page.sessionStorage.keys()).toEqual([FORGETTING_KEY]);
		// The `#…` naming the list is not part of a pathname, so it is gone.
		expect(page.replace).toHaveBeenCalledWith('/?lang=de');
		// The databases are the next page's: this one still holds them open.
		expect(page.wipe).not.toHaveBeenCalled();
	});

	it('leaves the language out when it is not one the app speaks', async () => {
		const page = aPage({ pathname: '/ipfs/bafy/' });

		await forgetThisBrowser({ lang: 'fr', tellOtherTabs: false }, page.env);

		expect(page.replace).toHaveBeenCalledWith('/ipfs/bafy/');
	});

	it('deletes on the spot when there is no sessionStorage to carry the note', async () => {
		const page = aPage({ sessionStorage: new MemoryStorage({ refuse: true }) });
		/** @type {string[]} */
		const order = [];
		page.wipe.mockImplementation(async () => {
			order.push('wipe');
			return { deleted: [] };
		});
		page.replace.mockImplementation(() => order.push('replace'));

		await forgetThisBrowser({ tellOtherTabs: false }, page.env);

		expect(order).toEqual(['wipe', 'replace']);
	});
});

describe('forgetting this browser, the page after it', () => {
	it('does nothing on an ordinary start', async () => {
		const page = aPage();
		page.localStorage.setItem('simpleTodo.webauthnCredential', '{}');

		expect(await finishForgettingThisBrowser(page.env)).toBeNull();
		expect(page.wipe).not.toHaveBeenCalled();
		expect(page.localStorage.keys()).toEqual(['simpleTodo.webauthnCredential']);
	});

	it('deletes the databases and takes the note away', async () => {
		const page = aPage();
		page.sessionStorage.setItem(FORGETTING_KEY, '1');

		expect(await finishForgettingThisBrowser(page.env)).toEqual(['level-js-orbitdb/keystore']);
		expect(page.wipe).toHaveBeenCalledTimes(1);
		expect(page.sessionStorage.keys()).toEqual([]);
	});
});

describe('forgetting this browser, the other tabs', () => {
	it('forget too, each in the language it shows', async () => {
		const tab = aPage({ BroadcastChannel });
		const stop = followForgettingInOtherTabs({ lang: () => 'en' }, tab.env);
		const elsewhere = new BroadcastChannel(FORGET_CHANNEL);
		try {
			elsewhere.postMessage({ type: 'forget' });
			await vi.waitFor(() => expect(tab.replace).toHaveBeenCalledWith('/?lang=en'));
			expect(tab.sessionStorage.keys()).toEqual([FORGETTING_KEY]);
		} finally {
			elsewhere.close();
			stop();
		}
	});

	it('are told, and the tab that tells them does not hear itself', async () => {
		const tab = aPage({ BroadcastChannel });
		const stop = followForgettingInOtherTabs({}, tab.env);
		const other = new BroadcastChannel(FORGET_CHANNEL);
		/** @type {unknown[]} */
		const heard = [];
		other.onmessage = (event) => heard.push(event.data);
		try {
			await forgetThisBrowser({}, tab.env);
			await vi.waitFor(() => expect(heard).toEqual([{ type: 'forget' }]));
			// Long enough for a message to itself to have arrived, had it sent one.
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(tab.replace).toHaveBeenCalledTimes(1);
		} finally {
			other.close();
			stop();
		}
	});
});
