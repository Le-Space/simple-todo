import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

describe('/+page.svelte', () => {
	it('names what the app is for in its h1', async () => {
		render(Page);

		const heading = page.getByRole('main').getByRole('heading', {
			level: 1,
			name: 'Confidential escrow'
		});
		await expect.element(heading).toBeInTheDocument();
	});
});
