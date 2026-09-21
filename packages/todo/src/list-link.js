/**
 * The open list, in the address bar — so a link, and the page QR that shows
 * one, opens the same list somewhere else.
 *
 * Two keys in the URL fragment:
 *
 * - `#list=agua-casa-flor` — the three-word shared list. Its words are its
 *   name, and a list with a public write rule has the same address for anyone
 *   who opens that name, so the words are all a second device needs.
 * - `#db=zdpu…` — one list by its OrbitDB address (without the `/orbitdb/`
 *   prefix, which only lengthens the QR code): a private list, or one opened by
 *   address. Whether the other side may *write* to it is still the list's
 *   access controller's business; the link only says which list.
 *
 * The fragment, never the query: it is not sent to the server, and these pages
 * are served from their own domains and from public IPFS gateways alike. A link
 * that puts a list in the query hands it to every gateway's access log.
 *
 * Only these two keys are ours. Anything else in the fragment — escrow01's
 * section (`#listen`), a WebRTC invite (`#invite=…`) — is left exactly as it
 * was, in front of ours.
 */
import { isValidSpanishMnemonic, normalizeSpanishMnemonic } from './spanish-mnemonic.js';

export const LIST_KEY = 'list';
export const DB_KEY = 'db';

const ADDRESS_PREFIX = '/orbitdb/';
// An OrbitDB manifest CID: CIDv1, base58btc, so a `z` and nothing that could
// break out of the fragment or the path it becomes.
const MANIFEST_CID = /^z[1-9A-HJ-NP-Za-km-z]{20,}$/;

/** @param {string} hash */
const tokensOf = (hash) => hash.replace(/^#/, '').split('&').filter(Boolean);

/** @param {string} token */
const keyOf = (token) => (token.includes('=') ? token.slice(0, token.indexOf('=')) : token);

/** @param {string} token */
function valueOf(token) {
	const raw = token.includes('=') ? token.slice(token.indexOf('=') + 1) : '';
	try {
		return decodeURIComponent(raw.replace(/\+/g, ' '));
	} catch {
		return '';
	}
}

/**
 * @param {string} value a `/orbitdb/…` address or its bare CID
 * @returns {string | null} the full address, or null if it is none
 */
export function normalizeListAddress(value) {
	const cid = String(value ?? '')
		.trim()
		.replace(/^\/orbitdb\//, '')
		.replace(/\/$/, '');
	return MANIFEST_CID.test(cid) ? `${ADDRESS_PREFIX}${cid}` : null;
}

/**
 * The list a URL names, if it names one.
 *
 * @param {string} href
 * @returns {{ words: string | null, address: string | null, rejected: string[] }}
 *   `rejected` names the keys whose value was there and unusable, so the page
 *   can say so rather than quietly opening something else
 */
export function readListLink(href) {
	let hash = '';
	try {
		hash = new URL(href).hash;
	} catch {
		return { words: null, address: null, rejected: [] };
	}

	/** @type {string | null} */
	let words = null;
	/** @type {string | null} */
	let address = null;
	/** @type {string[]} */
	const rejected = [];

	for (const token of tokensOf(hash)) {
		const key = keyOf(token);
		if (key === LIST_KEY) {
			const value = valueOf(token);
			if (isValidSpanishMnemonic(value)) words = normalizeSpanishMnemonic(value);
			else rejected.push(LIST_KEY);
		} else if (key === DB_KEY) {
			address = normalizeListAddress(valueOf(token));
			if (!address) rejected.push(DB_KEY);
		}
	}

	return { words, address, rejected };
}

/**
 * `href` with its fragment naming `list` — and nothing else of ours.
 *
 * @param {{ words?: string | null, address?: string | null } | null} list
 * @param {string} href
 * @returns {string}
 */
export function listLinkHref(list, href) {
	const url = new URL(href);
	const kept = tokensOf(url.hash).filter((token) => ![LIST_KEY, DB_KEY].includes(keyOf(token)));
	const address = list?.address ? normalizeListAddress(list.address) : null;
	const ours = address
		? [`${DB_KEY}=${address.slice(ADDRESS_PREFIX.length)}`]
		: list?.words
			? [`${LIST_KEY}=${encodeURIComponent(list.words)}`]
			: [];
	const fragment = [...kept, ...ours].join('&');
	url.hash = fragment;
	// `URL` keeps a bare `#` for an empty fragment; the address bar should not.
	return fragment ? url.toString() : url.toString().replace(/#$/, '');
}

/**
 * `href` without the fragment keys named — for a link that should not carry
 * them, like the page QR, which has no business re-sharing a spent invite.
 *
 * @param {string} href
 * @param {string[]} keys
 * @returns {string}
 */
export function withoutFragmentKeys(href, keys) {
	const url = new URL(href);
	const fragment = tokensOf(url.hash)
		.filter((token) => !keys.includes(keyOf(token)))
		.join('&');
	url.hash = fragment;
	return fragment ? url.toString() : url.toString().replace(/#$/, '');
}

/**
 * @typedef {{ words?: string | null, address?: string | null }} OpenList
 * @typedef {{
 *   location: { href: string },
 *   history: { state: any, replaceState: (state: any, unused: string, url: string) => void },
 *   addEventListener: (type: 'hashchange', listener: () => void) => void,
 *   removeEventListener: (type: 'hashchange', listener: () => void) => void
 * }} LinkWindow
 */

/**
 * The page's side of the link: what it was opened with, and the address bar
 * kept in step with the list that is open.
 *
 * `openWords` and `openAddress` are the page's own ways of switching lists —
 * the words usually through the consent dialog, so a link cannot switch a
 * running page to another list without the reader seeing which one. A chapter
 * that only knows the three-word list passes no `openAddress`, and a `#db=`
 * link is then reported as rejected instead of being half-followed.
 *
 * @param {{
 *   openWords: (words: string) => void,
 *   openAddress?: (address: string) => Promise<unknown> | unknown,
 *   win?: LinkWindow
 * }} hooks
 */
export function createListLink({ openWords, openAddress, win = /** @type {any} */ (globalThis).window }) {
	const read = (/** @type {string} */ href) => {
		const linked = readListLink(href);
		if (openAddress || !linked.address) return linked;
		return { ...linked, address: null, rejected: [...linked.rejected, DB_KEY] };
	};
	const initial = win
		? read(win.location.href)
		: { words: null, address: null, rejected: /** @type {string[]} */ ([]) };

	/** @type {OpenList | null} what the page reports as open */
	let open = null;
	/**
	 * An address from a link that has not been opened yet. While there is one,
	 * the address bar keeps it: the default list comes up first, and writing
	 * *that* over the link would lose the list the link was for.
	 * @type {string | null}
	 */
	let pending = initial.address;

	function write() {
		if (!win || !open || pending) return;
		const next = listLinkHref(open, win.location.href);
		// `replaceState`, not `location.hash =`: no history entry per list, no
		// `hashchange` back at ourselves. SvelteKit's own state is passed through.
		if (next !== win.location.href) win.history.replaceState(win.history.state, '', next);
	}

	async function openPending() {
		const address = pending;
		if (!address || !openAddress) return;
		try {
			await openAddress(address);
		} finally {
			if (pending === address) pending = null;
			write();
		}
	}

	return {
		/** What the link asked for when the page loaded. */
		initial,

		/**
		 * The page reports the list that is open now; the address bar follows.
		 * @param {OpenList | null} list
		 */
		show(list) {
			open = list;
			write();
		},

		/** Open the linked address, once the page can open lists at all. */
		openLinked: openPending,

		/**
		 * Follow a link opened in this very tab — pasted into the address bar, or
		 * a fragment-only navigation — which the browser does not reload for.
		 * A fragment without our keys (escrow01's section tabs) gets the open
		 * list put back.
		 *
		 * @returns {() => void} stop listening
		 */
		listen() {
			if (!win) return () => {};
			const onHashChange = () => {
				const linked = read(win.location.href);
				if (linked.address && linked.address !== normalizeListAddress(open?.address ?? '')) {
					pending = linked.address;
					void openPending();
				} else if (linked.words && !linked.address && linked.words !== open?.words) {
					openWords(linked.words);
				} else {
					write();
				}
			};
			win.addEventListener('hashchange', onHashChange);
			return () => win.removeEventListener('hashchange', onHashChange);
		}
	};
}
