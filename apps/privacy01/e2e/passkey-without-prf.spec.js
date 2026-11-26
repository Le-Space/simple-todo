/**
 * A passkey without PRF: nothing to derive a key from.
 *
 * The signing key is then made fresh per session, as before. The encryption
 * pair — the one others seal list keys to — is a random one that exists only in
 * this browser: a WebCrypto key that cannot be exported, kept as it is in
 * IndexedDB. No script can read it out, but any script on the page can use it,
 * so the reader is told that a browser without extensions, or a profile of its
 * own, is the better place for it (the decision taken for escrow01, and for
 * this chapter).
 *
 * The shared helper's authenticator always has PRF; this one is set up here,
 * the same way with `hasPrf: false`.
 */
import { test, expect } from '@playwright/test';
import { passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { recordCeremonies, takeCeremonies } from '@simple-todo/e2e-kit/webauthn.mjs';

const todoInput = (/** @type {import('@playwright/test').Page} */ page) =>
	page.getByPlaceholder('What needs to be done?');

/** @param {import('@playwright/test').Page} page */
async function addAuthenticatorWithoutPrf(page) {
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
			hasPrf: false,
			automaticPresenceSimulation: true
		}
	});
}

/**
 * What IndexedDB holds for this identity: the public half, and whether the
 * private half is a key that cannot be exported. Null when nothing is kept.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} did
 */
const keptPair = (page, did) =>
	page.evaluate(async (id) => {
		const name = 'level-js-simple-todo/privacy01/agreement-keys';
		if (!(await indexedDB.databases()).some((db) => db.name === name)) return null;
		/** @type {IDBDatabase} */
		const db = await new Promise((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			/** @type {any} */
			const value = await new Promise((resolve, reject) => {
				const request = db.transaction('keys', 'readonly').objectStore('keys').get(id);
				request.onsuccess = () => resolve(request.result ?? null);
				request.onerror = () => reject(request.error);
			});
			if (!value) return null;
			return {
				publicKey: value.publicKey,
				isKey: value.privateKey instanceof CryptoKey,
				extractable: value.privateKey?.extractable
			};
		} finally {
			db.close();
		}
	}, did);

test('a passkey without PRF keeps its encryption key in this browser, and says so', async ({
	page
}) => {
	test.setTimeout(240000);
	await addAuthenticatorWithoutPrf(page);
	await recordCeremonies(page);

	await page.goto('/');
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'create', label: 'Without PRF' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });
	const did = (await page.getByTestId('own-did-value').getAttribute('data-did')) ?? '';
	expect(did).toMatch(/^did:key:/);

	// As many touches as with PRF: the one read that finds no PRF output, and
	// the provider is not sent to ask again.
	expect((await takeCeremonies(page)).map((c) => `${c.kind}${c.prf ? '+prf' : ''}`)).toEqual([
		'create+prf',
		'get+prf',
		'get'
	]);

	// Said in words, not only in the code.
	await expect(page.getByText(/a browser without extensions, or a profile of its own/)).toBeVisible(
		{ timeout: 30000 }
	);

	// The pair this browser keeps: a key nobody can export, and not a word of
	// it in local storage. That it is here at all is what "without PRF" costs,
	// and why the warning is there.
	const kept = await keptPair(page, did);
	expect(kept).toEqual({ publicKey: expect.any(String), isKey: true, extractable: false });
	expect(
		await page.evaluate(() =>
			Object.keys(localStorage).filter((key) => key.startsWith('privacy01.deviceKey.'))
		)
	).toEqual([]);

	// Kept means kept: the next visit finds the same pair, so copies sealed to
	// it still open.
	await page.reload();
	await waitForConsent(page);
	await passConsent(page, { persistent: true, identity: 'existing' });
	await expect(todoInput(page)).toBeEnabled({ timeout: 90000 });
	expect(await page.getByTestId('own-did-value').getAttribute('data-did')).toBe(did);
	expect((await keptPair(page, did))?.publicKey).toBe(kept?.publicKey);

	// And the identity still writes.
	const text = `without-prf-${Date.now().toString(36)}`;
	await todoInput(page).fill(text);
	await todoInput(page).press('Enter');
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 60000 });
});
