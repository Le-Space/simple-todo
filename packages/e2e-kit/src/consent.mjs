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

/*
	Two ways in. The dialog, and — where a chapter has it (escrow01) — the short
	passkey step that stands in for it when somebody comes back with a passkey
	already linked to this device. Both are a gate the app waits behind, so the
	helpers below treat either as "the way in is showing".
*/
const GATE_IS_OPEN = () =>
	document.querySelector('[data-testid="consent-modal"]')?.isOpen === true ||
	document.querySelector('[data-testid="passkey-welcome"]')?.open === true;
/** `GATE_IS_OPEN`, negated, as a function Playwright can ship to the page. */
const GATE_IS_OPEN_NOT = () =>
	!(
		document.querySelector('[data-testid="consent-modal"]')?.isOpen === true ||
		document.querySelector('[data-testid="passkey-welcome"]')?.open === true
	);

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
export const isConsentOpen = (page) => page.evaluate(GATE_IS_OPEN);

/**
 * Whether the short passkey step is showing instead of the dialog.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isWelcomeOpen = (page) =>
	page.evaluate(() => document.querySelector('[data-testid="passkey-welcome"]')?.open === true);

/**
 * From the short passkey step to the full dialog, for a caller that wants a
 * choice the step does not offer.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openFullConsent(page) {
	await page.getByTestId('passkey-welcome-more').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true
	);
}

/**
 * The short passkey step's one button. The passkey prompt follows, so a
 * caller needs a (virtual) authenticator holding the passkey.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function continueWithPasskey(page) {
	await page.getByTestId('passkey-welcome-continue').click();
}

/**
 * Whether the dialog is the short form (escrow01): one button whose press is
 * the consent, no tick, and the settings on a second screen. The element
 * carries the mark; the long form of the other chapters does not.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isShortForm = (page) =>
	page.evaluate(
		() =>
			document.querySelector('[data-testid="consent-modal"]')?.hasAttribute('data-compact') === true
	);

/**
 * Open the short form's settings — its second screen, "Notices and settings".
 * A no-op for the long form, which has none, and where they are open already.
 *
 * Through the link a person presses, under the button: the settings are
 * `hidden` on the first screen, and a click on a hidden control waits for the
 * test's whole budget.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openAdvanced(page) {
	const link = page.getByTestId('consent-open-settings');
	if ((await link.count()) > 0 && (await link.isVisible())) {
		await link.click();
		await page.getByTestId('consent-settings').waitFor({ state: 'visible' });
	}
}

/**
 * Back from the short form's settings to its first screen, where the other
 * ways in are. A no-op anywhere else.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function backToStart(page) {
	const back = page.getByTestId('consent-back');
	if ((await back.count()) > 0 && (await back.isVisible())) {
		await back.click();
		await page.getByTestId('consent-start').waitFor({ state: 'visible' });
	}
}

/**
 * The short form's identity: the way taken under the button. Each of the two
 * ways not taken is a link (`consent-identity-<mode>`); the way already taken
 * has none.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'anonymous' | 'create' | 'existing'} identity
 */
async function takeWay(page, identity) {
	await backToStart(page);
	const link = page.getByTestId(`consent-identity-${identity}`);
	if ((await link.count()) > 0) await link.click();
	await link.waitFor({ state: 'detached' });
}

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
 * Whether the statement has been accepted. The short form has no tick — its
 * button's press is the consent — so nothing there is accepted before the
 * press, and this answers false.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isAccepted = (page) =>
	page.evaluate(() => {
		// A tick of the dialog's own, where a chapter's dialog has one.
		const own = document.querySelector('[data-testid="consent-accept"]');
		if (own instanceof HTMLInputElement) return own.checked;
		return (
			document
				.querySelector('[data-testid="consent-modal"]')
				?.shadowRoot?.querySelector('input[part=accept]')?.checked === true
		);
	});

/**
 * The statement's lines, in either form: the element's panel (long) or the
 * dialog's "All notices" (short). Read with `allTextContents`, which does not
 * care that the short form keeps them folded.
 *
 * @param {import('@playwright/test').Page} page
 */
export const privacyClauses = (page) =>
	consentModal(page).locator('.privacy ul li, [data-testid="consent-clauses"] li');

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options]
 */
export async function waitForConsent(page, { timeout = 30_000 } = {}) {
	await page.waitForFunction(GATE_IS_OPEN, undefined, { timeout });
}

/**
 * Tick the acceptance, which is what enables the way out.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function acceptNotice(page) {
	const own = page.getByTestId('consent-accept');
	if ((await own.count()) > 0) {
		await own.check();
		return;
	}
	// The short form has nothing to tick: the press on its button is the consent.
	if (await isShortForm(page)) return;
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
	/*
		The short form has no box of its own for this: "Keep in this browser"
		keeps the decision with everything else (escrow01), and with it unticked
		nothing is kept, the decision included.
	*/
	const keep = page.getByTestId('storage-keep');
	if ((await keep.count()) > 0) {
		await openAdvanced(page);
		await keep.check();
		return;
	}
	const own = page.getByTestId('consent-remember');
	if ((await own.count()) > 0) {
		await openAdvanced(page);
		await own.check();
		return;
	}
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
 * @param {{ identity?: 'anonymous' | 'create' | 'existing', label?: string, mnemonic?: string, persistent?: boolean, relay?: boolean, p2p?: boolean, seal?: boolean, remember?: boolean }} [choices]
 */
export async function passConsent(
	page,
	{ identity = 'anonymous', label, mnemonic, persistent, relay, p2p, seal, remember = false } = {}
) {
	await waitForConsent(page);

	/*
		The short passkey step offers one thing: go on with the passkey linked to
		this device. A caller asking for exactly that takes it; a caller asking
		for anything else gets the full dialog, as before the step existed.

		The step appears only where the device keeps things — in memory mode
		nothing links the passkey to it — so `persistent: true` is what it does
		anyway, and only `persistent: false` asks for something else.
	*/
	if (await isWelcomeOpen(page)) {
		const onlyThePasskey =
			identity === 'existing' &&
			persistent !== false &&
			[label, mnemonic, relay, p2p, seal].every((choice) => choice === undefined) &&
			!remember;
		if (onlyThePasskey) {
			await continueWithPasskey(page);
			await page.waitForFunction(GATE_IS_OPEN_NOT);
			return;
		}
		await openFullConsent(page);
	}

	const short = await isShortForm(page);
	if (short && remember && persistent === false) {
		// Remembering is itself something kept: unticked, the short form keeps
		// nothing, and the dialog comes back after a reload by design (#9).
		throw new Error('the short form cannot remember a decision while keeping nothing');
	}
	// The short form's identity is the way taken under its button, on the first
	// screen; its settings are on the second.
	if (short) await takeWay(page, identity);

	// The short form keeps the settings on its second screen; a caller setting
	// one needs them.
	await openAdvanced(page);

	if (mnemonic !== undefined) {
		// Where the share code is asked for only by somebody joining a list.
		const join = page.getByTestId('consent-join-list');
		if ((await join.count()) > 0) await join.check();
		await page.getByTestId('shared-list-mnemonic-input').fill(mnemonic);
	}
	/*
		Pinned, not left to the app: chapters differ in what they preselect —
		invoice01 starts on "create a passkey", because its invoice numbers hang
		off the identity — and a spec that does not say which identity it wants
		would otherwise follow whatever that chapter chose. Where the dialog then
		asks for a passkey and the test has no virtual authenticator, the proceed
		click fails and the wait at the end of this function sits there for the
		test's whole budget. A spec that wants the chapter's own default says so.

		Only where the dialog offers the choice: `main` has no identity chooser at
		all, and waiting for a control that chapter never renders is what a pinned
		default must not do.
	*/
	const identityControl = page.getByTestId(`identity-mode-${identity}`);
	if (!short && (await identityControl.count()) > 0) await identityControl.check();
	if (label !== undefined) {
		const field = page.getByTestId('passkey-label');
		/*
			The short form asks for the passkey's name only in its technical view:
			it is a label in the passkey picker and nothing else, and no spec reads
			it back. Where the field is not on screen, the default name stands.
		*/
		if (!short || (await field.isVisible())) await field.fill(label);
	}
	if (persistent !== undefined) {
		const keep = page.getByTestId('storage-keep');
		if ((await keep.count()) > 0) {
			// escrow01's own box: "Keep in this browser", ticked unless unticked.
			await keep.setChecked(persistent);
		} else {
			// The other chapters render the shared `StorageModeSelector`; `main`
			// adopted it with the shared dialog.
			await page.getByTestId(persistent ? 'storage-mode-indexeddb' : 'storage-mode-memory').check();
		}
	}
	if (p2p !== undefined) {
		// Only where the dialog offers it (archived01): off, the chapter starts
		// with no relay, no peers and no pubsub.
		const choice = page.getByTestId(p2p ? 'p2p-mode-on' : 'p2p-mode-off');
		if ((await choice.count()) > 0) await choice.check();
	}
	if (seal !== undefined) {
		// Only where the dialog offers it (archived01): the list's entries sealed
		// with a key from the passkey. The box is disabled without a passkey.
		const box = page.getByTestId('seal-list');
		if ((await box.count()) > 0) await box.setChecked(seal);
	}
	if (relay !== undefined) {
		const box = page.getByTestId('consent-relay-network');
		if (relay) await box.check();
		else await box.uncheck();
	}
	if (remember) await rememberDecision(page);

	await acceptNotice(page);
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(GATE_IS_OPEN_NOT);
}

/**
 * A press on the waiting proceed button leads to what it is waiting for.
 *
 * The acceptance tick sits inside the element's collapsed "what this means for
 * your data"; on a phone the button naming it was the only thing in view, and
 * a `disabled` button swallowed the press (archived01, 2026-10-17). The
 * shared dialog keeps the button pressable (`aria-disabled`), and a press
 * opens the statement, scrolls to the tick and focuses it. Folded first, as a
 * phone shows it — the element opens the statement on a wide screen.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function expectProceedRevealsTick(page) {
	if (await isShortForm(page)) {
		throw new Error(
			'the short form has no tick: its button waits only for the chapter (see its consent spec)'
		);
	}
	/*
		A tick of the dialog's own, directly above the button in the foot that
		does not scroll: nothing to unfold, so the press only has to put the
		cursor on it.
	*/
	const own = page.getByTestId('consent-accept');
	if ((await own.count()) > 0) {
		await page.getByTestId('consent-proceed').dispatchEvent('click');
		await page.waitForFunction(
			() => document.activeElement === document.querySelector('[data-testid="consent-accept"]'),
			undefined,
			{ timeout: 5000 }
		);
		return;
	}
	const state = () =>
		page.$eval('[data-testid="consent-modal"]', (host) => {
			const root = /** @type {any} */ (host).shadowRoot;
			const box = root?.querySelector('input[part=accept]');
			return {
				open: box?.closest('details')?.open === true,
				focused: root?.activeElement === box
			};
		});
	await page.$eval('[data-testid="consent-modal"]', (host) => {
		const details = /** @type {any} */ (host).shadowRoot?.querySelector('details.privacy');
		if (details) details.open = false;
	});
	if ((await state()).open) throw new Error('the statement did not fold');
	// `dispatchEvent`, because Playwright refuses to click an aria-disabled button.
	await page.getByTestId('consent-proceed').dispatchEvent('click');
	const deadline = Date.now() + 5000;
	for (;;) {
		const now = await state();
		if (now.open && now.focused) return;
		if (Date.now() > deadline)
			throw new Error(`the press did not reveal the tick: ${JSON.stringify(now)}`);
		await page.waitForTimeout(100);
	}
}
