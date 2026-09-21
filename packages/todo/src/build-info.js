/**
 * Reporting what this build is made of.
 *
 * The numbers are Vite `define` substitutions (see vite.config.js), fixed when
 * the bundle is built, so nothing here reads a package.json at runtime.
 */
import { describeMoment } from './moment.js';

/**
 * The stack the app is built against, one entry per dependency.
 *
 * Read through `typeof` guards because these are build-time substitutions, not
 * imports: anything consuming this module outside a Vite build simply sees no
 * versions.
 *
 * @returns {{ name: string, version: string }[]} only dependencies whose
 *   version was actually baked in — a name with no number is left out rather
 *   than shown with a placeholder that would be another wrong version on screen.
 */
function stackVersions() {
	const baked = [
		['OrbitDB', typeof __ORBITDB_VERSION__ !== 'undefined' ? __ORBITDB_VERSION__ : null],
		['Helia', typeof __HELIA_VERSION__ !== 'undefined' ? __HELIA_VERSION__ : null],
		['libp2p', typeof __LIBP2P_VERSION__ !== 'undefined' ? __LIBP2P_VERSION__ : null]
	];

	return baked
		.filter(([, version]) => typeof version === 'string' && version.length > 0)
		.map(([name, version]) => ({ name: String(name), version: String(version) }));
}

/**
 * The build date as a moment, in the reader's locale, clock and zone.
 *
 * The date is the commit's (see `node/chapter-commit.js`), not the build
 * machine's clock, and the zone is always named: the stamp it replaces glued a
 * UTC date to the build machine's local time, so a build made in Berlin just
 * after midnight was dated a day early — and no reader could tell whose clock
 * any of it was.
 *
 * @param {string} [iso] the baked ISO timestamp
 * @param {string | string[]} [locales] defaults to the browser's own
 * @returns {string}
 */
export function formatBuildDate(iso, locales = undefined) {
	if (typeof iso !== 'string' || iso.length === 0) {
		return 'dev';
	}

	// Anything unparseable is shown as-is rather than swallowed: a build stamped
	// by an older toolchain is still more useful on screen than "Invalid Date",
	// and silently blanking it would hide which build someone is looking at.
	return describeMoment(iso, locales)?.local ?? iso;
}

/**
 * What this bundle was built from: the commit, and that commit's instant.
 *
 * Both are baked in by the chapter's vite.config.js. A build without git has
 * neither, and then there is nothing to show — a stamp taken from the clock
 * instead would claim a commit nobody can look up.
 *
 * @returns {{ commit: string, short: string, when: Date } | null}
 */
export function builtFrom() {
	const commit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__.trim().toLowerCase() : '';
	const short = shortCommit(commit);
	const iso = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
	const when = iso ? new Date(iso) : null;
	if (!short || !when || Number.isNaN(when.getTime())) return null;
	return { commit, short, when };
}

/**
 * A commit shortened to what a person compares.
 *
 * Seven characters is what `git log --oneline` prints, so the value can be
 * matched against the repository by eye. Empty for anything that is not a
 * commit, and the caller then leaves it out rather than showing a placeholder
 * that looks like a real answer.
 *
 * @param {string | null | undefined} sha
 * @returns {string}
 */
export function shortCommit(sha) {
	const trimmed = String(sha ?? '').trim();
	if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return '';
	return trimmed.slice(0, 7).toLowerCase();
}

/**
 * The versions line shown in the header and on the consent screen.
 *
 * Every number is preceded by the thing it belongs to. The line this replaces
 * read "IPFS + OrbitDB v0.2.0", gluing the app's own version onto the names of
 * two dependencies — so the app is now named alongside them instead of standing
 * in for them.
 *
 * @param {{ appName?: string }} [options] `appName` prefixes the app's own
 *   version; omit it where a heading already names the app.
 * @returns {string} e.g. "Simple-Todo v0.2.0 · OrbitDB 4.0.0 · Helia 7.1.0"
 */
export function formatVersions({ appName = '' } = {}) {
	const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
	const app = appName ? `${appName} v${appVersion}` : `v${appVersion}`;

	return [app, ...stackVersions().map(({ name, version }) => `${name} ${version}`)].join(' · ');
}
