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
			build: {
				state: 'Built'
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
			build: {
				state: 'Stand'
			}
		}
	}
};
