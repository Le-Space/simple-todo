/**
 * What this chapter does with your data, in plain words, as a function of the
 * choices on the consent screen. The dialog itself is shared
 * (`@simple-todo/ui/ConsentModal.svelte`); the statement is the chapter's.
 * This chapter has no catalogue, so the sentences are English and live here.
 *
 * These were four acknowledgement checkboxes and a six-line notice that said
 * the same things twice. A tick against a line somebody has just read confirms
 * only that they can read; the one tick that remains, the element's, accepts
 * this statement. Cookies last: the only line about this dialog itself.
 *
 * @param {{ storage?: string }} state
 * @returns {string[]}
 */
export const clauses = (state) =>
	[
		'We run no server, and no copy of your list exists anywhere we control.',
		'The app itself is delivered through a public IPFS gateway, which sees that you loaded it. Your own Kubo node, or the IPFS Companion extension, fetches it from the network instead.',
		'Your todos live in this browser and reach other browsers through the peer-to-peer network: relay and bootstrap nodes introduce devices to each other, and may keep a copy of the list so another device can collect it later.',
		'The list named by the three Spanish words is open and not encrypted: anyone who has the words can read it and write to it, the relay included. Treat the words as a way to meet, not as a password, and do not put anything private in a todo.',
		'Collaboration needs another browser or device with the same app and the same three words.',
		state.storage === 'indexeddb'
			? 'You chose "keep them in this browser": the todos survive a reload. They sit unencrypted in this browser’s storage, and clearing it loses them.'
			: 'You chose "in memory only": nothing is written to this device, and this browser starts over when the page reloads.',
		'No tracking cookies are used. If you tick "don\'t show this again", that choice is the only thing saved on this device.'
	].filter(Boolean);
