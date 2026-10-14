import { defineConfig, devices } from '@playwright/test';
import { PREVIEW_PORT } from '@simple-todo/e2e-kit/preview-origin.mjs';

// The relay-proof experiment (e2e/relay-proof-mode.bench.js, #64): the same
// app and local relay as playwright.config.js, one run per proof mode, much
// longer timeouts. Not part of `test:e2e`; run it through
// e2e/relay-proof-experiment.sh.
const previewPort = PREVIEW_PORT;

export default defineConfig({
	retries: 0,
	workers: 1,
	webServer: {
		command: 'node ../../packages/e2e-kit/src/start-e2e-server.mjs',
		port: previewPort,
		reuseExistingServer: false,
		timeout: 240000
	},
	testDir: 'e2e',
	testMatch: 'relay-proof-mode.bench.js',
	timeout: 15 * 60 * 1000,
	expect: { timeout: 90000 },
	reporter: 'list',
	use: {
		baseURL: `http://localhost:${previewPort}`,
		screenshot: 'off',
		video: 'off',
		trace: 'off'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
