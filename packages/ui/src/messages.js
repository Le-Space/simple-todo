/**
 * The wording the shared components bring with them, in both languages.
 *
 * A chapter used to get a German shared component only by copying its keys
 * into its own catalogue, and five chapters had not: their theme toggle said
 * "Switch to dark mode" on a German page. Now the component's strings live next
 * to the component, and a chapter adds them to svelte-i18n *before* its own
 * catalogue — so it can still reword one, and never has to repeat one.
 *
 * Everything sits under `ui.` so a shared key cannot collide with a chapter's.
 * `$t(key, english)` in the components still carries the English, for the one
 * chapter without a catalogue (collab01).
 *
 * @example
 *   import { uiMessages } from '@simple-todo/ui/messages.js';
 *   addMessages('de', uiMessages.de);
 *   addMessages('en', uiMessages.en);
 *   addMessages('de', de); // the chapter's own, last, so it wins
 */
export const uiMessages = {
	en: {
		ui: {
			theme: {
				toLight: 'Switch to light mode',
				toDark: 'Switch to dark mode',
				light: 'Light mode',
				dark: 'Dark mode'
			},
			credit: {
				madeWith: 'Made with'
			},
			localFirst: {
				link: 'Le Space: the local-first stack behind this app'
			},
			build: {
				state: 'Built'
			},
			pageQr: {
				open: 'This page as a QR code',
				dialog: 'QR code of this page',
				hint: 'Scan with your phone — it opens exactly this page.',
				hintList: 'Scan with your phone — it opens this page, and this list.'
			},
			listLink: {
				rejected: 'The link names a list this page cannot open, so it starts with its own.',
				openFailed: 'The list from the link could not be opened: {reason}'
			}
		}
	},
	de: {
		ui: {
			theme: {
				toLight: 'Zum hellen Modus wechseln',
				toDark: 'Zum dunklen Modus wechseln',
				light: 'Heller Modus',
				dark: 'Dunkler Modus'
			},
			credit: {
				madeWith: 'Gebaut mit'
			},
			localFirst: {
				link: 'Le Space: der Local-First-Stack hinter dieser App'
			},
			build: {
				state: 'Stand'
			},
			pageQr: {
				open: 'Diese Seite als QR-Code',
				dialog: 'QR-Code dieser Seite',
				hint: 'Mit dem Telefon scannen — öffnet genau diese Seite.',
				hintList: 'Mit dem Telefon scannen — öffnet diese Seite und diese Liste.'
			},
			listLink: {
				rejected: 'Der Link nennt eine Liste, die diese Seite nicht öffnen kann; sie beginnt mit ihrer eigenen.',
				openFailed: 'Die Liste aus dem Link ließ sich nicht öffnen: {reason}'
			}
		}
	}
};
