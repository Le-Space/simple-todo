import { describe, expect, it, vi } from 'vitest';
import {
	createListLink,
	listLinkHref,
	normalizeListAddress,
	readListLink,
	withoutFragmentKeys
} from './list-link.js';

const CID = 'zdpuAr5JtXNGnPS6Tbsz5gR5Ho2A6CrD7wTzUDtT1N9vpv9mA';
const ADDRESS = `/orbitdb/${CID}`;
const PAGE = 'https://acl01.le-space.de/';

/**
 * A window with an address bar and nothing else.
 * @param {string} href
 */
function fakeWindow(href) {
	/** @type {(() => void)[]} */
	const listeners = [];
	const win = {
		location: { href },
		history: {
			state: { 'sveltekit:index': 3 },
			replaceState: vi.fn((/** @type {any} */ state, /** @type {string} */ _unused, /** @type {string} */ url) => {
				win.history.state = state;
				win.location.href = url;
			})
		},
		addEventListener: (/** @type {string} */ _type, /** @type {() => void} */ listener) =>
			listeners.push(listener),
		removeEventListener: (/** @type {string} */ _type, /** @type {() => void} */ listener) =>
			listeners.splice(listeners.indexOf(listener), 1),
		/** What the browser does when somebody pastes a link into this tab. */
		navigate(/** @type {string} */ next) {
			win.location.href = next;
			for (const listener of [...listeners]) listener();
		}
	};
	return win;
}

describe('reading a list link', () => {
	it('finds the three words, whatever case and spacing they came in', () => {
		expect(readListLink(`${PAGE}#list=Agua-Casa-Flor`).words).toBe('agua-casa-flor');
	});

	it('finds a list by its address, with or without the /orbitdb/ prefix', () => {
		expect(readListLink(`${PAGE}#db=${CID}`).address).toBe(ADDRESS);
		expect(readListLink(`${PAGE}#db=${encodeURIComponent(ADDRESS)}`).address).toBe(ADDRESS);
	});

	it('reads words with accents as a browser encodes them', () => {
		expect(readListLink(`${PAGE}#list=%C3%A1rbol-casa-flor`).words).toBe('árbol-casa-flor');
	});

	it('reads its keys next to somebody else’s', () => {
		const link = readListLink(`${PAGE}#listen&list=agua-casa-flor&invite=abc`);
		expect(link).toEqual({ words: 'agua-casa-flor', address: null, rejected: [] });
	});

	it('says which part of a link was unusable, instead of opening something else', () => {
		expect(readListLink(`${PAGE}#list=not-three-real-words`).rejected).toEqual(['list']);
		expect(readListLink(`${PAGE}#db=../../etc`).rejected).toEqual(['db']);
		expect(readListLink(`${PAGE}#list=agua-casa-flor`).rejected).toEqual([]);
	});

	it('finds nothing in a page without a fragment', () => {
		expect(readListLink(PAGE)).toEqual({ words: null, address: null, rejected: [] });
	});
});

describe('writing a list link', () => {
	it('puts the words in the fragment', () => {
		expect(listLinkHref({ words: 'agua-casa-flor' }, PAGE)).toBe(`${PAGE}#list=agua-casa-flor`);
	});

	it('names a list by its CID, which is all a QR code needs', () => {
		expect(listLinkHref({ address: ADDRESS }, PAGE)).toBe(`${PAGE}#db=${CID}`);
	});

	it('replaces its own keys and keeps everybody else’s, in front', () => {
		expect(listLinkHref({ address: ADDRESS }, `${PAGE}?ice=stun#listen&list=agua-casa-flor`)).toBe(
			`${PAGE}?ice=stun#listen&db=${CID}`
		);
	});

	it('leaves no bare # behind when there is nothing to say', () => {
		expect(listLinkHref(null, `${PAGE}#list=agua-casa-flor`)).toBe(PAGE);
	});

	it('round-trips: what it writes, it reads back', () => {
		const href = listLinkHref({ words: 'árbol-canción-día' }, PAGE);
		expect(readListLink(href).words).toBe('árbol-canción-día');
	});

	it('drops a fragment key it is told to, and only that one', () => {
		expect(withoutFragmentKeys(`${PAGE}#list=agua-casa-flor&invite=xyz`, ['invite'])).toBe(
			`${PAGE}#list=agua-casa-flor`
		);
		expect(withoutFragmentKeys(`${PAGE}#invite=xyz`, ['invite'])).toBe(PAGE);
	});

	it('refuses anything that is not a manifest CID as an address', () => {
		expect(normalizeListAddress('/orbitdb/zdpu"><script>')).toBeNull();
		expect(normalizeListAddress('')).toBeNull();
	});
});

describe('the page and its address bar', () => {
	it('follows the open list, without adding history or losing SvelteKit’s state', () => {
		const win = fakeWindow(PAGE);
		const link = createListLink({ openWords: vi.fn(), openAddress: vi.fn(), win });
		link.show({ words: 'agua-casa-flor' });
		expect(win.location.href).toBe(`${PAGE}#list=agua-casa-flor`);
		expect(win.history.state).toEqual({ 'sveltekit:index': 3 });
		link.show({ address: ADDRESS });
		expect(win.location.href).toBe(`${PAGE}#db=${CID}`);
	});

	it('keeps a linked address while the default list comes up first, then opens it', async () => {
		const win = fakeWindow(`${PAGE}#db=${CID}`);
		const openAddress = vi.fn();
		const link = createListLink({ openWords: vi.fn(), openAddress, win });
		expect(link.initial.address).toBe(ADDRESS);

		link.show({ words: 'agua-casa-flor' }); // the default list, before the linked one
		expect(win.location.href).toBe(`${PAGE}#db=${CID}`);

		await link.openLinked();
		expect(openAddress).toHaveBeenCalledWith(ADDRESS);
		link.show({ address: ADDRESS });
		expect(win.location.href).toBe(`${PAGE}#db=${CID}`);
	});

	it('shows the list that is really open when the linked one could not be opened', async () => {
		const win = fakeWindow(`${PAGE}#db=${CID}`);
		const link = createListLink({
			openWords: vi.fn(),
			openAddress: () => Promise.reject(new Error('unreachable')),
			win
		});
		link.show({ words: 'agua-casa-flor' });
		await expect(link.openLinked()).rejects.toThrow('unreachable');
		expect(win.location.href).toBe(`${PAGE}#list=agua-casa-flor`);
	});

	it('follows a link pasted into the same tab', async () => {
		const win = fakeWindow(PAGE);
		const openAddress = vi.fn();
		const openWords = vi.fn();
		const link = createListLink({ openWords, openAddress, win });
		link.show({ words: 'agua-casa-flor' });
		const stop = link.listen();

		win.navigate(`${PAGE}#db=${CID}`);
		await Promise.resolve();
		expect(openAddress).toHaveBeenCalledWith(ADDRESS);

		win.navigate(`${PAGE}#list=fuego-gato-flor`);
		expect(openWords).toHaveBeenCalledWith('fuego-gato-flor');
		stop();
	});

	it('puts the open list back after a fragment of somebody else’s, like a section tab', () => {
		const win = fakeWindow(PAGE);
		const link = createListLink({ openWords: vi.fn(), openAddress: vi.fn(), win });
		link.show({ words: 'agua-casa-flor' });
		link.listen();
		win.navigate(`${PAGE}#listen`);
		expect(win.location.href).toBe(`${PAGE}#listen&list=agua-casa-flor`);
	});

	it('reports an address as rejected where the page only knows the three words', () => {
		const win = fakeWindow(`${PAGE}#db=${CID}`);
		const link = createListLink({ openWords: vi.fn(), win });
		expect(link.initial).toEqual({ words: null, address: null, rejected: ['db'] });
		link.show({ words: 'agua-casa-flor' });
		expect(win.location.href).toBe(`${PAGE}#list=agua-casa-flor`);
	});
});
