/**
 * The identity -- and with it the budget account -- survives a device that
 * stored nothing.
 *
 * In memory mode this app writes nothing at all -- no keystore, no credential,
 * no mnemonic -- so the passkey is the only thing left that knows who this is.
 * The provider gets the DID back from two signatures (an assertion does not
 * carry the public key) and the signing key from the PRF output, which is what
 * lets the storage choice mean what it says (#9).
 *
 * The inventory in the middle is the point of the test as much as the DID: a
 * run that kept the credential around would pass the second half for the wrong
 * reason. And the touches are counted, because "in three touches" is a promise
 * the chapter makes in its own words.
 *
 * In this chapter the DID is also what the budget account is derived from, so
 * the same DID after a restore is the same account on Sepolia, holding the same
 * confidential balance (docs/money-flow.md). The budget screens themselves run
 * against the fake here, as everywhere without `VITE_BUDGET_SERVICE=zama`.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { takeStorageInventory } from '@simple-todo/e2e-kit/storage-inventory.mjs';
import {
	addVirtualAuthenticator,
	forgetThisDevice,
	recordCeremonies,
	takeCeremonies
} from '@simple-todo/e2e-kit/webauthn.mjs';

const todoInput = (/** @type {import('@playwright/test').Page} */ page) =>
	page.getByPlaceholder('What needs to be done?');

/** @param {import('@playwright/test').Page} page @param {string} text */
async function writeTodo(page, text) {
	await todoInput(page).fill(text);
	await todoInput(page).press('Enter');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 60000 });
}

test('the identity comes back from the passkey alone, in three touches', async ({ page }) => {
	test.setTimeout(300000);
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: false, identity: 'create', label: 'Restorer' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });
	const before = await page.getByTestId('own-did-value').getAttribute('data-did');
	expect(before).toMatch(/^did:key:/);
	// Registering: the passkey itself, the PRF output the signing key comes from,
	// and the signature on the identity. No largeBlob write -- it never worked.
	expect((await takeCeremonies(page)).map((c) => c.kind)).toEqual(['create', 'get', 'get']);

	// Nothing on the device: no credential to recover from, so the restore below
	// has to come from the authenticator.
	const left = await takeStorageInventory(page);
	expect({ databases: left.indexedDB, local: left.localStorage }).toEqual({
		databases: [],
		local: []
	});

	await page.reload();
	await waitForConsent(page);
	await passConsent(page, { persistent: false, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120000 });
	const after = await page.getByTestId('own-did-value').getAttribute('data-did');
	expect(after).toBe(before);

	// Two to restore -- the first with PRF -- and one to sign the identity. The
	// restore's own signing key goes into the keystore, so the provider does not
	// ask the passkey for the PRF output a second time.
	const restore = await takeCeremonies(page);
	expect(restore.map((c) => `${c.kind}${c.prf ? '+prf' : ''}`)).toEqual(['get+prf', 'get', 'get']);
	expect(restore.every((c) => c.ok)).toBe(true);

	// And the restored identity signs: the step after the restore, which is
	// where provider 0.6.0's restore failed on two phones.
	await writeTodo(page, `after-restore-${Date.now().toString(36)}`);
	expect(await takeCeremonies(page)).toEqual([]);
});

test('a device that keeps things restores the passkey too, and keeps it', async ({ page }) => {
	test.setTimeout(300000);
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Keeper' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });
	const before = await page.getByTestId('own-did-value').getAttribute('data-did');

	// A second device, or this one wiped: the passkey is all that is left.
	await forgetThisDevice(page);
	await page.goto('/');
	await waitForConsent(page);
	await takeCeremonies(page);
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 120000 });
	expect(await page.getByTestId('own-did-value').getAttribute('data-did')).toBe(before);
	expect((await takeCeremonies(page)).length).toBe(3);

	// Keeping a restored credential used to throw -- it has no attestation
	// object, and the serialiser read one. Now it is written down, so the next
	// visit needs no restore.
	const kept = await page.evaluate(() => localStorage.getItem('simpleTodo.webauthnCredential'));
	expect(kept).toContain('"credentialId"');
	expect(kept).not.toContain('signingKey');

	await writeTodo(page, `kept-${Date.now().toString(36)}`);
});
