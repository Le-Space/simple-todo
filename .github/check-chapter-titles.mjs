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

console.log('Chapter titles: every chapter names itself, once.');
