/**
 * Whether Zama's side has moved far enough for escrow01's passkey to sign its
 * own decryption permits (Le-Space/simple-todo#54, step 3). Until then the app
 * keeps a read key, and nothing on our side can change that.
 *
 * Three things have to be true:
 * - The Sepolia relayer serves the unified route. Asked the way the SDK's own
 *   `canUseUnifiedDecryptionPermit` asks — an empty POST — `v3/user-decrypt`
 *   answers 400 when the route is there and 404 when it is not. `v2` is asked
 *   the same way as a control: if it does not answer 400 either, the probe
 *   says nothing this time.
 * - The `@zama-fhe/sdk` that npm calls `latest` depends on `@fhevm/sdk` 0.14 or
 *   later, the line with ERC-1271 permits. `beta` and `alpha` are reported
 *   too, as the early warning.
 * - Sepolia's KMSVerifier is 0.4.0 or later. Before it builds a unified permit,
 *   `@fhevm/sdk` 0.14.3 reads the current KMS context from the host chain,
 *   and only from KMSVerifier 0.4.0 on does it get the extraData v2 a
 *   unified permit needs (`readCurrentKmsSignersContext`); below that,
 *   `createUnsignedDecryptionPermitEip712V2` refuses. Asked through two public
 *   Sepolia RPCs with `getVersion()`; the address is a proxy that Zama
 *   upgrades in place — `@fhevm/sdk` 0.13.2 and 0.14.3 name the same one.
 *
 * Measured on 2026-10-02 and 2026-10-12: the route answered 404, and `latest`
 * (3.6.0) as well as `beta` depended on `@fhevm/sdk` 0.13.2. On 2026-10-12
 * the KMSVerifier said `KMSVerifier v0.3.0`.
 *
 *   node .github/zama-watch.mjs            measure, and say whether the issue would hear of it
 *   node .github/zama-watch.mjs --comment  comment on the issue when the answer changed
 *
 * The issue only hears about a change of the state line: a route that
 * appeared, a new minor of the SDK or the KMSVerifier, a dist-tag that reached
 * 0.14. A probe that says nothing is never news.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RELAYER = 'https://relayer.testnet.zama.org';
const REGISTRY = 'https://registry.npmjs.org';
const SDK = '@zama-fhe/sdk';
const FHEVM = '@fhevm/sdk';
/** The first `@fhevm/sdk` with ERC-1271 permits (fhevm v0.14.0, 2026-08-14). */
const UNIFIED_FROM = '0.14.0';
/** Zama's KMSVerifier on Sepolia, the address `@fhevm/sdk` 0.13.2 and 0.14.3 both name. */
const KMS_VERIFIER = '0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A';
/** The first KMSVerifier from which `@fhevm/sdk` 0.14.3 builds a unified permit. */
const KMS_UNIFIED_FROM = '0.4.0';
/** `getVersion()` */
const GET_VERSION = '0x0d8e6e2c';
const SEPOLIA_RPCS = ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org'];
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

/**
 * The version in a `getVersion()` answer — an ABI-encoded string such as
 * `KMSVerifier v0.3.0` — or null when the answer is not one.
 *
 * @param {unknown} result the `eth_call` result
 * @returns {string | null}
 */
export function versionFromCall(result) {
	if (typeof result !== 'string' || !/^0x[0-9a-f]*$/i.test(result) || result.length < 130) {
		return null;
	}
	const length = Number.parseInt(result.slice(66, 130), 16);
	const text = Buffer.from(result.slice(130, 130 + length * 2), 'hex').toString('utf8');
	return /\bv(\d+\.\d+\.\d+)\b/.exec(text)?.[1] ?? null;
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
 *   kms: string | null,
 *   pinned: string | null
 * }} Measurement
 *   `kms` is the KMSVerifier's version on Sepolia, null when no RPC answered.
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
		`kms-verifier=${minorOf(m.kms)}`,
		`latest=${minorOf(m.tags.latest.version)}`,
		`latest-unified=${unified(m.tags.latest)}`,
		`beta-unified=${unified(m.tags.beta)}`,
		`alpha-unified=${unified(m.tags.alpha)}`
	].join(' ');
}

/**
 * What is still missing, in words for the issue; empty when nothing is.
 *
 * @param {Measurement} m
 */
export function missing(m) {
	return [
		m.route !== 'present' &&
			`the unified route on the Sepolia relayer (\`v3/user-decrypt\` answers ${m.status.v3 ?? 'nothing'})`,
		unified(m.tags.latest) !== 'yes' &&
			`a released SDK on \`${FHEVM}\` 0.14 (\`latest\` depends on ${m.tags.latest.fhevm ?? 'nothing'})`,
		!atLeast(m.kms, KMS_UNIFIED_FROM) &&
			`KMSVerifier ${KMS_UNIFIED_FROM} on Sepolia (it is ${m.kms ?? 'unknown'})`
	].filter((item) => typeof item === 'string');
}

/** All three are there: step 5 can run against Zama's KMS, and step 6 can follow. @param {Measurement} m */
export function ready(m) {
	return missing(m).length === 0;
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
	if (m.kms === null) {
		return { post: false, why: "Sepolia's KMSVerifier did not answer this time" };
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
	const gaps = missing(m);
	const headline =
		gaps.length === 0
			? "**All three are there.** The relayer serves the unified route, the released SDK carries `@fhevm/sdk` 0.14, and Sepolia's KMSVerifier is 0.4 or later. Step 5 can now run end to end against Zama's KMS, and step 6 can follow."
			: `**Not yet.** Still missing: ${gaps.join('; ')}.`;
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
		'| Sepolia | version | unified permits from |',
		'|---|---|---|',
		`| \`KMSVerifier\` \`${KMS_VERIFIER}\` | ${m.kms ?? 'no answer'} | ${KMS_UNIFIED_FROM} |`,
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

/** The KMSVerifier's version on Sepolia, from the first RPC that answers. @returns {Promise<string | null>} */
async function kmsVerifier() {
	for (const rpc of SEPOLIA_RPCS) {
		try {
			const response = await fetch(rpc, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'eth_call',
					params: [{ to: KMS_VERIFIER, data: GET_VERSION }, 'latest']
				}),
				signal: AbortSignal.timeout(20_000)
			});
			if (!response.ok) continue;
			const version = versionFromCall((await response.json()).result);
			if (version) return version;
		} catch {
			// The next RPC.
		}
	}
	return null;
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
	const [v2, v3, kms, distTags] = await Promise.all([
		probe('v2/user-decrypt'),
		probe('v3/user-decrypt'),
		kmsVerifier(),
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
		kms,
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
