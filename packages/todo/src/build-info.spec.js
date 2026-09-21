import { describe, expect, it } from 'vitest';
import { formatBuildDate, formatVersions, shortCommit } from './build-info.js';

describe('formatVersions', () => {
	it('puts the app name in front of the app version', () => {
		const [app] = formatVersions({ appName: 'Simple-Todo' }).split(' · ');

		expect(app).toBe(`Simple-Todo v${__APP_VERSION__}`);
	});

	it('drops the app name where a heading already carries it', () => {
		const [app] = formatVersions().split(' · ');

		expect(app).toBe(`v${__APP_VERSION__}`);
	});

	it('states each dependency with the version that shipped with it', () => {
		// The regression this guards: the header read "IPFS + OrbitDB v0.2.0",
		// putting the app's own version where a reader reads an OrbitDB version.
		const stack = formatVersions().split(' · ').slice(1);

		expect(stack).toContain(`OrbitDB ${__ORBITDB_VERSION__}`);
		expect(stack).not.toContain(`OrbitDB ${__APP_VERSION__}`);
	});

	it('never names a dependency without a version behind it', () => {
		// The app's own segment is exempt: it is either "v0.2.0" under a heading
		// that names the app, or "Simple-Todo v0.2.0" where no heading does.
		for (const entry of formatVersions().split(' · ').slice(1)) {
			expect(entry).toMatch(/^\S.* \d+\.\d+\.\d+/);
		}
	});
});

describe('shortCommit', () => {
	it('shortens to the seven characters git log prints', () => {
		expect(shortCommit('9f3c1ab7d4e5f60718293a4b5c6d7e8f90a1b2c3')).toBe('9f3c1ab');
	});

	it('lowercases, so a value from CI matches one from git', () => {
		expect(shortCommit('9F3C1AB7D4E5F6')).toBe('9f3c1ab');
	});

	it('returns nothing for something that is no commit, so the caller omits it', () => {
		for (const value of ['', '   ', undefined, null, 'not-a-sha', 'abc123']) {
			expect(shortCommit(/** @type {any} */ (value))).toBe('');
		}
	});
});

describe('formatBuildDate', () => {
	it('names the zone, in the reader’s locale', () => {
		const plain = formatBuildDate('2026-09-19T22:48:00Z', 'de-DE').replace(/[\s\u202f\u00a0]+/g, ' ');
		expect(plain).toMatch(/^\d\d\.\d\d\.2026, \d\d:\d\d \S+$/);
	});

	it('says dev for a build without a commit, and shows anything else as it came', () => {
		expect(formatBuildDate('')).toBe('dev');
		expect(formatBuildDate('last tuesday')).toBe('last tuesday');
	});
});
