import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

/**
 * The start of a device that has never seen this passkey: its registry is
 * empty when the start looks, and fills from the relay later. Everything the
 * home list leans on is replaced, so what is measured is only when it opens.
 */
const fake = vi.hoisted(() => ({
	/** @type {any} */ stores: null,
	version: 0,
	/** @type {Map<string, string>} */ memory: new Map()
}));

vi.mock('./db-actions.js', async () => {
	const { writable: store } = await import('svelte/store');
	fake.stores = {
		orbitdb: store({ identity: { id: 'did:key:z-owner' } }),
		active: store({ kind: 'shared', name: 'three-words', address: '/orbitdb/shared' }),
		pending: store(false)
	};
	/** @param {string} address @param {string} name */
	const open = (address, name) => {
		fake.version += 1;
		fake.stores.pending.set(false);
		fake.stores.active.set({ kind: 'private', name, address });
	};
	return {
		orbitdbStore: fake.stores.orbitdb,
		activeListStore: fake.stores.active,
		homeListPendingStore: fake.stores.pending,
		currentListVersion: () => fake.version,
		loadTodoDatabase: vi.fn(async (address, { unlessSwitchedSince } = {}) => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			if (unlessSwitchedSince !== undefined && fake.version !== unlessSwitchedSince) {
				return { address, count: 0, superseded: true };
			}
			open(address, 'Home');
			return { address, count: 1 };
		}),
		createPrivateTodoList: vi.fn(async (name) => {
			open('/orbitdb/new-list', name);
			return { address: '/orbitdb/new-list', name };
		}),
		/** for the tests: somebody opens another list */
		openSomethingElse: () => open('/orbitdb/elsewhere', 'Elsewhere')
	};
});

vi.mock('./list-registry.js', async () => {
	const { writable: store } = await import('svelte/store');
	return {
		listRegistryStore: store([]),
		openListRegistry: vi.fn(async () => ({}))
	};
});

vi.mock('@simple-todo/todo/browser-memory.js', () => ({
	recall: (/** @type {string} */ key) => fake.memory.get(key) ?? null,
	remember: (/** @type {string} */ key, /** @type {string} */ value) => fake.memory.set(key, value)
}));

vi.mock('./i18n/index.js', () => ({ translate: (/** @type {string} */ key) => key }));

const { openHomeList } = await import('./home-list.js');
const dbActions = /** @type {any} */ (await import('./db-actions.js'));
const { listRegistryStore } = await import('./list-registry.js');

const OLD_HOME = '/orbitdb/old-home';
/** @type {{ address: string, name: string, role: 'owner' | 'guest', createdAt: number }} */
const ownerEntry = { address: OLD_HOME, name: 'Home', role: 'owner', createdAt: 1 };

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('openHomeList on a device whose registry arrives after the start', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fake.memory.clear();
		fake.version = 0;
		fake.stores.pending.set(false);
		fake.stores.active.set({ kind: 'shared', name: 'three-words', address: '/orbitdb/shared' });
		listRegistryStore.set([]);
	});

	it('opens the old home list as soon as the registry names it, with nobody writing', async () => {
		const start = await openHomeList('Home');
		expect(start.pending).toBe(true);
		expect(get(fake.stores.pending)).toBe(true);

		listRegistryStore.set([ownerEntry]);
		await wait(50);

		expect(dbActions.loadTodoDatabase).toHaveBeenCalledWith(OLD_HOME, { unlessSwitchedSince: 0 });
		expect(get(fake.stores.active).address).toBe(OLD_HOME);
		expect(get(fake.stores.pending)).toBe(false);
		expect(fake.memory.get('simpleTodo.homeList.did:key:z-owner')).toBe(OLD_HOME);
		expect(dbActions.createPrivateTodoList).not.toHaveBeenCalled();
	});

	it('leaves a list opened meanwhile on screen', async () => {
		await openHomeList('Home');
		dbActions.openSomethingElse();
		listRegistryStore.set([ownerEntry]);
		await wait(50);

		expect(dbActions.loadTodoDatabase).not.toHaveBeenCalled();
		expect(get(fake.stores.active).address).toBe('/orbitdb/elsewhere');
	});

	it('puts a first todo written while the old list opens into that list, not a new one', async () => {
		await openHomeList('Home');
		listRegistryStore.set([ownerEntry]);
		// The first todo arrives before loadTodoDatabase has finished.
		const atFirstTodo = await openHomeList('Home', { create: true });

		expect(atFirstTodo.address).toBe(OLD_HOME);
		expect(atFirstTodo.created).toBe(false);
		expect(dbActions.createPrivateTodoList).not.toHaveBeenCalled();
		expect(dbActions.loadTodoDatabase).toHaveBeenCalledTimes(1);
	});

	it('still makes a new list at the first todo when the registry names none', async () => {
		await openHomeList('Home');
		const atFirstTodo = await openHomeList('Home', { create: true });

		expect(atFirstTodo.created).toBe(true);
		expect(atFirstTodo.address).toBe('/orbitdb/new-list');
		// The watch from the start is over: a registry entry now opens nothing.
		listRegistryStore.set([ownerEntry]);
		await wait(50);
		expect(dbActions.loadTodoDatabase).not.toHaveBeenCalled();
	});
});
