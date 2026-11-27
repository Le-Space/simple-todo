import { test, expect } from '@playwright/test';
import { isConsentOpen, passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import {
	addVirtualAuthenticator,
	recordCeremonies,
	takeCeremonies
} from '@simple-todo/e2e-kit/webauthn.mjs';
import { CONTINUE_DELAY_MS } from '@le-space/orbitdb-identity-provider-webauthn-did/elements';

/**
 * Between two passkey prompts, what the next one is for.
 *
 * A new passkey takes three prompts — the passkey, the PRF output its signing
 * key comes from, the identity signature — and without a word in between that
 * looks like a loop. The provider announces each prompt after the first;
 * `<passkey-step-dialog>` (its ./elements) says which one comes and why, and
 * the prompt starts from "Continue".
 *
 * E2E builds leave the dialog off, so the other specs need not click through
 * it; this one turns it on before the page loads.
 */

const timeout = 90000;
const steps = (/** @type {import('@playwright/test').Page} */ page) =>
	page.locator('passkey-step-dialog');

/**
 * "Continue", once the step on screen takes it.
 *
 * For `CONTINUE_DELAY_MS` after a step appears, the dialog ignores "Continue"
 * (provider 0.14.0): the second click of a double click, or a held Enter,
 * meant for the step before must not approve this one unread. A click made as
 * soon as the step is visible lands in that window and is dropped, and the
 * spec would then wait for a next step that never comes. So the wait comes
 * first, and the click is checked: a step it answered is gone, the dialog
 * closed or showing the next one.
 *
 * @param {import('@playwright/test').Page} page
 */
async function pressContinue(page) {
	const before = await steps(page).locator('[part=count]').textContent();
	await page.waitForTimeout(CONTINUE_DELAY_MS);
	await steps(page).getByRole('button', { name: 'Continue' }).click();
	await expect
		.poll(
			() =>
				page.evaluate((count) => {
					const dialog = /** @type {any} */ (document.querySelector('passkey-step-dialog'));
					return (
						!dialog?.isOpen ||
						dialog.shadowRoot?.querySelector('[part=count]')?.textContent !== count
					);
				}, before),
			{ message: '"Continue" answered the step', timeout: 5000 }
		)
		.toBe(true);
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		/** @type {any} */ (globalThis).__simpleTodoPasskeySteps = true;
	});
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);
	await page.goto('/');
	await waitForConsent(page);
});

test('a new passkey: prompts 2 and 3 say what they are for, and start from "Continue"', async ({
	page
}) => {
	test.setTimeout(timeout * 2);
	await passConsent(page, { identity: 'create', label: 'Stepper' });

	await expect(steps(page).locator('[part=count]')).toHaveText('Passkey prompt 2 of 3', {
		timeout
	});
	// The app reads the PRF output itself, for the signing key and the key for
	// sealed lists at once (#127), so the step is the provider's "prf" one.
	await expect(steps(page).getByRole('heading')).toHaveText('Now the key for your data');
	// Held: only the passkey itself has been asked for so far.
	expect((await takeCeremonies(page)).map((ceremony) => ceremony.kind)).toEqual(['create']);

	await pressContinue(page);
	await expect(steps(page).locator('[part=count]')).toHaveText('Passkey prompt 3 of 3', {
		timeout
	});
	await expect(steps(page).getByRole('heading')).toHaveText('Now confirm your identity');
	await pressContinue(page);

	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
	expect((await takeCeremonies(page)).map((ceremony) => ceremony.kind)).toEqual(['get', 'get']);
	expect(await page.evaluate(() => document.querySelector('passkey-step-dialog')?.isOpen)).toBe(
		false
	);
});

test('"Cancel" stops before the prompt, and the passkey just made is the one to go on with', async ({
	page
}) => {
	test.setTimeout(timeout * 3);
	// In memory mode, so the passkey just made is nowhere in this browser and
	// going on with it means finding it on the authenticator: three prompts.
	await passConsent(page, { persistent: false, identity: 'create', label: 'Stopper' });
	await expect(steps(page).locator('[part=count]')).toHaveText('Passkey prompt 2 of 3', {
		timeout
	});
	await steps(page).getByRole('button', { name: 'Cancel' }).click();

	// Back in the dialog, told what happened, with no second passkey to make.
	await waitForConsent(page);
	await expect(page.getByTestId('consent-error')).toContainText(
		'Stopped before the next passkey prompt'
	);
	await expect(page.getByTestId('consent-proceed')).toHaveText(
		'Sign in with your passkey and start'
	);
	expect((await takeCeremonies(page)).map((ceremony) => ceremony.kind)).toEqual(['create']);

	// And it goes on with that passkey: found on the authenticator (nothing is
	// kept in memory mode), its PRF output, then the identity signature. One
	// press: there is no tick to set again. Four until the provider's restore
	// hands out the PRF output it reads (#127; provider #107).
	await page.getByTestId('consent-proceed').click();
	for (const [count, heading] of [
		['Passkey prompt 2 of 4', 'Once more, the same passkey'],
		['Passkey prompt 3 of 4', 'Now the key for your data'],
		['Passkey prompt 4 of 4', 'Now confirm your identity']
	]) {
		await expect(steps(page).locator('[part=count]')).toHaveText(count, { timeout });
		await expect(steps(page).getByRole('heading')).toHaveText(heading);
		await pressContinue(page);
	}
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
});

test('Escape in the step dialog means "Cancel", and leaves the start dialog open', async ({
	page
}) => {
	// The step dialog takes Escape as "Cancel". The start dialog comes back with
	// what happened, and the same key must not take that one away too: it would
	// close it, and a close is what starts the app.
	test.setTimeout(timeout * 2);
	await passConsent(page, { persistent: false, identity: 'create', label: 'Escaper' });
	await expect(steps(page).locator('[part=count]')).toHaveText('Passkey prompt 2 of 3', {
		timeout
	});
	await page.keyboard.press('Escape');

	await waitForConsent(page);
	await expect(page.getByTestId('consent-error')).toContainText(
		'Stopped before the next passkey prompt'
	);
	await page.waitForTimeout(500);
	expect(await isConsentOpen(page)).toBe(true);
	expect(await page.evaluate(() => document.querySelector('passkey-step-dialog')?.isOpen)).toBe(
		false
	);
	await expect(page.getByPlaceholder('What needs to be done?')).toBeDisabled();
});
