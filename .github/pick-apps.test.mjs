import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickApps } from './pick-apps.mjs';

const all = ['acl01', 'escrow01', 'main', 'qr01'];

test('testing: a shared change concerns every app', () => {
	assert.deepEqual(pickApps({ changed: ['packages/ui/src/AppFooter.svelte'], all }).apps, all);
});

test('testing: an app change concerns that app, tests and docs included', () => {
	assert.deepEqual(pickApps({ changed: ['apps/qr01/e2e/footer.spec.js'], all }).apps, ['qr01']);
});

test('testing: a dependency one app takes concerns that app', () => {
	// Adding a font to one chapter moves the root lockfile. Testing all nine for
	// that is how an unrelated two-browser spec turns a green change red.
	const picked = pickApps({
		changed: ['apps/escrow01/package.json', 'apps/escrow01/src/lib/x.js', 'pnpm-lock.yaml'],
		all
	});
	assert.deepEqual(picked.apps, ['escrow01']);
});

test('testing: a lockfile nobody declared for is still everybody’s business', () => {
	// A shared package moved, or somebody ran an update at the root.
	assert.deepEqual(pickApps({ changed: ['pnpm-lock.yaml'], all }).apps, all);
});

test('testing: the lockfile beside a shared change still concerns every app', () => {
	const picked = pickApps({
		changed: ['apps/qr01/package.json', 'packages/ui/src/AppFooter.svelte', 'pnpm-lock.yaml'],
		all
	});
	assert.deepEqual(picked.apps, all);
});

test('deploying: only the chapter whose build inputs changed', () => {
	const picked = pickApps({
		changed: ['apps/escrow01/src/routes/+page.svelte', 'apps/qr01/README.md'],
		all,
		mode: 'deploy'
	});
	assert.deepEqual(picked, { apps: ['escrow01'], mayAffect: [] });
});

test('deploying: a shared change deploys nothing, and says what it may concern', () => {
	const picked = pickApps({
		changed: ['packages/ui/src/AppFooter.svelte', 'apps/escrow01/src/lib/x.js'],
		all,
		mode: 'deploy'
	});
	assert.deepEqual(picked, { apps: ['escrow01'], mayAffect: ['acl01', 'main', 'qr01'] });
});

test('deploying: docs, tests, contracts and chapter.json are not build inputs', () => {
	const picked = pickApps({
		changed: [
			'apps/escrow01/docs/demo.de.md',
			'apps/escrow01/e2e/sections.spec.js',
			'apps/escrow01/contracts/src/Escrow.sol',
			'apps/escrow01/src/lib/moment.spec.js',
			'apps/escrow01/chapter.json',
			'README.md'
		],
		all,
		mode: 'deploy'
	});
	assert.deepEqual(picked, { apps: [], mayAffect: [] });
});

test('deploying: a workflow change alone deploys nothing', () => {
	const picked = pickApps({ changed: ['.github/workflows/deploy.yml'], all, mode: 'deploy' });
	assert.deepEqual(picked, { apps: [], mayAffect: all });
});
