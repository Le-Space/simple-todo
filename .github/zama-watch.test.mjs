import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	atLeast,
	commentBody,
	decide,
	lastStateLine,
	minorOf,
	ready,
	routeState,
	stateLine
} from './zama-watch.mjs';

/** What the watch measured on 2026-10-12, with overrides. @param {any} [over] */
const measured = (over = {}) => ({
	route: 'absent',
	status: { v2: 400, v3: 404 },
	pinned: '3.6.0',
	...over,
	tags: {
		latest: { version: '3.6.0', fhevm: '0.13.2' },
		beta: { version: '3.7.0-beta.8', fhevm: '0.13.2' },
		alpha: { version: '4.0.0-alpha.1', fhevm: '0.14.1-1' },
		...over.tags
	}
});

test('the route: 400 is there, 404 is not, and only with v2 answering 400 as the control', () => {
	assert.equal(routeState({ v2: 400, v3: 400 }), 'present');
	assert.equal(routeState({ v2: 400, v3: 404 }), 'absent');
	// A relayer that is down, or answers everything the same way, says nothing.
	assert.equal(routeState({ v2: null, v3: 404 }), 'unclear');
	assert.equal(routeState({ v2: 502, v3: 502 }), 'unclear');
	assert.equal(routeState({ v2: 400, v3: 500 }), 'unclear');
});

test('0.14: counted by its numbers, prereleases included, ranges read', () => {
	assert.equal(atLeast('0.13.2'), false);
	assert.equal(atLeast('0.13.99'), false);
	assert.equal(atLeast('0.14.0'), true);
	assert.equal(atLeast('0.14.1-1'), true);
	assert.equal(atLeast('^0.14.3'), true);
	assert.equal(atLeast('1.0.0'), true);
	assert.equal(atLeast(null), false);
	assert.equal(atLeast('workspace:*'), false);
});

test('a patch release is not news, a minor is', () => {
	assert.equal(minorOf('3.6.0'), '3.6');
	assert.equal(minorOf('3.6.1'), '3.6');
	assert.equal(minorOf('3.7.0'), '3.7');
	assert.equal(minorOf(null), 'none');
});

test('the state line as of 2026-10-12', () => {
	assert.equal(
		stateLine(measured()),
		'relayer-v3=absent latest=3.6 latest-unified=no beta-unified=no alpha-unified=yes'
	);
	assert.equal(ready(measured()), false);
});

test('ready takes both halves: the route and the released SDK', () => {
	const sdk = { latest: { version: '3.8.0', fhevm: '0.14.3' } };
	assert.equal(ready(measured({ route: 'present', status: { v2: 400, v3: 400 } })), false);
	assert.equal(ready(measured({ tags: sdk })), false);
	assert.equal(
		ready(measured({ route: 'present', status: { v2: 400, v3: 400 }, tags: sdk })),
		true
	);
});

test('the issue hears a change once, and never a probe that said nothing', () => {
	const now = measured();
	assert.deepEqual(decide(null, now).post, true);
	assert.deepEqual(decide(stateLine(now), now).post, false);
	assert.equal(
		decide(stateLine(now), measured({ tags: { latest: { version: '3.7.0', fhevm: '0.13.2' } } }))
			.post,
		true
	);
	assert.equal(
		decide(stateLine(now), measured({ route: 'present', status: { v2: 400, v3: 400 } })).post,
		true
	);
	const silent = measured({ route: 'unclear', status: { v2: null, v3: null } });
	assert.equal(decide(null, silent).post, false);
	assert.equal(decide('anything else', silent).post, false);
});

test('the comment carries its state line, and the newest one is what counts', () => {
	const old = commentBody(measured(), '2026-10-12');
	const newer = commentBody(
		measured({ tags: { latest: { version: '3.7.0', fhevm: '0.13.2' } } }),
		'2026-10-19'
	);
	assert.equal(
		lastStateLine([{ body: 'a person writes' }, { body: old }, { body: null }, { body: newer }]),
		'relayer-v3=absent latest=3.7 latest-unified=no beta-unified=no alpha-unified=yes'
	);
	assert.equal(lastStateLine([{ body: 'nothing from the watch' }]), null);
});

test('the comment says plainly which half is missing', () => {
	assert.match(commentBody(measured(), 'd'), /^Zama watch, d\. \*\*Not yet\.\*\*/);
	assert.match(
		commentBody(measured({ route: 'present', status: { v2: 400, v3: 400 } }), 'd'),
		/The route is there; the released SDK is not yet/
	);
	assert.match(
		commentBody(
			measured({
				route: 'present',
				status: { v2: 400, v3: 400 },
				tags: { latest: { version: '3.8.0', fhevm: '0.14.3' } }
			}),
			'd'
		),
		/Both halves are there/
	);
	assert.match(
		commentBody(measured({ tags: { beta: { version: null, fhevm: null } } }), 'd'),
		/\| `beta` \| — \| — \| none \|/
	);
});
