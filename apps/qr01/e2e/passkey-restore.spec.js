/**
 * The identity survives a device that was wiped, in a chapter that keeps things.
 *
 * qr01 is the offline chapter: it turns persistent storage on for itself, so
 * the usual return is the cheap one — the credential is in this browser and
 * "Use existing passkey" costs a single touch. This test takes that away. It
 * clears the profile the way a new device has never had one, and then the
 * passkey is the only thing left that knows who this is: the provider gets the
 * DID back from two signatures (an assertion does not carry the public key) and
 * the signing key from the PRF output.
 *
 * The touches are counted rather than assumed, because "in three touches" is a
 * promise the chapters make in their own words, and because the count went from
 * 2 to 5 unnoticed once already.
 *
 * Identity is adopted by clicking, not on mount: WebAuthn refuses to run
 * outside a user gesture, which is why every step here goes through
 * `createPasskey` / `restorePasskey` from open-app.mjs.
 */
import { test, expect } from '@playwright/test';
import {
	addVirtualAuthenticator,
	forgetThisDevice,
	recordCeremonies,
	takeCeremonies
} from '@simple-todo/e2e-kit/webauthn.mjs';
import { createPasskey, openReadyApp, restorePasskey, todoInput } from './open-app.mjs';

const timeout = 90_000;

/** @param {import('@playwright/test').Page} page @param {string} text */
async function writeTodo(page, text) {
	await todoInput(page).fill(text);
	await todoInput(page).press('Enter');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page */
function ownDid(page) {
	return page.getByTestId('own-did-value').getAttribute('data-did');
}

test('the identity comes back from the passkey alone, in three touches', async ({ page }) => {
	test.setTimeout(300_000);
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await openReadyApp(page);
	await createPasskey(page, { userId: 'restorer@example.com', displayName: 'Restorer' });
	const before = await ownDid(page);
	expect(before).toMatch(/^did:key:/);
	// Registering: the passkey itself, the PRF output the signing key comes
	// from, and the signature on the identity. No largeBlob write -- this
	// chapter is where that extension was measured and found to do nothing.
	expect((await takeCeremonies(page)).map((c) => c.kind)).toEqual(['create', 'get', 'get']);

	// A device that has never seen this passkey: no credential, no keystore, no
	// mnemonic. Whatever comes back now came from the authenticator.
	await forgetThisDevice(page);
	await openReadyApp(page);
	await takeCeremonies(page);

	await restorePasskey(page);
	expect(await ownDid(page)).toBe(before);
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

test('once restored, the next visit is the cheap one again', async ({ page }) => {
	test.setTimeout(300_000);
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await openReadyApp(page);
	await createPasskey(page, { userId: 'keeper@example.com', displayName: 'Keeper' });
	const before = await ownDid(page);

	await forgetThisDevice(page);
	await openReadyApp(page);
	await takeCeremonies(page);
	await restorePasskey(page);
	expect(await ownDid(page)).toBe(before);
	expect((await takeCeremonies(page)).length).toBe(3);

	// This chapter keeps things, so the restored credential is written down --
	// which used to throw, because a restored passkey has no attestation object
	// and the serialiser read one. Together with the keystore and the identity
	// proof the provider files next to it, that makes the next return cost
	// nothing at all: not a restore, not even the identity signature.
	//
	// Worth saying plainly, because it is also the cost of keeping things: from
	// then on this browser profile *is* the identity. Whoever has the profile
	// can write as this DID without ever touching the passkey. The chapter that
	// wanted the opposite is privacy01, and it keeps nothing.
	await page.reload();
	await takeCeremonies(page);
	await restorePasskey(page);
	expect(await ownDid(page)).toBe(before);
	expect(await takeCeremonies(page)).toEqual([]);

	const kept = await page.evaluate(() => ({
		credential: Boolean(localStorage.getItem('simpleTodo.webauthnCredential')),
		proof: Object.keys(localStorage).some((k) => k.startsWith('webauthn-identity-proof'))
	}));
	expect(kept).toEqual({ credential: true, proof: true });

	await writeTodo(page, `kept-${Date.now().toString(36)}`);
});
