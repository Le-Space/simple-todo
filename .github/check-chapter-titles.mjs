/**
 * Every chapter's browser tab says which chapter it is.
 *
 * All nine used to say "Simple-Todo", because each new chapter is a copy of the
 * one before it and the title came along unread. With nine tabs open that is
 * nine identical labels, and escrow01 even overwrote the chapter-specific title
 * in its own `app.html` — the runtime one wins, and it said what all the others
 * said.
 *
 * Two rules, both about a copy that was never adjusted rather than about
 * typography:
 *
 *   1. Exactly one `<title>` per chapter in `src/`. There used to be two, in
 *      `+layout.svelte` and in `+page.svelte`, saying the same thing; a fix
 *      applied to one of them would have been invisible.
 *   2. That title and the one in `app.html` both name the chapter's directory —
 *      except `main`, which is the app the other chapters are variations of and
 *      carries the product name.
 *   3. The installed app says it too: `app.html` links the chapter's own web
 *      app manifest (`manifest/<chapter>.json`, written by
 *      packages/brand/write-manifests.mjs), and its `application-name` and
 *      `apple-mobile-web-app-title` name the chapter — those are the labels
 *      under the icon on Android and iOS. Ten chapters installed under one
 *      name "Simple-Todo" was how this rule came about.
 *
 * Static on purpose: it catches the copy-paste at the moment it happens, in
 * milliseconds, without starting nine browsers to read nine strings.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APPS = 'apps';
/** The base app, which carries the product name rather than a chapter name. */
const BASE = 'main';

/** @param {string} file */
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** @param {string} html */
const titlesIn = (html) => [...html.matchAll(/<title\s*>?([^<]*)<\/title/g)].map((m) => m[1]);

/**
 * Every `.svelte` file under a directory, so a title cannot hide in a component.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function svelteFiles(dir) {
	/** @type {string[]} */
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...svelteFiles(path));
		else if (entry.name.endsWith('.svelte')) out.push(path);
	}
	return out;
}

/** @type {string[]} */
const problems = [];

for (const chapter of readdirSync(APPS).sort()) {
	const src = join(APPS, chapter, 'src');
	if (!existsSync(src)) continue;

	const runtime = svelteFiles(src).flatMap((file) =>
		titlesIn(read(file) ?? '').map((title) => ({ file, title }))
	);
	if (runtime.length !== 1) {
		problems.push(
			`${chapter}: ${runtime.length} runtime titles, expected 1` +
				runtime.map((r) => `\n    ${r.file}: ${r.title.trim()}`).join('')
		);
	}

	const staticTitle = titlesIn(read(join(src, 'app.html')) ?? '')[0];
	if (!staticTitle) problems.push(`${chapter}: no <title> in app.html`);

	// The manifest and the two home-screen labels, for every chapter.
	const html = read(join(src, 'app.html')) ?? '';
	const manifestHref = html.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
	if (manifestHref !== `./manifest/${chapter}.json`) {
		problems.push(
			`${chapter}: app.html links ${manifestHref ?? 'no manifest'}, not ./manifest/${chapter}.json`
		);
	}
	// A chapter may carry a home-screen name of its own (qr01: "QR-Todo"); it
	// says so in chapter.json, and the generator and this check both read it.
	const chapterMeta = JSON.parse(read(join(APPS, chapter, 'chapter.json')) ?? '{}');
	const label = chapter === BASE ? 'Simple-Todo' : (chapterMeta.label ?? chapter);
	const manifestFile = join('packages', 'brand', 'static', 'manifest', `${chapter}.json`);
	const manifest = read(manifestFile);
	if (!manifest) {
		problems.push(
			`${chapter}: ${manifestFile} is missing (node packages/brand/write-manifests.mjs)`
		);
	} else {
		const { name, short_name } = JSON.parse(manifest);
		if (!String(name).includes(label) || short_name !== label) {
			problems.push(
				`${chapter}: ${manifestFile} does not name the chapter: ${name} / ${short_name}`
			);
		}
	}
	for (const meta of ['application-name', 'apple-mobile-web-app-title']) {
		const content = html.match(new RegExp(`<meta name="${meta}" content="([^"]*)"`))?.[1];
		if (content !== label) {
			problems.push(`${chapter}: app.html ${meta} is "${content ?? ''}", expected "${label}"`);
		}
	}

	if (chapter === BASE) continue;
	for (const { title, where } of [
		...runtime.map((r) => ({ title: r.title, where: r.file })),
		{ title: staticTitle ?? '', where: join(src, 'app.html') }
	]) {
		if (!title.includes(chapter)) {
			problems.push(`${chapter}: ${where} does not name the chapter: ${title.trim()}`);
		}
	}
}

if (problems.length) {
	console.error('Chapter titles:\n- ' + problems.join('\n- '));
	process.exit(1);
}

console.log(
	'Chapter titles: every chapter names itself, once — in the tab and on the home screen.'
);
