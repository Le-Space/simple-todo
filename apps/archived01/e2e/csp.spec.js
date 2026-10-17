import { test, expect } from '@playwright/test';
import { passConsent } from '@simple-todo/e2e-kit/consent.mjs';

// Chapter (archived01): the page ships a Content Security Policy, and nothing
// the page does trips it.
//
// The policy is a <meta> tag SvelteKit writes into the prerendered page
// (svelte.config.js): scripts only from the page's own origin plus the one
// hashed inline script SvelteKit emits, connections only to the stores, Aleph
// and relays. A policy that is too tight fails silently — a blocked fetch is
// an error in the console and a feature that does nothing — so this spec
// listens for every violation the browser reports while the app does what it
// does: start with the network on, talk to the relay, write a todo, open the
// page's QR code, switch theme and language.

const readyTimeout = 90000;

/** @param {import('@playwright/test').Page} page */
async function recordViolations(page) {
	await page.addInitScript(() => {
		/** @type {any} */ (window).__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (event) => {
			/** @type {any} */ (window).__cspViolations.push(
				`${event.violatedDirective} ← ${event.blockedURI || event.sourceFile || '?'}`
			);
		});
	});
}

/** @param {import('@playwright/test').Page} page */
const violations = (page) => page.evaluate(() => /** @type {any} */ (window).__cspViolations ?? []);

test.describe('Content Security Policy', () => {
	test('is on the page, strict for scripts, and nothing the app does trips it', async ({
		browser
	}) => {
		test.setTimeout(readyTimeout * 3);
		const context = await browser.newContext({ serviceWorkers: 'block' });
		const page = await context.newPage();
		/** @type {string[]} */
		const refused = [];
		page.on('console', (message) => {
			if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
				refused.push(message.text());
			}
		});
		try {
			await recordViolations(page);
			await page.goto('/');

			const policy = await page
				.locator('meta[http-equiv="content-security-policy"]')
				.getAttribute('content');
			expect(policy, 'a policy in the page').toBeTruthy();
			const directives = Object.fromEntries(
				String(policy)
					.split(';')
					.map((d) => d.trim())
					.filter(Boolean)
					.map((d) => {
						const [name, ...values] = d.split(/\s+/);
						return [name, values];
					})
			);
			// Scripts: the origin and one hash, nothing inline, nothing from elsewhere.
			expect(directives['script-src']).toEqual(["'self'", expect.stringMatching(/^'sha256-/)]);
			expect(directives['script-src']).not.toContain("'unsafe-inline'");
			expect(directives['script-src']).not.toContain("'unsafe-eval'");
			expect(directives['object-src']).toEqual(["'none'"]);
			expect(directives['base-uri']).toEqual(["'self'"]);
			// Connections: TLS hosts and secure WebSockets, and in a production build
			// nothing in the clear (relays and compute nodes are whatever the person
			// picks, so there is no finite list; see svelte.config.js).
			expect(directives['connect-src']).toEqual(
				expect.arrayContaining(["'self'", 'https:', 'wss:'])
			);
			expect(directives['connect-src']).not.toContain('*');

			// The whole app, with the network on: the relay, the list, a write.
			await passConsent(page, { identity: 'anonymous' });
			const input = page.getByPlaceholder('What needs to be done?');
			await expect(input).toBeEnabled({ timeout: readyTimeout });
			await expect(page.getByTestId('p2p-status-nav')).toBeVisible();
			const todo = `csp-${Date.now()}`;
			await input.fill(todo);
			await page.getByRole('button', { name: 'Add TODO' }).click();
			await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout: readyTimeout });

			// What else the page draws and loads: the QR code, the other theme, the other language.
			await page.getByTestId('page-qr-button').click();
			await expect(page.getByTestId('page-qr-dialog')).toBeVisible();
			await page.keyboard.press('Escape');
			await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
			await page.getByTestId('language-de').click();
			await expect(page.getByRole('heading', { name: 'Archiv' })).toBeVisible();

			// One violation is known and harmless: cbor-x (via @le-space/iso-passkeys,
			// the provider's WebAuthn parser) probes `new Function("")` once in a
			// try/catch to pick a fast path; the policy refuses, the browser reports
			// it, and the library takes its slow path — which is what happened above,
			// since every passkey ceremony worked. Nothing else may be refused.
			const knownProbe = 'script-src ← eval';
			const reported = await violations(page);
			expect(reported.filter((v) => v !== knownProbe)).toEqual([]);
			expect(reported.filter((v) => v === knownProbe).length).toBeLessThanOrEqual(1);
			expect(refused.filter((text) => !/eval/i.test(text))).toEqual([]);
		} finally {
			await context.close();
		}
	});
});
