import { test, expect } from '@playwright/test';
import { acceptNotice, consentModal, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { addVirtualAuthenticator } from '@simple-todo/e2e-kit/webauthn.mjs';

// Chapter (archived01): two passkeys of this site on one authenticator.
//
// Everything this chapter keeps safe comes from one PRF output: the archive
// account that pays Aleph, the backup key, and the list key. Until provider
// 0.12.2 the request for it named no passkey, so with two passkeys of the site
// in one keychain either could answer. The other one's output derives another
// account and seals with another key, and nothing tells the two apart.
//
// Alice makes a passkey, seals a todo and turns the archive on. A second
// passkey of the site is then made on the same authenticator. Alice starts
// again:
//   1. every request for a PRF output names her passkey, hers answers, and the
//      list and the account are the ones she had;
//   2. if an authenticator answers with the other passkey anyway (this one is
//      steered to, as one that ignores the request's list would), the start
//      stops and says so instead of writing in the clear what she chose sealed.

const readyTimeout = 90000;
const mnemonic = 'lago-nube-piedra';

// Every passkey request, from the first script on: which credentials it names
// (base64url) and which one answered. With `steer-prf-to` in sessionStorage, a
// PRF request goes to that credential instead, the way an authenticator that
// ignores the request's list would answer.
const recordRequests = () => {
	/** @param {ArrayBuffer | ArrayBufferView} bytes */
	const b64url = (bytes) => {
		const view = ArrayBuffer.isView(bytes)
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: new Uint8Array(bytes);
		return btoa(String.fromCharCode(...view))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	};
	/** @type {{ kind: string, prf: boolean, allow: string[], answered: string | null }[]} */
	const log = [];
	Object.defineProperty(window, '__passkeyRequests', { value: log });
	const credentials = navigator.credentials;
	const create = credentials.create.bind(credentials);
	const get = credentials.get.bind(credentials);
	credentials.create = async (/** @type {any} */ options) => {
		const entry = {
			kind: 'create',
			prf: false,
			allow: [],
			answered: /** @type {string|null} */ (null)
		};
		log.push(entry);
		const created = /** @type {any} */ (await create(options));
		entry.answered = created ? b64url(created.rawId) : null;
		return created;
	};
	credentials.get = async (/** @type {any} */ options) => {
		const publicKey = options?.publicKey;
		const prf = Boolean(publicKey?.extensions?.prf);
		const steer = sessionStorage.getItem('steer-prf-to');
		const entry = {
			kind: 'get',
			prf,
			allow: (publicKey?.allowCredentials ?? []).map((/** @type {any} */ c) => b64url(c.id)),
			answered: /** @type {string|null} */ (null)
		};
		log.push(entry);
		let asked = options;
		if (prf && steer) {
			const id = Uint8Array.from(atob(steer.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
				c.charCodeAt(0)
			);
			asked = {
				...options,
				publicKey: { ...publicKey, allowCredentials: [{ type: 'public-key', id }] }
			};
		}
		const answer = /** @type {any} */ (await get(asked));
		entry.answered = answer ? b64url(answer.rawId) : null;
		return answer;
	};
};

/** @param {import('@playwright/test').Page} page */
const requests = (page) =>
	page.evaluate(
		() =>
			/** @type {{ kind: string, prf: boolean, allow: string[], answered: string | null }[]} */ (
				/** @type {any} */ (window).__passkeyRequests
			)
	);

/** @param {import('@playwright/test').Page} page @returns {Promise<{ sealed: boolean }[]>} */
const logOf = (page) => page.evaluate(() => /** @type {any} */ (globalThis).__simpleTodoLog());

test.describe('Two passkeys of this site on one authenticator', () => {
	test('every PRF request names the passkey this browser started with, and it answers', async ({
		browser
	}) => {
		test.setTimeout(readyTimeout * 4);
		const context = await browser.newContext();
		const page = await context.newPage();
		const secret = `secret-${Date.now().toString(36)}`;
		try {
			const { alice, bob, address } = await aliceThenBob(page, secret);

			await page.reload();
			await startAgain(page);
			await proceed(page);
			await expect(page.getByText(secret, { exact: true })).toBeVisible({ timeout: readyTimeout });
			expect((await logOf(page)).every((e) => e.sealed)).toBe(true);
			const panel = page.getByTestId('archive-panel');
			await expect(panel.getByTestId('archive-address')).toHaveText(address, {
				timeout: readyTimeout
			});

			const asked = (await requests(page)).filter((r) => r.kind === 'get');
			const prfReads = asked.filter((r) => r.prf);
			expect(prfReads.length).toBeGreaterThan(0);
			for (const read of prfReads) expect(read.allow).toEqual([alice]);
			for (const request of asked) expect(request.answered).toBe(alice);
			expect(asked.some((r) => r.answered === bob)).toBe(false);
		} finally {
			await context.close();
		}
	});

	test('when the other passkey answers anyway, the start stops instead of writing in the clear', async ({
		browser
	}) => {
		test.setTimeout(readyTimeout * 4);
		const context = await browser.newContext();
		const page = await context.newPage();
		const secret = `secret-${Date.now().toString(36)}`;
		try {
			const { alice, bob } = await aliceThenBob(page, secret);

			await page.evaluate((id) => sessionStorage.setItem('steer-prf-to', id), bob);
			await page.reload();
			await startAgain(page);
			await page.getByTestId('consent-proceed').click();
			await expect(consentModal(page).getByTestId('consent-error')).toContainText(
				'Another passkey of this site answered',
				{ timeout: readyTimeout }
			);
			const steered = (await requests(page)).filter((r) => r.kind === 'get' && r.prf);
			expect(steered.map((r) => r.answered)).toEqual([bob]);
			// Stopped before the list was opened: the consent screen is still up.
			expect(
				await page.evaluate(
					() => /** @type {any} */ (document.querySelector('[data-testid="consent-modal"]'))?.isOpen
				)
			).toBe(true);

			// Answered by Alice, the same start goes through, and the list is hers.
			// The failed start leaves the notice unconfirmed, as any failed start does.
			await page.evaluate(() => sessionStorage.removeItem('steer-prf-to'));
			await acceptNotice(page);
			await proceed(page);
			await expect(page.getByText(secret, { exact: true })).toBeVisible({ timeout: readyTimeout });
			expect((await logOf(page)).every((e) => e.sealed)).toBe(true);
			const prfReads = (await requests(page)).filter((r) => r.kind === 'get' && r.prf);
			expect(prfReads.at(-1)?.answered).toBe(alice);
		} finally {
			await context.close();
		}
	});
});

/**
 * Alice makes a passkey, seals a todo and turns the archive on; then a second
 * passkey of this site is made on the same authenticator.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} secret
 */
async function aliceThenBob(page, secret) {
	await addVirtualAuthenticator(page);
	await page.addInitScript(recordRequests);
	await page.goto('/');
	await fillConsent(page);
	await page.getByTestId('identity-mode-create').check();
	await page.getByTestId('passkey-label').fill('Alice');
	await expect(page.getByTestId('seal-list')).toBeChecked();
	await proceed(page);
	await page.getByPlaceholder('What needs to be done?').fill(secret);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(secret, { exact: true })).toBeVisible({ timeout: readyTimeout });
	expect((await logOf(page)).every((e) => e.sealed)).toBe(true);

	const panel = page.getByTestId('archive-panel');
	await panel.getByTestId('archive-backend').selectOption('local');
	await panel.getByTestId('archive-enable').click();
	await expect(panel.getByTestId('archive-sequence')).toHaveText('1', { timeout: readyTimeout });
	const address = (await panel.getByTestId('archive-address').textContent())?.trim() ?? '';
	expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

	const created = (await requests(page)).filter((r) => r.kind === 'create');
	expect(created).toHaveLength(1);
	const alice = /** @type {string} */ (created[0].answered);

	const bob = await page.evaluate(async () => {
		const credential = /** @type {any} */ (
			await navigator.credentials.create({
				publicKey: {
					rp: { id: location.hostname, name: 'simple-todo' },
					user: {
						id: crypto.getRandomValues(new Uint8Array(16)),
						name: 'bob',
						displayName: 'Bob'
					},
					challenge: crypto.getRandomValues(new Uint8Array(32)),
					pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
					authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
					extensions: /** @type {any} */ ({ prf: {} })
				}
			})
		);
		return credential.getClientExtensionResults().prf?.enabled === true;
	});
	expect(bob).toBe(true);
	const both = (await requests(page)).filter((r) => r.kind === 'create');
	expect(both).toHaveLength(2);
	const bobId = /** @type {string} */ (both[1].answered);
	expect(bobId).not.toBe(alice);
	return { alice, bob: bobId, address };
}

/** @param {import('@playwright/test').Page} page */
async function startAgain(page) {
	await fillConsent(page);
	await consentModal(page).getByTestId('p2p-mode-off').check();
	await expect(page.getByTestId('identity-mode-existing')).toBeChecked();
	await expect(page.getByTestId('seal-list')).toBeChecked();
}

/** @param {import('@playwright/test').Page} page */
async function fillConsent(page) {
	await waitForConsent(page);
	await consentModal(page).getByTestId('shared-list-mnemonic-input').fill(mnemonic);
	const keep = consentModal(page).getByTestId('storage-mode-indexeddb');
	if (!(await keep.isChecked())) await keep.check();
	await acceptNotice(page);
}

/** @param {import('@playwright/test').Page} page */
async function proceed(page) {
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
	);
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({
		timeout: readyTimeout
	});
}
