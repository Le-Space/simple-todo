import { test, expect } from '@playwright/test';
import {
	isConsentOpen,
	openAdvanced,
	passConsent,
	waitForConsent
} from '@simple-todo/e2e-kit/consent.mjs';
import {
	addVirtualAuthenticator,
	recordCeremonies,
	takeCeremonies
} from '@simple-todo/e2e-kit/webauthn.mjs';
import { openSection } from './sections.mjs';

/**
 * Between two passkey prompts, what the next one is for.
 *
 * A new passkey takes three prompts here — the passkey, its PRF output (read
 * once by the start, for the signing key and the lists' vault), the identity
 * signature — and without a word in between that looks like a loop. The
 * provider announces each prompt after the first; `<passkey-step-dialog>` (its
 * ./elements) says which one comes and why, and the prompt starts from
 * "Continue". A vault kept in this browser costs one more, and the count says
 * so before the first prompt.
 *
 * E2E builds leave the dialog off, so the other specs need not click through
 * it; this one turns it on before the page loads.
 */

const timeout = 90000;
const steps = (/** @type {import('@playwright/test').Page} */ page) =>
	page.locator('passkey-step-dialog');
const todoInput = (/** @type {import('@playwright/test').Page} */ page) =>
	page.getByPlaceholder('What needs to be done?');

/**
 * "Continue", once the step dialog takes it. From provider 0.14.0 the dialog
 * ignores the button for `CONTINUE_DELAY_MS` (400) after a step appears, so a
 * click that comes at once is dropped, and the spec would wait for a step that
 * never comes. Then: the dialog closed, or shows the next step.
 *
 * @param {import('@playwright/test').Page} page
 */
async function pressContinue(page) {
	const count = steps(page).locator('[part=count]');
	const before = await count.textContent();
	await page.waitForTimeout(450);
	await steps(page).getByRole('button', { name: 'Continue' }).click();
	await expect
		.poll(
			async () =>
				!(await page.evaluate(() => document.querySelector('passkey-step-dialog')?.isOpen)) ||
				(await count.textContent()) !== before,
			{ timeout }
		)
		.toBe(true);
}

/**
 * Answer each announced prompt in turn, checking what the dialog says.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<[string, string]>} expected count and heading, in order
 */
async function continueThrough(page, expected) {
	for (const [count, heading] of expected) {
		await expect(steps(page).locator('[part=count]')).toHaveText(count, { timeout });
		await expect(steps(page).getByRole('heading')).toHaveText(heading);
		await pressContinue(page);
	}
}

const ceremonies = async (/** @type {import('@playwright/test').Page} */ page) =>
	(await takeCeremonies(page)).map((c) => `${c.kind}${c.prf ? '+prf' : ''}`);

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
	await expect(steps(page).getByRole('heading')).toHaveText('Now the key for your data');
	// Held: only the passkey itself has been asked for so far.
	expect(await ceremonies(page)).toEqual(['create+prf']);

	await pressContinue(page);
	await continueThrough(page, [['Passkey prompt 3 of 3', 'Now confirm your identity']]);

	await expect(todoInput(page)).toBeEnabled({ timeout });
	expect(await ceremonies(page)).toEqual(['get+prf', 'get']);
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
	expect(await ceremonies(page)).toEqual(['create+prf']);

	// And it goes on with that passkey: found on the authenticator (nothing is
	// kept in memory mode), then the identity signature. One press: there is no
	// tick to set again.
	await page.getByTestId('consent-proceed').click();
	await continueThrough(page, [
		['Passkey prompt 2 of 3', 'Once more, the same passkey'],
		['Passkey prompt 3 of 3', 'Now confirm your identity']
	]);
	await expect(todoInput(page)).toBeEnabled({ timeout });
	expect(await ceremonies(page)).toEqual(['get+prf', 'get', 'get']);
});

test('"Cancel" while keeping things: the passkey made is kept, and what is left has no count', async ({
	page
}) => {
	// Kept in this browser, the passkey just made is written down before the
	// stop -- but its signing key and the identity's proof are not made yet.
	// Going on with it takes two prompts where a kept passkey usually takes
	// none, and a count of one would read "Passkey prompt 2 of 1".
	test.setTimeout(timeout * 3);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Kept' });
	await expect(steps(page).locator('[part=count]')).toHaveText('Passkey prompt 2 of 3', {
		timeout
	});
	await steps(page).getByRole('button', { name: 'Cancel' }).click();

	await waitForConsent(page);
	await expect(page.getByTestId('consent-proceed')).toHaveText(
		'Sign in with your passkey and start'
	);
	expect(await ceremonies(page)).toEqual(['create+prf']);

	await page.getByTestId('consent-proceed').click();
	await continueThrough(page, [['Passkey prompt 2', 'Now confirm your identity']]);
	await expect(todoInput(page)).toBeEnabled({ timeout });
	expect(await ceremonies(page)).toEqual(['get+prf', 'get']);
});

test('"Cancel" in a restore says it stopped, not that no passkey was found', async ({ page }) => {
	// The restore asks twice, and a stop between the two used to read as "the
	// authenticator could not answer": the person was told to make a new
	// passkey for the one they had just stopped using.
	test.setTimeout(timeout * 3);
	await passConsent(page, { persistent: false, identity: 'create', label: 'Twice' });
	await continueThrough(page, [
		['Passkey prompt 2 of 3', 'Now the key for your data'],
		['Passkey prompt 3 of 3', 'Now confirm your identity']
	]);
	await expect(todoInput(page)).toBeEnabled({ timeout });
	await takeCeremonies(page);

	// Memory mode kept nothing: the next start finds the passkey on the authenticator.
	await page.reload();
	await waitForConsent(page);
	await passConsent(page, { persistent: false, identity: 'existing' });
	await expect(steps(page).locator('[part=count]')).toHaveText('Passkey prompt 2 of 3', {
		timeout
	});
	await expect(steps(page).getByRole('heading')).toHaveText('Once more, the same passkey');
	await steps(page).getByRole('button', { name: 'Cancel' }).click();

	await waitForConsent(page);
	const alert = page.getByTestId('consent-error');
	await expect(alert).toContainText('Stopped before the next passkey prompt');
	await expect(alert).not.toContainText('No passkey is stored');
	await expect(page.getByTestId('consent-proceed')).toHaveText(
		'Sign in with your passkey and start'
	);
	expect(await ceremonies(page)).toEqual(['get+prf']);
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
	await expect(todoInput(page)).toBeDisabled();
});

test('a passkey this browser keeps asks nothing; a vault kept here counts in a restore', async ({
	page
}) => {
	test.setTimeout(timeout * 4);
	// One prompt or none is never announced: the first comes from the click.
	const stepDialogOpen = () =>
		page.evaluate(() => document.querySelector('passkey-step-dialog')?.isOpen === true);

	await passConsent(page, { persistent: true, identity: 'create', label: 'Keeper' });
	await continueThrough(page, [
		['Passkey prompt 2 of 3', 'Now the key for your data'],
		['Passkey prompt 3 of 3', 'Now confirm your identity']
	]);
	await expect(todoInput(page)).toBeEnabled({ timeout });
	await takeCeremonies(page);

	// Kept: the signing key is in the keystore and the identity's proof is kept,
	// so the passkey is not asked at all, and there is nothing to announce.
	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout });
	expect(await ceremonies(page)).toEqual([]);
	expect(await stepDialogOpen()).toBe(false);

	// A sealed list makes the vault, from the PRF output it asks for now.
	const sealed = `versiegelt-${Date.now().toString(36)}`;
	await openSection(page, 'listen');
	await page.getByTestId('new-list-name').fill(sealed);
	await page.getByTestId('new-list-seal').check();
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('new-list-created-name')).toHaveText(sealed, { timeout });
	await expect(page.getByTestId('new-list-created-sealed')).toHaveCount(1);
	expect(await ceremonies(page)).toEqual(['get+prf']);

	// Kept, with the vault: one prompt, for the vault, and it comes from the click.
	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout });
	expect(await ceremonies(page)).toEqual(['get+prf']);
	expect(await stepDialogOpen()).toBe(false);

	// Past the kept passkey, to the authenticator, with the vault kept here: the
	// count says four before the first prompt -- two to restore, the vault, the
	// signature. Which passkey answers is only known afterwards. This one proved
	// its identity in this browser before, and the proof is kept, so the
	// signature is not asked for: three, and the dialog never reaches "4 of 4".
	// A second passkey of these lists, the case the box is for, takes all four
	// (list-vault.spec.js).
	await page.goto('/');
	await waitForConsent(page);
	await openAdvanced(page);
	await page.getByTestId('passkey-ask-authenticator').check();
	await page.getByTestId('consent-proceed').click();
	await continueThrough(page, [
		['Passkey prompt 2 of 4', 'Once more, the same passkey'],
		['Passkey prompt 3 of 4', 'Now the key for your data']
	]);
	await expect(todoInput(page)).toBeEnabled({ timeout });
	expect(await ceremonies(page)).toEqual(['get+prf', 'get', 'get+prf']);
	expect(await stepDialogOpen()).toBe(false);
});
