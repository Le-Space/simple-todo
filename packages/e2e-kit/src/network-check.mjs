/**
 * What a page asks of the network through WebRTC, before and after consent.
 *
 * STUN traffic does not pass through Playwright's request log — it is UDP
 * from inside `RTCPeerConnection` — so the servers are read where they are
 * named: the configuration each connection is constructed with.
 */

/**
 * Record the ICE servers of every `RTCPeerConnection` the page creates.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function recordPeerConnections(page) {
	await page.addInitScript(() => {
		/** @type {string[]} */
		const asked = [];
		Object.defineProperty(window, '__iceServersAsked', { value: asked });
		const Original = window.RTCPeerConnection;
		if (!Original) return;
		window.RTCPeerConnection = /** @type {any} */ (
			class extends Original {
				/** @param {RTCConfiguration} [configuration] */
				constructor(configuration) {
					for (const server of configuration?.iceServers ?? []) {
						for (const url of [server.urls].flat()) asked.push(String(url));
					}
					super(configuration);
				}
			}
		);
	});
}

/**
 * The STUN and TURN servers the page has named so far.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function iceServersAsked(page) {
	return page.evaluate(() =>
		/** @type {string[]} */ (/** @type {any} */ (window).__iceServersAsked).filter((url) =>
			/^(stun|turns?):/.test(url)
		)
	);
}

/**
 * Whether a section of a `<qr-intro>` is on screen.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} testId the element's data-testid
 * @param {string} selector inside its shadow root
 */
export async function introSectionShown(page, testId, selector) {
	return page.evaluate(
		([id, css]) => {
			const section = document.querySelector(`[data-testid="${id}"]`)?.shadowRoot?.querySelector(css);
			return section instanceof HTMLElement && getComputedStyle(section).display !== 'none' && !section.hidden;
		},
		[testId, selector]
	);
}

/**
 * The caveat list's heading and lines, as the reader sees them.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} testId
 */
export async function introCaveats(page, testId) {
	return page.evaluate((id) => {
		const tech = document.querySelector(`[data-testid="${id}"]`)?.shadowRoot?.querySelector('.tech');
		return {
			heading: tech?.querySelector('h3')?.textContent ?? '',
			lines: [...(tech?.querySelectorAll(':scope > ul > li') ?? [])].map((li) => li.textContent ?? '')
		};
	}, testId);
}
