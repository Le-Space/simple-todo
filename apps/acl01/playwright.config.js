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
	// One retry in CI, none here. `private-list-visibility:84` and its relatives
	// wait for a list opened by address to become the active one, and on a CI
	// runner that occasionally takes longer than the poll allows — six local runs
	// with one worker passed, the same job failed roughly every second time. A
	// retried test is reported as "flaky", so this makes the wobble visible
	// instead of turning every pull request red while the cause is being found.
	retries: process.env.CI ? 1 : 0,
	// One worker, deliberately. Every spec in a chapter drives two browsers that
	// have to find each other through the one relay this suite starts, and eight
	// of them at once do not: measured on acl01, the suite failed 2 of 4 runs on
	// the frozen branch and 3 of 4 here, always on an open-by-address step, and
	// passed with a single worker. Parallelism across chapters is the matrix's
	// job — each app has its own ports.
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
