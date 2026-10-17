import { describe, expect, it } from 'vitest';
import {
	authorizationEntry,
	deleteCommand,
	findAuthorization,
	mergeAuthorizations,
	normalizeOwner,
	readAuthorizations,
	verifyCommand,
	withoutAuthorization,
	writeAuthorizationsCommand
} from './delegation.js';

const owner = '0x1111111111111111111111111111111111111111';
const delegate = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const channel = 'SIMPLE-TODO-ARCHIVED01';

describe('normalizeOwner', () => {
	it('checksums what Aleph keys accounts by', () => {
		expect(normalizeOwner(' 0xab5801a7d398351b8be11c439e05c5b3259aec9b ')).toBe(delegate);
	});
	it('refuses what is not an address', () => {
		expect(() => normalizeOwner('0x1234')).toThrow(/address/);
		expect(() => normalizeOwner('')).toThrow(/address/);
	});
});

describe('the grant', () => {
	it('is STORE on this channel, and FORGET only when asked', () => {
		expect(authorizationEntry({ delegate, channel })).toEqual({
			address: delegate,
			chain: 'ETH',
			types: ['STORE'],
			channels: [channel]
		});
		expect(authorizationEntry({ delegate, channel, forget: true }).types).toEqual([
			'STORE',
			'FORGET'
		]);
	});

	it('is found by address and channel, whatever the case of the address', () => {
		const list = [
			{ address: '0x2222222222222222222222222222222222222222', types: ['STORE'] },
			{ address: delegate.toLowerCase(), types: ['STORE'], channels: [channel] }
		];
		expect(findAuthorization(list, delegate, channel)).toMatchObject({
			store: true,
			forget: false
		});
		expect(findAuthorization(list, delegate, 'OTHER')).toMatchObject({
			entry: null,
			store: false
		});
		expect(findAuthorization([], delegate, channel).store).toBe(false);
	});

	it('an entry without types or channels grants everything', () => {
		expect(findAuthorization([{ address: delegate }], delegate, channel)).toMatchObject({
			store: true,
			forget: true
		});
	});

	it('replaces its own entry and keeps the others', () => {
		const other = { address: '0x2222222222222222222222222222222222222222', types: ['POST'] };
		const old = { address: delegate.toLowerCase(), types: ['STORE'] };
		const entry = authorizationEntry({ delegate, channel, forget: true });
		expect(mergeAuthorizations([other, old], entry)).toEqual([other, entry]);
		expect(withoutAuthorization([other, old], delegate)).toEqual([other]);
	});
});

describe('the commands the owner runs', () => {
	const entry = authorizationEntry({ delegate, channel });

	it('create the aggregate the first time, with the complete list', () => {
		const command = writeAuthorizationsCommand({ exists: false, authorizations: [entry] });
		expect(command).toMatch(
			/^aleph aggregate create --key security --channel security --content '/
		);
		expect(JSON.parse(command.match(/--content '([^']+)'/)?.[1] ?? '')).toEqual({
			authorizations: [entry]
		});
	});

	it('edit the subkey afterwards, confirmed, with the complete list', () => {
		const command = writeAuthorizationsCommand({ exists: true, authorizations: [entry] });
		expect(command).toMatch(
			/^aleph aggregate edit --key security --channel security --subkey authorizations --content '/
		);
		expect(command.endsWith(' -y')).toBe(true);
		expect(JSON.parse(command.match(/--content '([^']+)'/)?.[1] ?? '')).toEqual([entry]);
	});

	it('read the permissions back by the owner', () => {
		expect(verifyCommand(owner)).toBe(`aleph aggregate get security --address ${owner}`);
	});

	it('delete by file hash on the channel', () => {
		expect(deleteCommand({ cids: ['QmA', 'QmB'], channel })).toBe(
			'aleph file delete QmA QmB --channel SIMPLE-TODO-ARCHIVED01 --reason "archive deleted by its owner (simple-todo archived01)"'
		);
	});
});

describe('readAuthorizations', () => {
	/** @param {number} status @param {unknown} body */
	const answering = (status, body) => async () =>
		new Response(status === 404 ? '' : JSON.stringify(body), { status });

	it('an owner without the aggregate has an empty list, and no aggregate', async () => {
		expect(await readAuthorizations(owner, { fetch: answering(404, null) })).toEqual({
			exists: false,
			authorizations: []
		});
	});

	it('reads the list under data.security', async () => {
		const list = [{ address: delegate, types: ['STORE'] }];
		expect(
			await readAuthorizations(owner, {
				fetch: answering(200, { data: { security: { authorizations: list } } })
			})
		).toEqual({ exists: true, authorizations: list });
	});

	it('asks for the owner as given, under the security key', async () => {
		/** @type {string[]} */
		const urls = [];
		await readAuthorizations(owner, {
			apiHost: 'https://api.example',
			fetch: async (/** @type {any} */ url) => {
				urls.push(String(url));
				return new Response('{}', { status: 200 });
			}
		});
		expect(urls).toEqual([`https://api.example/api/v0/aggregates/${owner}.json?keys=security`]);
	});

	it('does not swallow a failing host', async () => {
		await expect(readAuthorizations(owner, { fetch: answering(500, {}) })).rejects.toThrow(/500/);
	});
});
