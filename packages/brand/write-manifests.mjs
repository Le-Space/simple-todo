/**
 * One web app manifest per chapter, so an installed chapter says which one it
 * is.
 *
 * All ten chapters are progressive web apps, and until now every one of them
 * installed under the same name — the shared `static/manifest.json` said
 * "Simple-Todo", so a phone with three chapters on it showed three identical
 * icons with three identical labels. Each chapter gets its own file here,
 * named after its directory, and links it from its `app.html`.
 *
 *   node packages/brand/write-manifests.mjs      # from the repository root
 *
 * The files are committed, because `static/` is copied as it is; CI's
 * check-chapter-titles.mjs refuses a chapter whose manifest is missing or
 * does not name it. `main` is the app the others are variations of and keeps
 * the product name; every other chapter is "<chapter> · Simple-Todo" with
 * the chapter alone as the short name — the label under the icon has room
 * for about twelve characters, and "delegation01" is twelve.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'packages', 'brand', 'static', 'manifest');
mkdirSync(out, { recursive: true });

/** @param {string} chapter @param {{ title?: string, label?: string }} meta - `label`: a chapter's own home-screen name, when it has one (qr01) */
export function manifestFor(chapter, meta) {
	const base = chapter === 'main';
	const label = base ? 'Simple-Todo' : (meta.label ?? chapter);
	return {
		name: base ? 'Simple-Todo' : `${label} · Simple-Todo`,
		short_name: label,
		description: base
			? 'A local-first peer-to-peer todo list using OrbitDB, IPFS and libp2p. No servers, no accounts, no passwords.'
			: `${meta.title ?? chapter} — a chapter of Simple-Todo, the local-first peer-to-peer todo list on OrbitDB, IPFS and libp2p.`,
		start_url: '/',
		display: 'standalone',
		background_color: '#0B0E15',
		theme_color: '#0B0E15',
		categories: ['productivity', 'utilities'],
		icons: [
			{ src: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
			{ src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
			{ src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
			{ src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
		]
	};
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	for (const chapter of readdirSync(join(root, 'apps'), { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort()) {
		const file = join(root, 'apps', chapter, 'chapter.json');
		const meta = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
		writeFileSync(
			join(out, `${chapter}.json`),
			JSON.stringify(manifestFor(chapter, meta), null, 2) + '\n'
		);
		console.log(`  ${chapter.padEnd(13)} manifest/${chapter}.json`);
	}
}
