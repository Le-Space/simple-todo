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

// The relay runs rent a VM, so the question is not "could this concern the
// chapter" but "could this break a relay". `all` here is already the list of
// chapters that opted in, which is what the workflow passes.
test('relay: prose rents nothing', () => {
	const picked = pickApps({
		changed: ['README.md', 'docs/FROZEN.md', 'apps/main/README.md', 'apps/main/docs/demo.md'],
		all: ['main'],
		mode: 'relay'
	});
	assert.deepEqual(picked, { apps: [], mayAffect: [] });
});

test('relay: the provisioning spec itself is the point of the run', () => {
	// `deploy` mode calls everything under e2e/ a non-input. Here it is the input.
	const picked = pickApps({
		changed: ['apps/main/e2e/relay-button-provisioning.spec.js'],
		all: ['main'],
		mode: 'relay'
	});
	assert.deepEqual(picked.apps, ['main']);
});

test('relay: a shared change reaches the relay path', () => {
	for (const file of ['packages/net/src/libp2p-config.js', 'pnpm-lock.yaml']) {
		assert.deepEqual(
			pickApps({ changed: [file], all: ['main'], mode: 'relay' }).apps,
			['main'],
			file
		);
	}
});

test('relay: another chapter’s change rents nothing', () => {
	const picked = pickApps({
		changed: ['apps/qr01/src/lib/x.js'],
		all: ['main'],
		mode: 'relay'
	});
	assert.deepEqual(picked.apps, []);
});

test('relay: prose beside real code still runs', () => {
	const picked = pickApps({
		changed: ['apps/main/README.md', 'apps/main/src/lib/p2p.js'],
		all: ['main'],
		mode: 'relay'
	});
	assert.deepEqual(picked.apps, ['main']);
});
