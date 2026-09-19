/**
 * Getting past the consent screen, in one place.
 *
 * The dialog is `qr-intro` now, so the acceptance tick that gates the way out
 * lives in the element's shadow tree. Ten specs used to reach into the markup
 * for it, each with its own selector — and each would have to learn where it
 * moved. They ask here instead.
 *
 * `part="accept"` and `part="dont-show"` are what the element exposes, and they
 * survive its internals being rearranged.
 */

/** @param {import('@playwright/test').Page} page */
export const consentModal = (page) => page.getByTestId('consent-modal');

/**
 * Whether the dialog is showing.
 *
 * Asked of the element rather than measured. The host is a custom element whose
 * dialog is in the shadow tree and positioned by the browser, so it measures
 * 0x0 once it has upgraded — and briefly has a box before that, while the
 * dialog is not open yet. `toBeVisible` is therefore wrong in both directions;
 * it cost `main` seven red runs of 1.3 hours each before anyone looked.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isConsentOpen = (page) =>
	page.evaluate(() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true);

/**
 * The assembled statement's clauses.
 *
 * They live in the element's shadow tree, which Playwright pierces. There is no
 * `part` on them — asked for upstream; until then the class the element gives
 * the panel is the handle, and it is the same one the app's own highlight CSS
 * uses, so the two would break together rather than one silently outliving the
 * other.
 *
 * @param {import('@playwright/test').Page} page
 */
/**
 * Whether the statement has been accepted.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isAccepted = (page) =>
	page.evaluate(
		() =>
			document
				.querySelector('[data-testid="consent-modal"]')
				?.shadowRoot?.querySelector('input[part=accept]')?.checked === true
	);

export const privacyClauses = (page) => consentModal(page).locator('.privacy ul li');

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options]
 */
export async function waitForConsent(page, { timeout = 30_000 } = {}) {
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true,
		undefined,
		{ timeout }
	);
}

/**
 * Tick the acceptance, which is what enables the way out.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function acceptNotice(page) {
	await page.evaluate(() => {
		const box = document
			.querySelector('[data-testid="consent-modal"]')
			?.shadowRoot?.querySelector('input[part=accept]');
		if (!box) throw new Error('the acceptance tick is not in the dialog');
		box.checked = true;
		box.dispatchEvent(new Event('change'));
	});
}

/**
 * Remember the decision, so the dialog does not return on the next load.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function rememberDecision(page) {
	await page.evaluate(() => {
		const box = document
			.querySelector('[data-testid="consent-modal"]')
			?.shadowRoot?.querySelector('input[part=dont-show]');
		if (!box) throw new Error('the do-not-show tick is not in the dialog');
		box.checked = true;
		box.dispatchEvent(new Event('change'));
	});
}

/**
 * The whole walk: choose an identity, accept, proceed.
 *
 * Every choice defaults to what the app defaults to, so a caller that does not
 * care about one says nothing about it. `mnemonic` is left alone unless given —
 * the app generates a valid one, and most specs only need *a* shared list.
 *
 * A chapter whose consent screen does not offer one of these controls simply
 * never asks for it. Passing a choice the screen does not have is an error
 * rather than a no-op — which it was, once, and the storage specs then tested
 * the default mode under the name of the one they had asked for.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ identity?: 'anonymous' | 'create' | 'existing', label?: string, mnemonic?: string, persistent?: boolean, relay?: boolean, remember?: boolean }} [choices]
 */
export async function passConsent(
	page,
	{ identity, label, mnemonic, persistent, relay, remember = false } = {}
) {
	await waitForConsent(page);

	if (mnemonic !== undefined) {
		await page.getByTestId('shared-list-mnemonic-input').fill(mnemonic);
	}
	if (identity !== undefined) {
		await page.getByTestId(`identity-mode-${identity}`).check();
	}
	if (label !== undefined) {
		await page.getByTestId('passkey-label').fill(label);
	}
	if (persistent !== undefined) {
		// Two names for one control: `main` still has the fieldset inline in its
		// consent dialog (`consent-storage-…`), everyone else renders the shared
		// `StorageModeSelector` (`storage-mode-…`). Asking for both keeps the
		// specs out of that difference until main adopts the component.
		const shared = page.getByTestId(persistent ? 'storage-mode-indexeddb' : 'storage-mode-memory');
		const inline = page.getByTestId(
			persistent ? 'consent-storage-indexeddb' : 'consent-storage-memory'
		);
		await ((await shared.count()) > 0 ? shared : inline).check();
	}
	if (relay !== undefined) {
		const box = page.getByTestId('consent-relay-network');
		if (relay) await box.check();
		else await box.uncheck();
	}
	if (remember) await rememberDecision(page);

	await acceptNotice(page);
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
	);
}
