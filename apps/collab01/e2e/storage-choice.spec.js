import { test, expect } from '@playwright/test';
import { takeStorageInventory } from '@simple-todo/e2e-kit/storage-inventory.mjs';

const timeout = 90000;

/**
 * The claim the storage choice makes, in both directions.
 *
 * This chapter ran in memory unconditionally and never said so, which is the
 * worse half: a reload emptied everything and the screen had not offered a say
 * in it.
 *
 * The memory case counts *records*, not database names. Filtering names for
 * `simple-todo` is what let the same assertion pass elsewhere while OrbitDB's
 * `level-js-orbitdb/keystore` sat there holding a signing key (#9): the log
 * databases are created either way, as empty shells, so their existence proves
 * nothing and their contents prove everything.
 *
 * The dialog here is this chapter's own Svelte modal, not the `qr-intro`
 * element the later chapters use, so the kit's consent helpers do not apply and
 * the ticks are found the way this chapter's other specs find them.
 */
const consentModal = (page) => page.locator('div.fixed.inset-0.z-50');

/** @param {import('@playwright/test').Page} page */
async function passConsent(page) {
	const boxes = consentModal(page).locator('input[type="checkbox"]');
	const count = await boxes.count();
	for (let index = 0; index < count; index += 1) {
		const box = boxes.nth(index);
		// The last one is "don't show this again"; leaving it alone keeps the
		// dialog available on reload, which is what the reload case needs.
		if (await box.isChecked()) continue;
		const label = (await box.evaluate((node) => node.closest('label')?.textContent ?? '')).trim();
		if (label.startsWith("Don't show this again")) continue;
		await box.check();
	}
	await page
		.locator('button')
		.filter({ hasText: /Open shared list/ })
		.click();
	await expect(consentModal(page)).not.toBeVisible();
}
async function openWith(page, mode) {
	await page.goto('/');
	await expect(consentModal(page)).toBeVisible({ timeout });
	await page.getByTestId(`storage-mode-${mode}`).check();
	await passConsent(page);
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

async function reopen(page) {
	await page.reload();
	// Whether the dialog comes back is the app's business, not this test's.
	await consentModal(page)
		.waitFor({ state: 'visible', timeout: 10_000 })
		.catch(() => {});
	if (await consentModal(page).isVisible()) await passConsent(page);
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

/** Records held by every IndexedDB database whose name starts with one of `prefixes`. */
async function recordsUnder(page, prefixes) {
	return page.evaluate(async (wanted) => {
		const names = (await indexedDB.databases())
			.map((database) => database.name ?? '')
			.filter((name) => wanted.some((prefix) => name.startsWith(prefix)));
		const counted = [];
		for (const name of names) {
			const database = await new Promise((resolve) => {
				const request = indexedDB.open(name);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
			});
			if (!database) continue;
			let records = 0;
			for (const store of Array.from(database.objectStoreNames)) {
				records += await new Promise((resolve) => {
					const request = database.transaction(store, 'readonly').objectStore(store).count();
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => resolve(0);
				});
			}
			database.close();
			counted.push({ name, records });
		}
		return counted;
	}, prefixes);
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

	test('in memory only: no todo is written to this device', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await openWith(page, 'memory');

		const todo = `gone-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });

		// The blocks live under this app's own prefix, the log under OrbitDB's.
		// Both must be empty of records; the keystore is a separate question
		// (#9) and is not what this asserts.
		const written = await recordsUnder(page, ['level-js-simple-todo/']);
		expect(written.filter((database) => database.records > 0)).toEqual([]);

		const logs = await recordsUnder(page, ['level-js-orbitdb/orbitdb/']);
		expect(logs.filter((database) => database.records > 0)).toEqual([]);
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
