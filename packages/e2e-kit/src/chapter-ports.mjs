/**
 * The ports one chapter binds.
 *
 * Every chapter used to hardcode 4173 and 49100-49106, which was fine while each
 * lived in its own repository and fatal the moment two of them run in one. The
 * numbers now come from the chapter's own `chapter.json`; an env variable still
 * wins, because CI and a developer both need to move a suite out of the way.
 *
 * @param {string} [appDir] defaults to the working directory, which is the app
 *   Playwright and the server are started from.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function chapterPorts(appDir = process.cwd()) {
	let declared = {};
	try {
		declared = JSON.parse(readFileSync(join(appDir, 'chapter.json'), 'utf8')).ports ?? {};
	} catch {
		// No chapter.json: the defaults below are the ones every chapter used to
		// carry, so a stray checkout still works.
	}

	const pick = (env, key, fallback) => Number(process.env[env] ?? declared[key] ?? fallback);

	return {
		preview: pick('E2E_PREVIEW_PORT', 'preview', 4173),
		relayHttp: pick('E2E_RELAY_HTTP_PORT', 'relayHttp', 49100),
		relayTcp: pick('E2E_RELAY_TCP_PORT', 'relayTcp', 49101),
		relayWs: pick('E2E_RELAY_WS_PORT', 'relayWs', 49102),
		relayWebrtc: pick('E2E_RELAY_WEBRTC_PORT', 'relayWebrtc', 49103),
		relayWebrtcDirect: pick('E2E_RELAY_WEBRTC_DIRECT_PORT', 'relayWebrtcDirect', 49106)
	};
}
