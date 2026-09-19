/**
 * The ports one chapter binds.
 *
 * Every chapter used to hardcode 4173 and 49100-49106, which was fine while each
 * lived in its own repository and fatal the moment two of them run in one. The
 * numbers now come from the chapter's own `chapter.json`; an env variable still
 * wins, because CI and a developer both need to move a suite out of the way.
 *
 * Relay ports stay below 32768. Above that line the operating system hands the
 * number out to outgoing connections (macOS from 49152, Linux from 32768), and
 * the relay answers the resulting EADDRINUSE by moving its HTTP server to a
 * random port without saying so -- the suite then waits for an answer on a port
 * nobody listens on, which looks like a relay that never started.
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
		// No chapter.json: the defaults below keep a stray checkout working.
	}

	const pick = (env, key, fallback) => Number(process.env[env] ?? declared[key] ?? fallback);

	const ports = {
		preview: pick('E2E_PREVIEW_PORT', 'preview', 4173),
		relayHttp: pick('E2E_RELAY_HTTP_PORT', 'relayHttp', 4900),
		relayTcp: pick('E2E_RELAY_TCP_PORT', 'relayTcp', 4901),
		relayWs: pick('E2E_RELAY_WS_PORT', 'relayWs', 4902),
		relayWebrtc: pick('E2E_RELAY_WEBRTC_PORT', 'relayWebrtc', 4903),
		relayWebrtcDirect: pick('E2E_RELAY_WEBRTC_DIRECT_PORT', 'relayWebrtcDirect', 4906)
	};

	const ephemeral = Object.entries(ports).filter(
		([name, port]) => name !== 'preview' && port >= 32768
	);
	if (ephemeral.length > 0) {
		throw new Error(
			`Relay ports must stay below 32768, these do not: ${ephemeral
				.map(([name, port]) => `${name}=${port}`)
				.join(', ')}. The operating system hands out higher numbers to outgoing ` +
				`connections, and the relay moves its HTTP server to a random port on the ` +
				`resulting EADDRINUSE without saying so.`
		);
	}

	return ports;
}
