#!/usr/bin/env node
/**
 * Which apps a change concerns.
 *
 * An app's own folder concerns that app. Anything else — packages, tools, the
 * workflows, the lockfile — concerns all of them, because that is exactly what
 * the split into packages made possible to break everywhere at once.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';

const all = readdirSync('apps', { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name)
	.sort();

const chosen = (() => {
	const asked = (process.env.APPS_INPUT ?? '').trim();
	if (asked) return asked.split(/\s+/).filter((a) => all.includes(a));

	const base = process.env.BASE_SHA;
	const head = process.env.HEAD_SHA;
	if (!base || !head) return all;

	const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
		encoding: 'utf8'
	})
		.split('\n')
		.filter(Boolean);

	if (changed.length === 0) return [];
	if (changed.some((f) => !f.startsWith('apps/'))) return all;

	const touched = new Set(changed.map((f) => f.split('/')[1]));
	return all.filter((a) => touched.has(a));
})();

console.log(`apps: ${chosen.join(', ') || '(keine)'}`);
appendFileSync(process.env.GITHUB_OUTPUT, `apps=${JSON.stringify(chosen)}\n`);
