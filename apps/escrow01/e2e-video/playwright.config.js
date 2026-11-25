// The demo film (e2e-video/): Alice and Bob on one stage, recorded as video
// at the frame's own size. Not part of `pnpm test:e2e`; run `pnpm video:cards` and `pnpm video:film`.
//
// Where it is shot:
//   - by default the live chapter, https://escrow01.le-space.de/, which runs
//     the Sepolia budget service: real encryption, real user operations (on a
//     testnet, gas sponsored by Openfort);
//   - DEMO_URL=local builds this checkout as the E2E suite does (fake budget
//     service, a relay of its own) and shoots that: a dry run of the steps,
//     with nothing sent anywhere;
//   - DEMO_URL=<address> any other build.
//
// DEMO_RES is the frame's height (1080 by default, 2160 for YouTube: a 1080p
// upload gets a thin bitrate there). The Playwright this runs with is
// belege's, whose recorder is patched to keep text sharp (link-kit.sh).
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { PREVIEW_PORT } from '../../../packages/e2e-kit/src/preview-origin.mjs';

const local = process.env.DEMO_URL === 'local';
const baseURL = local
	? `http://localhost:${PREVIEW_PORT}/`
	: (process.env.DEMO_URL || 'https://escrow01.le-space.de/').replace(/\/?$/, '/');
// The specs read the address from here (escrow01.js), so a local run is local
// everywhere, not only in what Playwright waits for.
process.env.DEMO_URL = baseURL;

const height = Number(process.env.DEMO_RES || 1080);
const viewport = { width: Math.round((height * 16) / 9), height };

export default defineConfig({
	testDir: '.',
	testMatch: /.*\.spec\.js$/,
	outputDir: 'results',
	retries: 0,
	workers: 1,
	// The stage waits for Sepolia twice (a lock about a minute, a release about
	// half of one); the cuts take that time out of the film, not out of the run.
	timeout: 900_000,
	expect: { timeout: 30_000 },
	webServer: local
		? {
				command: 'node ../../packages/e2e-kit/src/start-e2e-server.mjs',
				cwd: fileURLToPath(new URL('..', import.meta.url)),
				port: PREVIEW_PORT,
				reuseExistingServer: false,
				timeout: 240_000
			}
		: undefined,
	use: {
		baseURL,
		// A target that never appears fails in half a minute, not after the
		// whole scene's budget: the video would be fifteen minutes of nothing.
		actionTimeout: 30_000,
		locale: process.env.DEMO_LANG === 'de' ? 'de-DE' : 'en-GB',
		viewport,
		video: { mode: 'on', size: viewport },
		screenshot: 'off',
		trace: 'off'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } }]
});
