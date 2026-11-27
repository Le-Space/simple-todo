import { test, expect } from '@playwright/test';
import { takeStorageInventory } from '@simple-todo/e2e-kit/storage-inventory.mjs';
import { isConsentOpen, passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';
import { openSection } from './sections.mjs';

const timeout = 90000;

/**
 * The claim the storage choice makes, in both directions.
 *
 * This chapter ran in memory unconditionally and never said so — a reload
 * emptied everything, which is also what made an offline test measure the
 * wrong thing (see the `fixme` block in delegation.spec.js). Asserting both
 * halves, because "keeps them" is only meaningful next to "does not".
 */
async function openWith(page, mode) {
	await page.goto('/');
	await waitForConsent(page);
	// Through the helper, which opens "Advanced" first: the storage choice is
	// folded there, and a click on a folded radio waits for the test's whole
	// budget.
	await passConsent(page, { persistent: mode === 'indexeddb' });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

async function reopen(page) {
	await page.reload();

	// The dialog may not come back at all — whether it does is the app's
	// business, not this test's. Waiting for it to reappear is what made this
	// fail the first time: on the helper, not on storage. Asked of the element
	// rather than measured, because the host is 0x0 once it upgrades.
	await page
		.waitForFunction(
			() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true,
			undefined,
			{ timeout: 10_000 }
		)
		.catch(() => {});
	if (await isConsentOpen(page)) await passConsent(page);

	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

test.describe('Where your todos are stored', () => {
	test('kept in this browser: a todo survives a reload', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await openWith(page, 'indexeddb');

		const todo = `kept-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });

		await reopen(page);
		await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });
	});

	// What the start dialog says since #127: "Your own lists lie in this
	// browser's storage sealed, as on the relay". Read on the device, every
	// value of every store, not the names of the databases. The three-word list
	// is the control: it is open, so its todo must be found in the clear --
	// otherwise the search would prove nothing about the sealed one.
	test('kept in this browser: one’s own list lies sealed here, the three-word list open', async ({
		page
	}) => {
		test.setTimeout(timeout * 4);
		await openWith(page, 'indexeddb');
		const stamp = Date.now().toString(36);
		const sealed = `sealed-here-${stamp}`;
		const open = `open-here-${stamp}`;

		// The first todo makes this identity's own list, which is sealed.
		await page.getByPlaceholder('What needs to be done?').fill(sealed);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(sealed, { exact: true })).toBeVisible({ timeout });

		await openSection(page, 'listen');
		await page.getByTestId('three-word-list-open').click();
		await openSection(page, 'aufgaben');
		await expect(page.getByTestId('active-list-heading')).toHaveAttribute('data-kind', 'shared', {
			timeout
		});
		await page.getByPlaceholder('What needs to be done?').fill(open);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(open, { exact: true })).toBeVisible({ timeout });

		await expect
			.poll(async () => (await everythingKeptHere(page)).includes(open), {
				message: 'the open list’s todo, in the clear (the control)',
				timeout
			})
			.toBe(true);
		const kept = await everythingKeptHere(page);
		expect(kept, 'entries that say they are sealed').toContain('sealed');
		expect(kept.includes(sealed), `"${sealed}" in the clear on this device`).toBe(false);
	});

	test('in memory only: nothing is written to this device', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await openWith(page, 'memory');

		const todo = `gone-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });

		// What the choice promises is about this device, so it is checked on this
		// device: no IndexedDB database of ours may exist at all. A todo that
		// merely failed to render would pass a weaker assertion.
		const ours = await page.evaluate(async () =>
			(await indexedDB.databases())
				.map((d) => d.name ?? '')
				.filter((n) => n.includes('simple-todo'))
		);
		expect(ours).toEqual([]);
	});

	test('in memory only: the device is left as it was found', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await openWith(page, 'memory');

		await page.getByPlaceholder('What needs to be done?').fill(`trace-${Date.now().toString(36)}`);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		// Long enough for the keystore, the registry and the log to have been
		// written if anything still writes them.
		await page.waitForTimeout(3000);

		// The whole device, not the databases whose names we thought to filter
		// for: that filter is what let `level-js-orbitdb/keystore` hold a signing
		// key while a test called this clean (#9).
		const left = await takeStorageInventory(page);
		expect(
			{ databases: left.indexedDB, local: left.localStorage, session: left.sessionStorage },
			`caches (the app shell, which may stay): ${JSON.stringify(left.caches)}`
		).toEqual({ databases: [], local: [], session: [] });
	});
});

/**
 * Every key and value this page left in IndexedDB, localStorage and
 * sessionStorage, as one string: bytes decoded as UTF-8, objects as JSON.
 * Text in the clear shows up here whatever store or encoding holds it.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function everythingKeptHere(page) {
	return page.evaluate(async () => {
		const decoder = new TextDecoder('utf-8', { fatal: false });
		/** @param {unknown} value @returns {string} */
		const text = (value) => {
			if (value == null) return '';
			if (typeof value === 'string') return value;
			if (value instanceof ArrayBuffer) return decoder.decode(new Uint8Array(value));
			if (ArrayBuffer.isView(value)) {
				return decoder.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
			}
			if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) return '[CryptoKey]';
			if (typeof value === 'object') {
				return JSON.stringify(value, (_key, inner) =>
					inner instanceof ArrayBuffer || ArrayBuffer.isView(inner) ? text(inner) : inner
				);
			}
			return String(value);
		};
		/** @type {string[]} */
		const parts = [];
		for (const entry of await indexedDB.databases()) {
			if (!entry.name) continue;
			const database = await new Promise((resolve) => {
				const request = indexedDB.open(/** @type {string} */ (entry.name));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
				request.onblocked = () => resolve(null);
			});
			if (!database) continue;
			for (const store of Array.from(database.objectStoreNames)) {
				await new Promise((resolve) => {
					const request = database.transaction(store, 'readonly').objectStore(store).openCursor();
					request.onsuccess = () => {
						const cursor = request.result;
						if (!cursor) return resolve(undefined);
						parts.push(text(cursor.key), text(cursor.value));
						cursor.continue();
					};
					request.onerror = () => resolve(undefined);
				});
			}
			database.close();
		}
		for (const storage of [localStorage, sessionStorage]) {
			for (const key of Object.keys(storage)) parts.push(key, storage.getItem(key) ?? '');
		}
		return parts.join('\n');
	});
}
