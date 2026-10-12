import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	atLeast,
	commentBody,
	decide,
	lastStateLine,
	minorOf,
	missing,
	ready,
	routeState,
	stateLine,
	versionFromCall
} from './zama-watch.mjs';

/** What the watch measured on 2026-10-12, with overrides. @param {any} [over] */
const measured = (over = {}) => ({
	route: 'absent',
	status: { v2: 400, v3: 404 },
	kms: '0.3.0',
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

test("the KMSVerifier's version, read from its getVersion() answer", () => {
	// What Sepolia answered on 2026-10-12: the ABI-encoded "KMSVerifier v0.3.0".
	const answer =
		'0x0000000000000000000000000000000000000000000000000000000000000020' +
		'0000000000000000000000000000000000000000000000000000000000000012' +
		'4b4d5356657269666965722076302e332e300000000000000000000000000000';
	assert.equal(versionFromCall(answer), '0.3.0');
	assert.equal(versionFromCall('0x'), null);
	assert.equal(versionFromCall(undefined), null);
	assert.equal(versionFromCall({ code: -32000 }), null);
	// A string without a version in it.
	assert.equal(
		versionFromCall(
			'0x0000000000000000000000000000000000000000000000000000000000000020' +
				'0000000000000000000000000000000000000000000000000000000000000003' +
				'6e6f6e0000000000000000000000000000000000000000000000000000000000'
		),
		null
	);
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
		'relayer-v3=absent kms-verifier=0.3 latest=3.6 latest-unified=no beta-unified=no alpha-unified=yes'
	);
	assert.equal(ready(measured()), false);
	assert.equal(missing(measured()).length, 3);
});

test('ready takes all three: the route, the released SDK, and KMSVerifier 0.4', () => {
	const route = { route: 'present', status: { v2: 400, v3: 400 } };
	const sdk = { tags: { latest: { version: '3.8.0', fhevm: '0.14.3' } } };
	const kms = { kms: '0.4.0' };
	assert.equal(ready(measured({ ...route, ...sdk })), false);
	assert.equal(ready(measured({ ...route, ...kms })), false);
	assert.equal(ready(measured({ ...sdk, ...kms })), false);
	assert.equal(ready(measured({ ...route, ...sdk, ...kms })), true);
	assert.equal(ready(measured({ ...route, ...sdk, kms: null })), false);
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
	assert.equal(decide(stateLine(now), measured({ kms: '0.4.0' })).post, true);
	assert.equal(decide(stateLine(now), measured({ kms: '0.3.1' })).post, false);
	const silent = measured({ route: 'unclear', status: { v2: null, v3: null } });
	assert.equal(decide(null, silent).post, false);
	assert.equal(decide('anything else', silent).post, false);
	const noKms = measured({ kms: null });
	assert.equal(decide(null, noKms).post, false);
	assert.equal(decide('anything else', noKms).post, false);
});

test('the comment carries its state line, and the newest one is what counts', () => {
	const old = commentBody(measured(), '2026-10-12');
	const newer = commentBody(
		measured({ tags: { latest: { version: '3.7.0', fhevm: '0.13.2' } } }),
		'2026-10-19'
	);
	assert.equal(
		lastStateLine([{ body: 'a person writes' }, { body: old }, { body: null }, { body: newer }]),
		'relayer-v3=absent kms-verifier=0.3 latest=3.7 latest-unified=no beta-unified=no alpha-unified=yes'
	);
	assert.equal(lastStateLine([{ body: 'nothing from the watch' }]), null);
});

test('the comment says plainly what is missing', () => {
	assert.match(
		commentBody(measured(), 'd'),
		/^Zama watch, d\. \*\*Not yet\.\*\* Still missing: the unified route on the Sepolia relayer \(`v3\/user-decrypt` answers 404\); a released SDK on `@fhevm\/sdk` 0\.14 \(`latest` depends on 0\.13\.2\); KMSVerifier 0\.4\.0 on Sepolia \(it is 0\.3\.0\)\./
	);
	const routeAndSdk = commentBody(
		measured({
			route: 'present',
			status: { v2: 400, v3: 400 },
			tags: { latest: { version: '3.8.0', fhevm: '0.14.3' } }
		}),
		'd'
	);
	assert.match(routeAndSdk, /Still missing: KMSVerifier 0\.4\.0 on Sepolia \(it is 0\.3\.0\)\.$/m);
	assert.doesNotMatch(routeAndSdk, /relayer \(|a released SDK/);
	assert.match(
		commentBody(
			measured({
				route: 'present',
				status: { v2: 400, v3: 400 },
				kms: '0.4.0',
				tags: { latest: { version: '3.8.0', fhevm: '0.14.3' } }
			}),
			'd'
		),
		/\*\*All three are there\.\*\*/
	);
	assert.match(
		commentBody(measured(), 'd'),
		/\| `KMSVerifier` `0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A` \| 0\.3\.0 \| 0\.4\.0 \|/
	);
	assert.match(
		commentBody(measured({ tags: { beta: { version: null, fhevm: null } } }), 'd'),
		/\| `beta` \| — \| — \| none \|/
	);
});
