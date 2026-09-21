/**
 * The identity survives a device that stored nothing.
 *
 * In memory mode this app writes nothing at all -- no keystore, no credential,
 * no mnemonic -- so the passkey is the only thing left that knows who this is.
 * Provider 0.6.0 gets the DID back from two signatures (an assertion does not
 * carry the public key) and the signing key from the PRF output, which is what
 * lets the storage choice mean what it says (#9).
 *
 * The inventory in the middle is the point of the test as much as the DID: a
 * run that kept the credential around would pass the second half for the wrong
 * reason.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { takeStorageInventory } from '@simple-todo/e2e-kit/storage-inventory.mjs';

test('the identity comes back from the passkey alone', async ({ page }) => {
	test.setTimeout(300000);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			hasPrf: true,
			automaticPresenceSimulation: true
		}
	});

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: false, identity: 'create', label: 'Restorer' });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout: 90000 });
	const before = await page.getByTestId('own-did-value').getAttribute('data-did');
	expect(before).toMatch(/^did:key:/);

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
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout: 120000 });
	const after = await page.getByTestId('own-did-value').getAttribute('data-did');
	expect(after).toBe(before);
});
