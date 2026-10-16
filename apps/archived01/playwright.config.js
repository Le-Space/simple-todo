import { defineConfig, devices } from '@playwright/test';
// The chapter's own ports, so two chapters can run their suites at once.
import { PREVIEW_PORT } from '@simple-todo/e2e-kit/preview-origin.mjs';

// `e2e/start-e2e-server.mjs` already reads this; the config did not, so setting
// it moved the preview server without moving what Playwright waited for and
// what the tests browsed to. Two checkouts of this repo therefore could not run
// their suites at the same time — and worse, a preview left behind by another
// branch on 4173 would be silently used instead, so a suite could pass or fail
// against an app it never built (#197).
const previewPort = PREVIEW_PORT;

export default defineConfig({
	// One retry in CI, none locally: a test that only wobbles on a runner is
	// reported as flaky instead of red. See the open-by-address investigation.
	retries: process.env.CI ? 1 : 0,
	// One worker: every spec drives two browsers that have to meet through
	// the single relay this suite starts, and eight at once do not. Measured on
	// acl01: 2 of 4 runs red on the frozen branch, 3 of 4 here, green with one
	// worker. Chapters run in parallel through the matrix instead.
	workers: 1,

	webServer: {
		command: 'node ../../packages/e2e-kit/src/start-e2e-server.mjs',
		port: previewPort,
		reuseExistingServer: false,
		timeout: 240000
	},
	testDir: 'e2e',
	timeout: 60000,
	expect: {
		timeout: 30000
	},
	use: {
		baseURL: `http://localhost:${previewPort}`,
		// Capture screenshots on failure
		screenshot: 'only-on-failure',
		// Record video on first retry
		video: 'retain-on-failure',
		// Collect trace on failure
		trace: 'on-first-retry'
	},
	// Run the suite against Chrome/Chromium only.
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
