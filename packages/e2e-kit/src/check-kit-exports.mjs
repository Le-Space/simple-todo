/**
 * Every helper a spec imports from the kit must exist.
 *
 * The kit was assembled from one chapter's e2e folder, so the helpers the other
 * chapters had were easy to lose in the move. A missing *function* fails loudly
 * at import time — but only in a spec CI actually runs, and several do not run
 * anywhere. This reads the imports instead, in milliseconds, for every spec.
 *
 * What it cannot see is an *option* a helper quietly ignores: `passConsent`
 * accepted `{ persistent }` from nobody for a while, and three storage specs
 * went on testing the default mode under the name of the mode they asked for.
 * That one needs the paired run against the frozen chapter.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const kitSrc = new URL('.', import.meta.url).pathname;
const appsDir = process.argv[2] ?? join(kitSrc, '..', '..', '..', 'apps');

/** @param {string} dir @param {(path: string) => boolean} keep */
function walk(dir, keep) {
	/** @type {string[]} */
	const found = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...walk(path, keep));
		else if (keep(path)) found.push(path);
	}
	return found;
}

/** @type {Map<string, Set<string>>} module file name -> exported names */
const exported = new Map();
for (const file of walk(kitSrc, (p) => p.endsWith('.mjs'))) {
	const source = readFileSync(file, 'utf8');
	const names = new Set([
		...source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm)
	].map((match) => match[1]));
	for (const group of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
		for (const name of group[1].split(',')) {
			const alias = name.split(/\sas\s/).pop()?.trim();
			if (alias) names.add(alias);
		}
	}
	exported.set(relative(kitSrc, file), names);
}

const problems = [];
for (const spec of walk(appsDir, (p) => p.endsWith('.spec.js') || p.endsWith('.mjs'))) {
	const source = readFileSync(spec, 'utf8');
	for (const [, imported, module] of source.matchAll(
		/import\s*\{([^}]*)\}\s*from\s*'@simple-todo\/e2e-kit\/([^']+)'/g
	)) {
		const known = exported.get(module);
		if (!known) {
			problems.push(`${relative(appsDir, spec)}: there is no kit module ${module}`);
			continue;
		}
		for (const name of imported.split(',').map((n) => n.trim().split(/\sas\s/)[0].trim())) {
			if (name && !known.has(name)) {
				problems.push(`${relative(appsDir, spec)}: ${module} exports no ${name}`);
			}
		}
	}
}

if (problems.length > 0) {
	console.error(problems.join('\n'));
	process.exit(1);
}
console.log('Every kit import resolves.');
