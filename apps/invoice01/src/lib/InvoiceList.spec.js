import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InvoiceList from './InvoiceList.svelte';

/**
 * Why this is a component test and not a two-browser one.
 *
 * The state it checks — one number on two issued invoices — arises between two
 * devices that are the same identity and were both offline. Reproducing that
 * end to end means two contexts sharing one credential and a replication round,
 * which is the shape of test this repository has had to park elsewhere. The
 * rule itself is covered in `invoice/duplicates.spec.js`; what is left is
 * whether the list says so and offers the right way out, and that is exactly
 * what a rendered list can answer.
 */

const line = {
	description: 'Beratung',
	quantity: 1,
	unit: 'Tag',
	unitPriceCents: 50_000,
	vatRate: 19
};

const invoice = (/** @type {any} */ values) => ({
	id: values.id,
	state: 'issued',
	number: values.number,
	issuedAt: values.issuedAt,
	issueDate: '2026-09-24',
	taxMode: 'standard',
	customer: { name: values.customer ?? 'Beispiel AG', address: 'Musterstadt', vatId: '' },
	lines: [line],
	...values
});

describe('a number that went out twice', () => {
	const clashing = [
		invoice({ id: 'laptop', number: '2026-004', issuedAt: '2026-09-24T09:00:00.000Z' }),
		invoice({
			id: 'phone',
			number: '2026-004',
			issuedAt: '2026-09-24T11:00:00.000Z',
			customer: 'Acme GmbH'
		})
	];

	it('marks both, and offers the way out only on the one that must give way', async () => {
		render(InvoiceList, { invoices: clashing, locale: 'de' });

		// Both are named, because a reader has to see there are two.
		await expect.element(page.getByTestId('invoice-duplicate-mark').first()).toBeVisible();
		expect(await page.getByTestId('invoice-duplicate-mark').all()).toHaveLength(2);

		// One button, on the later invoice: the first one keeps the number.
		const reissue = await page.getByTestId('invoice-reissue').all();
		expect(reissue).toHaveLength(1);

		// And the one that keeps its number still offers an ordinary Storno.
		expect(await page.getByTestId('invoice-storno').all()).toHaveLength(1);
	});

	it('says nothing where every number went out once', async () => {
		render(InvoiceList, {
			invoices: [
				invoice({ id: 'a', number: '2026-004', issuedAt: '2026-09-24T09:00:00.000Z' }),
				invoice({ id: 'b', number: '2026-005', issuedAt: '2026-09-24T11:00:00.000Z' })
			],
			locale: 'de'
		});
		expect(await page.getByTestId('invoice-duplicate-mark').all()).toHaveLength(0);
		expect(await page.getByTestId('invoice-reissue').all()).toHaveLength(0);
	});
});
