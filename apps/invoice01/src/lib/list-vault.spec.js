import { forget, recall } from '@simple-todo/todo/browser-memory.js';
import { beforeEach, describe, expect, it } from 'vitest';

import {
	VAULTS_STORAGE_KEY,
	addListPasskey,
	listEncryption,
	listVaultStore,
	openListVault,
	removeListPasskey,
	setVaultCredential,
	vaultRegistryAddress,
	vaultStatus
} from './list-vault.js';
import { get } from 'svelte/store';

// Two passkeys with printed PRF outputs: nothing here is secret, and a run
// that touched an authenticator would not be a unit test. The new passkey's
// output is handed over as a copy, because the vault wipes it once used.
const prfA = Uint8Array.from({ length: 32 }, (_, i) => i);
const prfB = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const credentialA = () => ({ rawCredentialId: new Uint8Array(16).fill(0xaa), displayName: 'A' });
const credentialB = () => ({ rawCredentialId: new Uint8Array(16).fill(0xbb), displayName: 'B' });
const REGISTRY = '/orbitdb/zdpuAregistryOfTheFoundingPasskey';

/** The bytes OrbitDB would hand `encrypt`, and get back from `decrypt`. */
const entry = new TextEncoder().encode('{"op":"PUT","key":"todo-1"}');

/** Seal with one session's key, open with another's. */
async function sealed() {
	const { data } = await listEncryption();
	return data.encrypt(entry);
}

describe('list-vault', () => {
	beforeEach(() => {
		forget(VAULTS_STORAGE_KEY);
		setVaultCredential(null);
	});

	it('makes no vault without a registry to name, and asks nothing to say so', async () => {
		setVaultCredential(credentialA());
		expect(await vaultStatus()).toEqual({ here: false, removed: false });
		await expect(openListVault({ prfOutput: prfA })).rejects.toMatchObject({
			code: 'VAULT_NO_SLOT'
		});
		expect(recall(VAULTS_STORAGE_KEY)).toBeNull();
	});

	it('makes a vault that names the registry and holds the passkey as its first slot', async () => {
		setVaultCredential(credentialA());
		const opened = await openListVault({ prfOutput: prfA, registry: REGISTRY });

		expect(opened.created).toBe(true);
		expect(vaultRegistryAddress()).toBe(REGISTRY);
		expect(await vaultStatus()).toEqual({ here: true, removed: false });
		expect(get(listVaultStore)?.slots).toEqual([
			expect.objectContaining({ label: 'A', mine: true })
		]);
	});

	it('gives the founding passkey its key back on a device that kept nothing', async () => {
		setVaultCredential(credentialA());
		await openListVault({ prfOutput: prfA, registry: REGISTRY });
		const bytes = await sealed();

		// Everything this browser kept, gone: a new vault, with the same root.
		forget(VAULTS_STORAGE_KEY);
		setVaultCredential(credentialA());
		const again = await openListVault({ prfOutput: prfA, registry: REGISTRY });
		expect(again.created).toBe(true);

		const { data } = await listEncryption();
		expect(Array.from(await data.decrypt(bytes))).toEqual(Array.from(entry));
	});

	it('lets a second passkey open what the first sealed, and find its registry', async () => {
		setVaultCredential(credentialA());
		await openListVault({ prfOutput: prfA, registry: REGISTRY });
		const bytes = await sealed();
		await addListPasskey(async () => credentialB(), 'B', { readPrf: async () => prfB.slice() });
		expect(get(listVaultStore)?.slots.map((s) => s.label)).toEqual(['A', 'B']);

		setVaultCredential(credentialB());
		const opened = await openListVault({ prfOutput: prfB });
		expect(opened.created).toBe(false);
		expect(vaultRegistryAddress()).toBe(REGISTRY);
		const { data } = await listEncryption();
		expect(Array.from(await data.decrypt(bytes))).toEqual(Array.from(entry));
	});

	it('refuses a passkey taken out, rather than giving it empty lists', async () => {
		setVaultCredential(credentialA());
		await openListVault({ prfOutput: prfA, registry: REGISTRY });
		await addListPasskey(async () => credentialB(), 'B', { readPrf: async () => prfB.slice() });
		const kidB = get(listVaultStore)?.slots.find((s) => s.label === 'B')?.kid ?? '';
		await removeListPasskey(kidB);

		setVaultCredential(credentialB());
		expect(await vaultStatus()).toEqual({ here: false, removed: true });
		// Even with a registry to name, which would make a vault for anybody new.
		await expect(openListVault({ prfOutput: prfB, registry: REGISTRY })).rejects.toMatchObject({
			code: 'VAULT_SLOT_REMOVED'
		});
	});

	it('does not let the passkey in use remove itself', async () => {
		setVaultCredential(credentialA());
		await openListVault({ prfOutput: prfA, registry: REGISTRY });
		const own = get(listVaultStore)?.slots[0].kid ?? '';
		await expect(removeListPasskey(own)).rejects.toMatchObject({ code: 'VAULT_SLOT_IN_USE' });
	});

	it('passes over entries written before the list was sealed', async () => {
		setVaultCredential(credentialA());
		await openListVault({ prfOutput: prfA, registry: REGISTRY });
		const { data } = await listEncryption();
		// An entry from before: OrbitDB hands `decrypt` the decoded value.
		const plain = await data.decrypt({ op: 'PUT', key: 'old' });
		expect(plain).toBeInstanceOf(Uint8Array);
	});

	it('closes the vault when another passkey takes over the session', async () => {
		setVaultCredential(credentialA());
		await openListVault({ prfOutput: prfA, registry: REGISTRY });
		setVaultCredential(credentialB());
		expect(get(listVaultStore)).toBeNull();
		expect(vaultRegistryAddress()).toBe('');
		expect(() => listEncryption()).toThrow();
	});
});
