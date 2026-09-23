/**
 * Where the relay button remembers the place somebody dragged it to.
 *
 * The widget (`@le-space/ui`) stores nothing unless it is given a key, and it
 * writes into `localStorage` under whatever key it gets. One key for every
 * chapter, with this repository's `simpleTodo.` prefix, so a reader who moves
 * the button in one chapter finds it in the same corner in the next — and so
 * the value is cleared with everything else when a chapter forgets a device.
 *
 * Dragging arrived in `@le-space/ui` 0.9.2 (relay-button#114). Before it, the
 * launcher sat 22 px from the bottom right corner with no way to be told about
 * anything else down there.
 */
export const RELAY_FAB_POSITION_KEY = 'simpleTodo.relayFabPosition';
