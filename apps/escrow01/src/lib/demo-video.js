import { writable } from 'svelte/store';
import deCaptions from './demo-video/escrow01-de.vtt?url&no-inline';
import dePoster from './demo-video/escrow01-de-poster.jpg?url&no-inline';
import deVideo from './demo-video/escrow01-de.mp4?url&no-inline';
import enCaptions from './demo-video/escrow01-en.vtt?url&no-inline';
import enPoster from './demo-video/escrow01-en-poster.jpg?url&no-inline';
import enVideo from './demo-video/escrow01-en.mp4?url&no-inline';
// One teaser picture for both languages: a ▶ on coral, no text in it.
import thumb from './demo-video/escrow01-thumb.png?url&no-inline';

/**
 * The demo video, per language, in one place (escrow01).
 *
 * While a language has no entry, nothing about the video is on screen in that
 * language: no teaser in the start dialog, no link in the page header. A
 * missing language does not fall back to the other one: a German reader gets
 * no English video they did not ask for.
 *
 * The file plays from this site (`<video preload="none">`, so before a click
 * only the teaser's picture is fetched), and YouTube is a plain link beside
 * it: nothing is embedded, so no request goes to Google unless somebody
 * follows that link.
 * The file is 1080p H.264, at most 15 MB per language (decided 24.11.): it
 * ships with the build, and the build is what goes to IPFS and Aleph.
 *
 * The files sit beside this module in `demo-video/` and are imported, so Vite
 * puts them into escrow01's build alone, under hashed names and with paths
 * relative to the page. `static/` would not do: this chapter's assets folder
 * is `packages/brand/static`, which every chapter ships, so a film there
 * would be 13 MB in all of them. `no-inline` keeps the small thumb and the
 * captions files as files, not data URLs.
 *
 * @typedef {{
 *   src: string,
 *   poster: string,
 *   thumb?: string | null,
 *   captions: string,
 *   youtubeId?: string | null,
 *   duration: string
 * }} DemoVideo
 * `duration` is what the teaser shows, as `m:ss`. `thumb` is the teaser's
 * own small picture (48×27 on screen, so 96×54 for sharp displays, and no
 * small text in it); without one the teaser shrinks the player's `poster`.
 * `captions` is a WebVTT file in the entry's language, and not optional: an
 * entry without one is treated as no entry, because a video with speech and
 * no captions shuts out whoever watches without sound.
 *
 * @type {Record<'de' | 'en', DemoVideo | null>}
 */
export const videos = {
	de: {
		src: deVideo,
		poster: dePoster,
		thumb,
		captions: deCaptions,
		youtubeId: 'VGXKbYh02Eg',
		duration: '3:50'
	},
	en: {
		src: enVideo,
		poster: enPoster,
		thumb,
		captions: enCaptions,
		youtubeId: 'cnYjurOTO3M',
		duration: '3:44'
	}
};

/**
 * The video for a language, or null when there is none.
 *
 * E2E builds may hand in their own entries (`__escrow01DemoVideos`, set before
 * the page loads), so the spec for the teaser can test it before there is a
 * video to show.
 *
 * @param {string | null | undefined} locale
 * @returns {DemoVideo | null}
 */
export function demoVideoFor(locale) {
	const language = String(locale ?? '').slice(0, 2) === 'de' ? 'de' : 'en';
	const override =
		import.meta.env.VITE_E2E === 'true'
			? /** @type {any} */ (globalThis).__escrow01DemoVideos
			: undefined;
	const entry = (override ?? videos)[language] ?? null;
	return entry && entry.src && entry.poster && entry.captions ? entry : null;
}

/** The YouTube page for a video id, or null without one. */
export function youtubeUrl(/** @type {string | null | undefined} */ id) {
	return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : null;
}

/**
 * Whether the player is open, and the control that opened it: focus goes
 * back there when the player closes. One player for both ways in — the
 * teaser in the start dialog and the link in the page header.
 *
 * @type {import('svelte/store').Writable<HTMLElement | null>}
 */
export const demoVideoOpener = writable(null);
