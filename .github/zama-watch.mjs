/**
 * Whether Zama's side has moved far enough for escrow01's passkey to sign its
 * own decryption permits (Le-Space/simple-todo#54, step 3). Until then the app
 * keeps a read key, and nothing on our side can change that.
 *
 * Two things have to be true:
 * - The Sepolia relayer serves the unified route. Asked the way the SDK's own
 *   `canUseUnifiedDecryptionPermit` asks — an empty POST — `v3/user-decrypt`
 *   answers 400 when the route is there and 404 when it is not. `v2` is asked
 *   the same way as a control: if it does not answer 400 either, the probe
 *   says nothing this time.
 * - The `@zama-fhe/sdk` that npm calls `latest` depends on `@fhevm/sdk` 0.14 or
 *   later, the line with ERC-1271 permits. `beta` and `alpha` are reported
 *   too, as the early warning.
 *
 * Measured on 2026-10-02 and 2026-10-12: the route answered 404, and `latest`
 * (3.6.0) as well as `beta` depended on `@fhevm/sdk` 0.13.2.
 *
 *   node .github/zama-watch.mjs            measure, and say whether the issue would hear of it
 *   node .github/zama-watch.mjs --comment  comment on the issue when the answer changed
 *
 * The issue only hears about a change of the state line: a route that
 * appeared, a new minor of the SDK, a dist-tag that reached 0.14. A probe
 * that says nothing is never news.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RELAYER = 'https://relayer.testnet.zama.org';
const REGISTRY = 'https://registry.npmjs.org';
const SDK = '@zama-fhe/sdk';
const FHEVM = '@fhevm/sdk';
/** The first `@fhevm/sdk` with ERC-1271 permits (fhevm v0.14.0, 2026-08-14). */
const UNIFIED_FROM = '0.14.0';
const MARKER = 'zama-watch:';

/**
 * What the relayer's answers say about the unified route.
 *
 * @param {{ v2: number | null, v3: number | null }} status HTTP status, null when no answer came
 * @returns {'present' | 'absent' | 'unclear'}
 */
export function routeState({ v2, v3 }) {
	if (v2 !== 400) return 'unclear';
	if (v3 === 400) return 'present';
	if (v3 === 404) return 'absent';
	return 'unclear';
}

/**
 * Whether a version's numbers reach `floor`. A prerelease counts by its
 * numbers: `0.14.1-1` carries the 0.14 permits, which is what is asked here.
 *
 * @param {string | null | undefined} version an exact version, or a range with ^ or ~
 * @param {string} [floor]
 */
export function atLeast(version, floor = UNIFIED_FROM) {
	const parse = (/** @type {string} */ text) => {
		const match = /^[\^~=v]*(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
		return match ? match.slice(1, 4).map(Number) : null;
	};
	const have = version ? parse(version) : null;
	const want = parse(floor);
	if (!have || !want) return false;
	for (let i = 0; i < 3; i += 1) {
		if (have[i] !== want[i]) return have[i] > want[i];
	}
	return true;
}

/** `3.6.0` → `3.6`, so a patch release is not news. @param {string | null} version */
export function minorOf(version) {
	const match = version ? /^(\d+)\.(\d+)/.exec(version) : null;
	return match ? `${match[1]}.${match[2]}` : 'none';
}

/**
 * @typedef {{ version: string | null, fhevm: string | null }} Tagged
 *   A dist-tag's version and the `@fhevm/sdk` it depends on; both null when
 *   npm has no such tag.
 * @typedef {{
 *   route: 'present' | 'absent' | 'unclear',
 *   status: { v2: number | null, v3: number | null },
 *   tags: { latest: Tagged, beta: Tagged, alpha: Tagged },
 *   pinned: string | null
 * }} Measurement
 */

/** @param {Tagged} tag */
const unified = (tag) => (tag.version === null ? 'none' : atLeast(tag.fhevm) ? 'yes' : 'no');

/**
 * The one line the issue remembers. A comment is due when it changes.
 *
 * @param {Measurement} m
 */
export function stateLine(m) {
	return [
		`relayer-v3=${m.route}`,
		`latest=${minorOf(m.tags.latest.version)}`,
		`latest-unified=${unified(m.tags.latest)}`,
		`beta-unified=${unified(m.tags.beta)}`,
		`alpha-unified=${unified(m.tags.alpha)}`
	].join(' ');
}

/** Both halves are there: step 4 can be checked against Zama, and step 5 can follow. @param {Measurement} m */
export function ready(m) {
	return m.route === 'present' && unified(m.tags.latest) === 'yes';
}

/**
 * The state line of the newest comment this watch left, or null.
 *
 * @param {Array<{ body?: string | null }>} comments oldest first, as GitHub lists them
 */
export function lastStateLine(comments) {
	for (let i = comments.length - 1; i >= 0; i -= 1) {
		const match = new RegExp(`<!-- ${MARKER} (.+?) -->`).exec(comments[i].body ?? '');
		if (match) return match[1];
	}
	return null;
}

/**
 * @param {string | null} previous the state line the issue heard last
 * @param {Measurement} m
 * @returns {{ post: boolean, why: string }}
 */
export function decide(previous, m) {
	if (m.route === 'unclear') {
		return { post: false, why: 'the relayer probe said nothing this time (v2 did not answer 400)' };
	}
	const line = stateLine(m);
	if (previous === line) return { post: false, why: 'nothing changed since the last comment' };
	return { post: true, why: previous === null ? 'first measurement' : `was: ${previous}` };
}

/**
 * @param {Measurement} m
 * @param {string} date `YYYY-MM-DD`
 */
export function commentBody(m, date) {
	const row = (/** @type {string} */ tag, /** @type {Tagged} */ t) =>
		`| \`${tag}\` | ${t.version ?? '—'} | ${t.fhevm ?? '—'} | ${unified(t)} |`;
	const headline = ready(m)
		? '**Both halves are there.** The relayer serves the unified route, and the released SDK carries `@fhevm/sdk` 0.14. Step 4 can now be checked against Zama itself, and step 5 can follow.'
		: m.route === 'present'
			? '**The route is there; the released SDK is not yet.** `v3/user-decrypt` answers on Sepolia, but `latest` still depends on `@fhevm/sdk` below 0.14.'
			: unified(m.tags.latest) === 'yes'
				? '**The released SDK is there; the route is not yet.** `latest` depends on `@fhevm/sdk` 0.14, but the Sepolia relayer still answers 404 on `v3/user-decrypt`.'
				: '**Not yet.** The Sepolia relayer answers 404 on `v3/user-decrypt`, and `latest` depends on `@fhevm/sdk` below 0.14.';
	return [
		`Zama watch, ${date}. ${headline}`,
		'',
		`| Relayer \`${RELAYER}\` | HTTP |`,
		'|---|---|',
		`| \`POST /v2/user-decrypt {}\` (control) | ${m.status.v2 ?? 'no answer'} |`,
		`| \`POST /v3/user-decrypt {}\` | ${m.status.v3 ?? 'no answer'} |`,
		'',
		`| \`${SDK}\` | version | depends on \`${FHEVM}\` | 0.14 or later |`,
		'|---|---|---|---|',
		row('latest', m.tags.latest),
		row('beta', m.tags.beta),
		row('alpha', m.tags.alpha),
		'',
		`escrow01 pins \`${SDK}\` ${m.pinned ?? '(not found)'}.`,
		'',
		'Measured by `.github/zama-watch.mjs`; this comment appears only when the line below changes.',
		'',
		`<!-- ${MARKER} ${stateLine(m)} -->`
	].join('\n');
}

// ---------------------------------------------------------------------------
// Measuring

/** @param {string} path @returns {Promise<number | null>} */
async function probe(path) {
	try {
		const response = await fetch(`${RELAYER}/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
			signal: AbortSignal.timeout(20_000)
		});
		return response.status;
	} catch {
		return null;
	}
}

/** @param {string} path */
async function npm(path) {
	const response = await fetch(`${REGISTRY}/${path}`, { signal: AbortSignal.timeout(20_000) });
	if (!response.ok) throw new Error(`npm registry: ${response.status} for ${path}`);
	return response.json();
}

/** @param {Record<string, string>} distTags @param {string} tag @returns {Promise<Tagged>} */
async function tagged(distTags, tag) {
	const version = distTags[tag] ?? null;
	if (!version) return { version: null, fhevm: null };
	const doc = await npm(`${SDK}/${version}`);
	return { version, fhevm: doc.dependencies?.[FHEVM] ?? null };
}

/** @returns {Promise<Measurement>} */
export async function measure() {
	const [v2, v3, distTags] = await Promise.all([
		probe('v2/user-decrypt'),
		probe('v3/user-decrypt'),
		npm(`-/package/${SDK}/dist-tags`)
	]);
	const [latest, beta, alpha] = await Promise.all(
		['latest', 'beta', 'alpha'].map((tag) => tagged(distTags, tag))
	);
	let pinned = null;
	try {
		const pkg = JSON.parse(
			readFileSync(new URL('../apps/escrow01/package.json', import.meta.url), 'utf8')
		);
		pinned = pkg.dependencies?.[SDK] ?? null;
	} catch {
		// Run outside the repository: the pin is only context.
	}
	return {
		route: routeState({ v2, v3 }),
		status: { v2, v3 },
		tags: { latest, beta, alpha },
		pinned
	};
}

// ---------------------------------------------------------------------------
// The issue

/**
 * @param {string} repo `owner/name`
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function github(repo, path, init = {}) {
	const token = process.env.GITHUB_TOKEN;
	const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
		...init,
		headers: {
			accept: 'application/vnd.github+json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(init.body ? { 'content-type': 'application/json' } : {})
		},
		signal: AbortSignal.timeout(20_000)
	});
	if (!response.ok) throw new Error(`GitHub: ${response.status} for ${path}`);
	return response.json();
}

/** @param {string} repo @param {string} issue */
async function comments(repo, issue) {
	/** @type {Array<{ body?: string | null }>} */
	const all = [];
	for (let page = 1; page <= 20; page += 1) {
		const batch = await github(repo, `/issues/${issue}/comments?per_page=100&page=${page}`);
		all.push(...batch);
		if (batch.length < 100) break;
	}
	return all;
}

async function main() {
	const repo = process.env.GITHUB_REPOSITORY || 'Le-Space/simple-todo';
	const issue = process.env.ISSUE || '54';
	const shouldComment = process.argv.includes('--comment');

	const m = await measure();
	const body = commentBody(m, new Date().toISOString().slice(0, 10));
	console.log(body);

	/** @type {string | null} */
	let previous = null;
	try {
		previous = lastStateLine(await comments(repo, issue));
	} catch (error) {
		// Without the issue's history a comment could repeat the last one; say
		// so and post nothing.
		console.log(
			`\nCould not read ${repo}#${issue}: ${error instanceof Error ? error.message : error}`
		);
		process.exitCode = shouldComment ? 1 : 0;
		return;
	}
	const { post, why } = decide(previous, m);
	console.log(
		`\nState: ${stateLine(m)}\nComment on ${repo}#${issue}: ${post ? 'yes' : 'no'} (${why})`
	);

	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`${body}\n\nComment on #${issue}: ${post ? 'yes' : 'no'} (${why})\n`
		);
	}
	if (post && shouldComment) {
		await github(repo, `/issues/${issue}/comments`, {
			method: 'POST',
			body: JSON.stringify({ body })
		});
		console.log(`Commented on ${repo}#${issue}.`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await main();
}
