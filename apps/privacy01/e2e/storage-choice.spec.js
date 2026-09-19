import { test, expect } from '@playwright/test';
import { isConsentOpen, passConsent, waitForConsent } from '@simple-todo/e2e-kit/consent.mjs';

const timeout = 90000;

/**
 * The claim the storage choice makes, in both directions.
 *
 * This chapter ran in memory unconditionally and never said so: a reload
 * emptied the list, and the consent screen had not offered a say in it.
 *
 * The memory case counts *records*, not database names. Filtering names for
 * `simple-todo` is what let the same assertion pass elsewhere while OrbitDB's
 * `level-js-orbitdb/keystore` sat there holding a signing key (#9): the log
 * databases are created either way, as empty shells, so their existence proves
 * nothing and their contents prove everything.
 */
async function openWith(page, mode) {
	await page.goto('/');
	await waitForConsent(page);
	await page.getByTestId(`storage-mode-${mode}`).check();
	await passConsent(page);
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

async function reopen(page) {
	await page.reload();
	// Whether the dialog comes back is the app's business, not this test's.
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

		// Blocks live under this app's own prefix, the log under OrbitDB's. The
		// keystore is a separate question (#9) and is not what this asserts.
		const written = await recordsUnder(page, ['level-js-simple-todo/']);
		expect(written.filter((database) => database.records > 0)).toEqual([]);

		const logs = await recordsUnder(page, ['level-js-orbitdb/orbitdb/']);
		expect(logs.filter((database) => database.records > 0)).toEqual([]);
	});
});
