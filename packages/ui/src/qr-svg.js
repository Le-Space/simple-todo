import { renderSVG } from 'uqr';

/**
 * A QR code as an SVG string, drawn here with `uqr`: no request leaves the
 * page to render it. The same drawing as PageQr.svelte's, for a chapter that
 * shows a code of its own (escrow01's "This list") and should not have to
 * depend on `uqr` itself.
 *
 * @param {string} text
 * @returns {string}
 */
export const qrSvg = (text) => renderSVG(text, { border: 2 });
