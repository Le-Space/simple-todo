/**
 * What connects two browsers when an expectation between them fails (#127):
 * nothing, a circuit through the relay (limited), or a direct connection.
 * Told by `limited`, never by the address (AGENTS.md).
 */

/**
 * @param {import('@playwright/test').Page} from
 * @param {import('@playwright/test').Page} to
 */
async function pathBetween(from, to) {
	const peer = String(
		await to.evaluate(() => /** @type {any} */ (window).__simpleTodoE2E?.getPeerId?.())
	);
	/** @type {Array<{ remotePeer: string | null, limited: boolean, multiplexer: string | null }>} */
	const connections = await from.evaluate(
		() => /** @type {any} */ (window).__simpleTodoE2E?.getConnections?.() ?? []
	);
	const between = connections.filter((connection) => connection.remotePeer === peer);
	if (between.length === 0) return 'none';
	return between
		.map((connection) => (connection.limited ? 'circuit' : `direct ${connection.multiplexer}`))
		.join(' + ');
}

/**
 * Await `expectation`; when it fails, log the paths between the pages first.
 *
 * @template T
 * @param {Promise<T>} expectation
 * @param {Record<string, import('@playwright/test').Page>} pages two, by name
 * @returns {Promise<T>}
 */
export async function explainPathOnFailure(expectation, pages) {
	try {
		return await expectation;
	} catch (error) {
		const [[nameA, a], [nameB, b]] = Object.entries(pages);
		const report = await Promise.all([pathBetween(a, b), pathBetween(b, a)]).then(
			([ab, ba]) => `${nameA}→${nameB}: ${ab}; ${nameB}→${nameA}: ${ba}`,
			(reason) => `could not tell: ${reason?.message ?? reason}`
		);
		console.log(`[path] ${report}`);
		throw error;
	}
}
