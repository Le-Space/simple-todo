import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import JoinSharedList from './JoinSharedList.svelte';

describe('JoinSharedList', () => {
	it('shows the share-code field only for somebody who asks to join', async () => {
		render(JoinSharedList, { join: false, value: '' });
		await expect.element(page.getByTestId('shared-list-mnemonic-input')).not.toBeInTheDocument();

		await page.getByTestId('consent-join-list').click();
		const input = page.getByTestId('shared-list-mnemonic-input');
		await expect.element(input).toBeVisible();
		await expect.element(input).toHaveFocus();
	});

	it('keeps a code brought by a link, without an error before anybody typed', async () => {
		render(JoinSharedList, { join: true, value: 'luna-camino-verde' });
		await expect
			.element(page.getByTestId('shared-list-mnemonic-input'))
			.toHaveValue('luna-camino-verde');
		await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
	});

	it('shows an accessible validation error for an unknown word', async () => {
		render(JoinSharedList, { join: true, value: 'luna-camino-verde' });
		const input = page.getByTestId('shared-list-mnemonic-input');
		await input.fill('luna-desconocida-verde');
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('Unknown Spanish share-code word');
		await expect.element(input).toHaveAttribute('aria-invalid', 'true');
	});
});
