#!/usr/bin/env node
/**
 * Which apps a change concerns — for testing, and for deploying.
 *
 * Testing (the default): an app's own folder concerns that app, and anything
 * else — packages, tools, the workflows, the lockfile — concerns all of them,
 * because that is exactly what the split into packages made possible to break
 * everywhere at once.
 *
 * Deploying (`PICK_MODE=deploy`): only an app whose own build inputs changed
 * goes live. Each chapter has its own domain and its own audience, and a push
 * that touches a shared package, a workflow or the lockfile does not redeploy
 * nine sites on its own; the run's summary names the chapters it may affect,
 * and a manual run (`workflow_dispatch`, input `apps`) deploys them when that
 * is wanted. Documentation, tests and escrow01's contracts are not build
 * inputs either: changing them deploys nothing.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Paths inside an app that never reach its build. */
const NOT_BUILT = [
	/\.md$/i,
	/^apps\/[^/]+\/docs\//,
	/^apps\/[^/]+\/e2e\//,
	/\.spec\.[cm]?js$/,
	/^apps\/[^/]+\/playwright[^/]*\.config\.[cm]?js$/,
	/^apps\/[^/]+\/contracts\//,
	/^apps\/[^/]+\/chapter\.json$/
];

/**
 * @param {{ changed: string[], all: string[], mode?: 'test' | 'deploy' }} input
 * @returns {{ apps: string[], mayAffect: string[] }} `mayAffect`: in deploy
 *   mode, the apps a change outside their folders could concern
 */
export function pickApps({ changed, all, mode = 'test' }) {
	if (changed.length === 0) return { apps: [], mayAffect: [] };
	const outside = changed.filter((f) => !f.startsWith('apps/'));
	const inside = changed.filter((f) => f.startsWith('apps/'));

	if (mode !== 'deploy') {
		if (outside.length > 0) return { apps: all, mayAffect: [] };
		const touched = new Set(inside.map((f) => f.split('/')[1]));
		return { apps: all.filter((a) => touched.has(a)), mayAffect: [] };
	}

	const built = new Set(
		inside.filter((f) => !NOT_BUILT.some((rule) => rule.test(f))).map((f) => f.split('/')[1])
	);
	const sharedChanged = outside.some((f) => !/\.md$/i.test(f) && !f.startsWith('docs/'));
	const apps = all.filter((a) => built.has(a));
	return { apps, mayAffect: sharedChanged ? all.filter((a) => !built.has(a)) : [] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const all = readdirSync('apps', { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	const mode = process.env.PICK_MODE === 'deploy' ? 'deploy' : 'test';

	const { apps, mayAffect } = (() => {
		const asked = (process.env.APPS_INPUT ?? '').trim();
		if (asked) return { apps: asked.split(/\s+/).filter((a) => all.includes(a)), mayAffect: [] };

		const base = process.env.BASE_SHA;
		const head = process.env.HEAD_SHA;
		// No base to compare with: a first push, or a manual run with no list.
		// Tests run everything; a deploy with nothing named deploys everything
		// only when asked to by hand, which is the manual run with empty input.
		if (!base || !head || /^0+$/.test(base)) return { apps: all, mayAffect: [] };

		const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
			encoding: 'utf8'
		})
			.split('\n')
			.filter(Boolean);
		return pickApps({ changed, all, mode });
	})();

	console.log(`apps (${mode}): ${apps.join(', ') || '(keine)'}`);
	appendFileSync(process.env.GITHUB_OUTPUT, `apps=${JSON.stringify(apps)}\n`);
	if (mayAffect.length > 0 && process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			[
				'### Not deployed automatically',
				'',
				'This push changed shared code outside the chapters, which may concern:',
				'',
				`\`${mayAffect.join(' ')}\``,
				'',
				'Deploy them by hand when that is wanted:',
				'',
				'```',
				`gh workflow run deploy.yml -R Le-Space/simple-todo -f apps="${mayAffect.join(' ')}"`,
				'```',
				''
			].join('\n')
		);
	}
}
