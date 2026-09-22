/**
 * The network half of `<qr-intro>`, for the chapters that do not use it.
 *
 * The element (@le-space/libp2p-webrtc-qr) is built for the WebRTC-QR
 * handover. It measures whether this network allows a direct connection —
 * "This browser, on this network" — and lists what can break one: a phone
 * closing a waiting invite, carrier NAT, a VPN. And it measures on the first
 * `open()`, against STUN servers at Google and Cloudflare.
 *
 * Six chapters use the element only as their consent dialog and connect
 * through a relay. For them the check and the caveats describe something they
 * never do, and the measurement sends this reader's address to two companies
 * before the reader has agreed to anything. The element has no switch for
 * either (an upstream option would be the clean fix), so this does it from
 * outside:
 *
 * - `rtcConfiguration` without ICE servers: the probe gathers local candidates
 *   and asks nobody.
 * - a stylesheet in the shadow root hides the sections. A stylesheet, because
 *   the element sets `hidden` on its caveats itself whenever it repaints — a
 *   language or view switch would bring them back.
 *
 * main and qr01 do use WebRTC-QR; they keep both halves but start the real
 * measurement only once the statement is accepted (`deferNetworkCheck`).
 */

/** An ICE configuration that asks no server. */
export const NO_STUN = Object.freeze({ iceServers: [] });

/**
 * The element's sections: the verdict, the caveats, and — inside the caveats —
 * the measured addresses with their "check again" button.
 */
export const NETWORK_CHECK = '.check';
export const NETWORK_CAVEATS = '.tech';
export const NETWORK_ADDRESSES = '.tech .details';

const STYLE_ID = 'simple-todo-network-sections';

/**
 * @param {any} introEl the `<qr-intro>` element, upgraded
 * @param {string[]} selectors which sections to hide
 */
export function hideIntroSections(introEl, selectors) {
	const root = introEl?.shadowRoot;
	if (!root) return;
	root.getElementById(STYLE_ID)?.remove();
	if (selectors.length === 0) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `${selectors.join(', ')} { display: none !important; }`;
	root.append(style);
}

/**
 * For a relay chapter: no measurement against STUN servers, and the sections
 * given hidden — by default both, the check and the caveats.
 *
 * Call before the first `open()`: that is when the element measures.
 *
 * @param {any} introEl
 * @param {string[]} [hide]
 */
export function withoutNetworkCheck(introEl, hide = [NETWORK_CHECK, NETWORK_CAVEATS]) {
	introEl.rtcConfiguration = NO_STUN;
	hideIntroSections(introEl, hide);
}

/**
 * For a WebRTC-QR chapter: measure nothing outside until the statement is
 * accepted, then measure for real and show the sections.
 *
 * Call before the first `open()`. The returned function is called once the
 * reader has accepted; it restores the chapter's ICE configuration, shows the
 * sections and runs the element's `recheck()`.
 *
 * @param {any} introEl
 * @param {RTCConfiguration} [rtcConfiguration] the configuration to measure
 *   with after acceptance; the element's own default when left out
 * @returns {() => Promise<void>}
 */
export function deferNetworkCheck(introEl, rtcConfiguration) {
	const measureWith = rtcConfiguration ?? introEl.rtcConfiguration;
	withoutNetworkCheck(introEl);
	let done = false;
	return async () => {
		if (done) return;
		done = true;
		introEl.rtcConfiguration = measureWith;
		hideIntroSections(introEl, []);
		await introEl.recheck?.();
	};
}
