import { describe, expect, it } from 'vitest';
import { budgetErrorCode } from './budget.js';
import { createZamaBudgetService, wasCancelled } from './budget-service-zama.js';
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createAccountStore, parseRecord } from './chain/account-store.js';
import { parsePublished } from './chain/account-directory.js';
import {
	CHAIN_ID,
	ESCROW_ADDRESS,
	STARTING_FUNDS,
	TOKEN_ADDRESS,
	readChainEndpoints
} from './chain/config.js';

const ALICE = 'did:key:zAlice';
const BOB = 'did:key:zBob';
const MALLORY = 'did:key:zMallory';
const ZERO = `0x${'00'.repeat(32)}`;
const TODO_REF = `0x${'ab'.repeat(32)}`;
const address = (/** @type {string} */ tag) =>
	/** @type {`0x${string}`} */ (`0x${tag.repeat(40).slice(0, 40)}`);

/**
 * A chain in memory, shaped like sepolia-chain.js: accounts by DID, escrows by
 * creator and todoRef, balance handles, and a log of what was sent.
 */
function fakeChain() {
	/** @type {Map<string, string>} address → DID whose passkey is registered there */
	const passkeys = new Map();
	/** @type {Map<string, { beneficiary: string, deadline: bigint, status: string, amount: string }>} */
	const escrows = new Map();
	/** @type {Map<string, string>} */
	const balanceHandles = new Map();
	/** @type {Map<string, bigint>} handle → clear value */
	const clear = new Map();
	/** @type {Array<{ address: string, calls: any[] }>} */
	const sent = [];
	let nextAccount = 1;
	let nextHandle = 1;
	const state = {
		passkeys,
		escrows,
		balanceHandles,
		clear,
		sent,
		created: /** @type {string[]} */ ([]),
		cancelNext: false,
		/** What the next lock moves: the amount, or 0 for an underfunded one. */
		lockMoves: /** @type {'amount' | 'zero'} */ ('amount'),
		/** A node a block behind: reads of the latest block miss the last operation. */
		laggingNode: false,
		/** The next lock is mined, but no escrow comes of it. */
		dropNextLock: false,
		/** The amount the last `encryptAmount` was asked for. */
		pendingAmount: /** @type {bigint | undefined} */ (undefined),
		now: 1_900_000_000n
	};
	const newHandle = () => `0x${(nextHandle++).toString(16).padStart(64, '0')}`;

	const chain = {
		chainId: CHAIN_ID,
		descriptorFor: (/** @type {any} */ value) => (value ? { did: value.did ?? value } : null),
		blockTimestamp: async () => state.now,
		waitBlocks: async () => {},
		readEscrow: async (
			/** @type {string} */ creator,
			/** @type {string} */ todoRef,
			/** @type {{ blockNumber?: bigint }} */ { blockNumber } = {}
		) => {
			const none = { beneficiary: address('0'), deadline: 0n, status: 'none', amount: ZERO };
			if (state.laggingNode && blockNumber === undefined) return none;
			return escrows.get(`${creator}:${todoRef}`) ?? none;
		},
		balanceHandle: async (/** @type {string} */ account) => balanceHandles.get(account) ?? ZERO,
		isPasskeyAccount: async (
			/** @type {{ address: string, did: string }} */ { address: at, did }
		) => passkeys.get(at) === did,
		createAccount: async (/** @type {any} */ { descriptor }) => {
			const at = address(String(nextAccount++));
			passkeys.set(at, descriptor.did);
			state.created.push(at);
			return { address: at, setupTx: `0x${'5e'.repeat(32)}` };
		},
		sendWithPasskey: async (/** @type {any} */ { address: at, calls, onPrompt, onSigned }) => {
			onPrompt?.();
			if (state.cancelNext) {
				state.cancelNext = false;
				const cause = Object.assign(
					new Error('The operation either timed out or was not allowed.'),
					{
						name: 'NotAllowedError'
					}
				);
				throw Object.assign(new Error('Signing the user operation failed.'), { cause });
			}
			onSigned?.();
			sent.push({ address: at, calls });
			for (const call of calls) {
				if (call.kind === 'funding') {
					const handle = newHandle();
					balanceHandles.set(at, handle);
					clear.set(handle, call.amount);
				}
				if (call.kind === 'lock' && state.dropNextLock) {
					state.dropNextLock = false;
				} else if (call.kind === 'lock') {
					const handle = newHandle();
					clear.set(handle, state.lockMoves === 'amount' ? call.amount : 0n);
					escrows.set(`${at}:${call.todoRef}`, {
						beneficiary: call.beneficiary,
						deadline: call.deadline,
						status: 'locked',
						amount: handle
					});
				}
				if (call.kind === 'release') {
					const escrow = escrows.get(`${at}:${call.todoRef}`);
					if (escrow) escrow.status = 'released';
				}
			}
			return {
				success: true,
				txHash: `0x${String(sent.length).padStart(64, '0')}`,
				blockNumber: BigInt(sent.length)
			};
		},
		encryptAmount: async (/** @type {any} */ { amount }) => {
			state.pendingAmount = amount;
			return { handle: `0x${'e1'.repeat(32)}`, inputProof: '0x1234' };
		},
		decrypt: async (/** @type {any} */ { handles }) =>
			new Map(
				handles.map((/** @type {string} */ handle) => [
					handle.toLowerCase(),
					clear.get(handle) ?? 0n
				])
			),
		lockedEvents: async () => [],
		calls: {
			funding: (/** @type {string} */ account, /** @type {bigint} */ amount) => [
				{ kind: 'funding', account, amount, to: TOKEN_ADDRESS, data: '0x' }
			],
			lock: (/** @type {any} */ input) => [
				{ kind: 'operator', to: TOKEN_ADDRESS, data: '0x', until: input.operatorUntil },
				{
					kind: 'lock',
					to: ESCROW_ADDRESS,
					data: '0x',
					...input,
					amount: state.pendingAmount
				}
			],
			release: (/** @type {string} */ todoRef) => [
				{ kind: 'release', to: ESCROW_ADDRESS, data: '0x', todoRef }
			],
			readKey: (/** @type {any} */ input) => [
				{ kind: 'readKey', to: ESCROW_ADDRESS, data: '0x', ...input }
			]
		},
		sameAddress: (/** @type {string} */ a, /** @type {string} */ b) =>
			a.toLowerCase() === b.toLowerCase()
	};
	return { chain: /** @type {any} */ (chain), state: /** @type {any} */ (state) };
}

function fakeDirectory() {
	/** @type {Map<string, any>} */
	const entries = new Map();
	return {
		entries,
		directory: {
			publish: async (/** @type {string} */ did, /** @type {any} */ account) => {
				entries.set(did, { ...account, publishedAt: 'now' });
			},
			lookup: async (/** @type {string} */ did) => entries.get(did) ?? null
		}
	};
}

function memoryStorage() {
	const values = new Map();
	const storage = () => ({
		getItem: (/** @type {string} */ key) => values.get(key) ?? null,
		setItem: (/** @type {string} */ key, /** @type {string} */ value) =>
			void values.set(key, value),
		removeItem: (/** @type {string} */ key) => void values.delete(key)
	});
	return Object.assign(storage, { values });
}

/**
 * The passkey's PRF output, as one authenticator answers: the same 32 bytes for
 * the same passkey every time. `mode` stands in for a passkey without PRF, a
 * declined touch, or another passkey altogether.
 *
 * @param {string} did
 */
function fakePrf(did) {
	const control = {
		/** @type {'answer' | 'none' | 'cancel' | 'other'} */
		mode: 'answer',
		asked: 0,
		async read() {
			control.asked += 1;
			if (control.mode === 'none') return null;
			if (control.mode === 'cancel') {
				throw Object.assign(new Error('The operation either timed out or was not allowed.'), {
					name: 'NotAllowedError'
				});
			}
			const tag = control.mode === 'other' ? `${did}:another passkey` : did;
			return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tag)));
		}
	};
	return control;
}

/** Alice and Bob on one fake chain, each with a service of their own. */
function world() {
	const { chain, state } = fakeChain();
	const { directory, entries } = fakeDirectory();
	/**
	 * A session of `did`. Pass the `storage` of an earlier one for the same
	 * browser after a reload: what was stored stays, what was in memory is gone.
	 *
	 * @param {string} did
	 * @param {{ storage?: ReturnType<typeof memoryStorage>, prf?: ReturnType<typeof fakePrf> }} [options]
	 */
	const serviceFor = (did, { storage = memoryStorage(), prf = fakePrf(did) } = {}) => {
		/** @type {string[]} */
		const prompts = [];
		const accounts = createAccountStore(storage);
		const service = createZamaBudgetService({
			identity: () => did,
			credential: () => ({ did }),
			chain,
			directory,
			accounts,
			prompt: (action, run) => {
				prompts.push(action);
				return run({ onPrompt: () => {}, onSigned: () => {} });
			},
			lookupTimeoutMs: 0,
			readSealingSeed: () => prf.read()
		});
		return { service, prompts, accounts, storage, prf };
	};
	return { chain, state, entries, alice: serviceFor(ALICE), bob: serviceFor(BOB), serviceFor };
}

/** Everything a browser keeps for its accounts, as text. */
const storedText = (/** @type {ReturnType<typeof memoryStorage>} */ storage) =>
	[...storage.values.values()].join('\n');

/** @param {Promise<unknown>} promise */
async function codeOf(promise) {
	try {
		await promise;
	} catch (error) {
		return budgetErrorCode(error);
	}
	return 'resolved';
}

describe('the Sepolia budget service', () => {
	it('sets up an account without a chain prompt, seals its read key with one touch, and publishes it', async () => {
		const w = world();
		await w.bob.service.prepareAccount();

		expect(w.state.created).toHaveLength(1);
		// No user operation to sign: only the touch that derives the sealing key.
		expect(w.bob.prompts).toEqual(['budget-read-seal']);
		expect(w.bob.accounts.load(BOB, CHAIN_ID)?.session?.sealed?.algorithm).toBe('AES-GCM');
		expect(w.entries.get(BOB)?.address).toBe(w.state.created[0]);
		// A second start finds it and creates nothing.
		await w.bob.service.prepareAccount();
		expect(w.state.created).toHaveLength(1);
	});

	it('derives a fresh todoRef for every lock, as sha256 of the todo key and a hex salt', async () => {
		const w = world();
		const first = await w.alice.service.createTodoRef({ todoKey: 'todo_1' });
		const second = await w.alice.service.createTodoRef({ todoKey: 'todo_1' });
		expect(first).toMatch(/^0x[0-9a-f]{64}$/);
		expect(second).toMatch(/^0x[0-9a-f]{64}$/);
		expect(second).not.toBe(first);
	});

	it('locks with one prompt, funding the account in the same operation the first time', async () => {
		const w = world();
		await w.bob.service.prepareAccount();

		const result = await w.alice.service.lock({
			todoRef: TODO_REF,
			beneficiaryDid: BOB,
			amount: 500_000_000n,
			deadline: null
		});

		// The seal belongs to setting up Alice's account; the lock itself is one prompt.
		expect(w.alice.prompts).toEqual(['budget-read-seal', 'budget-lock']);
		expect(w.state.sent).toHaveLength(1);
		expect(w.state.sent[0].calls.map((/** @type {any} */ call) => call.kind)).toEqual([
			'funding',
			'operator',
			'lock'
		]);
		expect(w.state.sent[0].calls[0].amount).toBe(STARTING_FUNDS);
		expect(result.lockTx).toMatch(/^0x[0-9a-f]{64}$/);

		// The second lock does not fund again.
		await w.alice.service.lock({
			todoRef: `0x${'cd'.repeat(32)}`,
			beneficiaryDid: BOB,
			amount: 1n,
			deadline: null
		});
		expect(w.state.sent[1].calls.map((/** @type {any} */ call) => call.kind)).toEqual([
			'operator',
			'lock'
		]);
	});

	it('refuses a delegate who has published no account, before anything is signed', async () => {
		const w = world();
		expect(
			await codeOf(
				w.alice.service.lock({ todoRef: TODO_REF, beneficiaryDid: BOB, amount: 1n, deadline: null })
			)
		).toBe('beneficiary-without-account');
		expect(w.alice.prompts).toEqual([]);
	});

	it('refuses an account published for a DID whose passkey is not registered in it', async () => {
		const w = world();
		await w.serviceFor(MALLORY).service.prepareAccount();
		// Mallory's account, published under Bob's DID.
		w.entries.set(BOB, { ...w.entries.get(MALLORY) });
		expect(
			await codeOf(
				w.alice.service.lock({ todoRef: TODO_REF, beneficiaryDid: BOB, amount: 1n, deadline: null })
			)
		).toBe('beneficiary-without-account');
	});

	it('reports an underfunded lock after reading back the encrypted 0 that arrived', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		w.state.lockMoves = 'zero';
		let error;
		try {
			await w.alice.service.lock({
				todoRef: TODO_REF,
				beneficiaryDid: BOB,
				amount: 5n,
				deadline: null
			});
		} catch (caught) {
			error = /** @type {any} */ (caught);
		}
		expect(budgetErrorCode(error)).toBe('insufficient-balance');
		expect(error.details.lockTx).toMatch(/^0x/);
	});

	it("reads the new escrow at the lock's block, so a lagging node cannot pass for an empty lock", async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		w.state.laggingNode = true;

		const result = await w.alice.service.lock({
			todoRef: TODO_REF,
			beneficiaryDid: BOB,
			amount: 5n,
			deadline: null
		});

		expect(result.lockTx).toMatch(/^0x/);
		w.state.laggingNode = false;
		expect(await w.alice.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE })).toBe(5n);
	});

	it('does not call a mined lock underfunded when the chain shows no escrow for it', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		w.state.dropNextLock = true;
		let error;
		try {
			await w.alice.service.lock({
				todoRef: TODO_REF,
				beneficiaryDid: BOB,
				amount: 5n,
				deadline: null
			});
		} catch (caught) {
			error = /** @type {any} */ (caught);
		}
		expect(budgetErrorCode(error)).toBe('unknown');
		expect(error.details.lockTx).toMatch(/^0x/);
	});

	it('says passkey-cancelled when the WebAuthn prompt was dismissed', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		w.state.cancelNext = true;
		expect(
			await codeOf(
				w.alice.service.lock({ todoRef: TODO_REF, beneficiaryDid: BOB, amount: 1n, deadline: null })
			)
		).toBe('passkey-cancelled');
		expect(w.state.sent).toHaveLength(0);
	});

	it('validates amount, beneficiary and deadline before touching the chain', async () => {
		const w = world();
		const lock = (/** @type {any} */ input) =>
			codeOf(
				w.alice.service.lock({
					todoRef: TODO_REF,
					beneficiaryDid: BOB,
					amount: 1n,
					deadline: null,
					...input
				})
			);
		expect(await lock({ amount: 0n })).toBe('invalid-amount');
		expect(await lock({ amount: 1n << 64n })).toBe('invalid-amount');
		expect(await lock({ beneficiaryDid: ALICE })).toBe('invalid-beneficiary');
		await w.bob.service.prepareAccount();
		expect(await lock({ deadline: new Date(0).toISOString() })).toBe('invalid-deadline');
		expect(w.state.created).toHaveLength(2);
		expect(w.state.sent).toHaveLength(0);
	});

	it('lets creator and beneficiary read the amount, and nobody else', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		await w.alice.service.lock({
			todoRef: TODO_REF,
			beneficiaryDid: BOB,
			amount: 42n,
			deadline: null
		});

		expect(await w.alice.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE })).toBe(42n);
		expect(await w.bob.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE })).toBe(42n);
		const mallory = w.serviceFor(MALLORY);
		expect(
			await codeOf(mallory.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE }))
		).toBe('not-allowed');
		expect(
			await codeOf(
				w.bob.service.decryptAmount({ todoRef: `0x${'99'.repeat(32)}`, creatorDid: ALICE })
			)
		).toBe('escrow-not-found');
	});

	it('releases only a locked escrow of its own', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		expect(await codeOf(w.alice.service.release({ todoRef: TODO_REF }))).toBe('escrow-not-found');
		await w.alice.service.lock({
			todoRef: TODO_REF,
			beneficiaryDid: BOB,
			amount: 7n,
			deadline: null
		});

		const { releaseTx } = await w.alice.service.release({ todoRef: TODO_REF });
		expect(releaseTx).toMatch(/^0x/);
		expect(w.alice.prompts).toEqual(['budget-read-seal', 'budget-lock', 'budget-release']);
		expect(await codeOf(w.alice.service.release({ todoRef: TODO_REF }))).toBe('escrow-closed');
		// Bob has no escrow under that todoRef: releasing is the creator's.
		expect(await codeOf(w.bob.service.release({ todoRef: TODO_REF }))).toBe('escrow-not-found');
	});

	it('stops reading once the read key has expired, and a renewal brings it back', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		await w.alice.service.lock({
			todoRef: TODO_REF,
			beneficiaryDid: BOB,
			amount: 3n,
			deadline: null
		});

		const record = /** @type {import('./chain/account-store.js').ChainAccountRecord} */ (
			w.bob.accounts.load(BOB, CHAIN_ID)
		);
		w.bob.accounts.save(BOB, { ...record, readKeyExpiresAt: 1 });
		expect((await w.bob.service.readKeyStatus()).state).toBe('expired');
		expect(
			await codeOf(w.bob.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE }))
		).toBe('read-access-expired');

		const renewed = await w.bob.service.renewReadKey();
		expect(renewed.state).toBe('valid');
		// The sealing key from setting up is still in this session: no second touch.
		expect(w.bob.prompts).toEqual(['budget-read-seal', 'budget-read-key']);
		expect(w.bob.accounts.load(BOB, CHAIN_ID)?.session?.address).not.toBe(record?.session?.address);
		expect(await w.bob.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE })).toBe(3n);
	});

	it('reads a balance of 0 for an account that never held the token', async () => {
		const w = world();
		expect(await w.bob.service.balance()).toBe(0n);
	});

	it('takes over an account another device created, without a read key yet', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		// The same passkey on a second browser: nothing stored there.
		const second = w.serviceFor(BOB);
		await second.service.prepareAccount();

		expect(w.state.created).toHaveLength(1);
		expect(second.accounts.load(BOB, CHAIN_ID)?.address).toBe(w.state.created[0]);
		expect((await second.service.readKeyStatus()).state).toBe('missing');
	});

	it('shows the auditor escrows without amounts to anyone but the auditor', async () => {
		const w = world();
		w.chain.lockedEvents = async () => [
			{
				creator: address('1'),
				todoRef: TODO_REF,
				beneficiary: address('2'),
				deadline: 2n,
				lockedAt: 1n
			}
		];
		w.state.escrows.set(`${address('1')}:${TODO_REF}`, {
			beneficiary: address('2'),
			deadline: 2n,
			status: 'released',
			amount: `0x${'77'.repeat(32)}`
		});
		const rows = await w.alice.service.listEscrowsForAuditor();
		expect(rows).toHaveLength(1);
		expect(rows[0].amount).toBeNull();
		expect(rows[0].status).toBe('released');
	});

	it('refuses to act without a passkey identity', async () => {
		const { chain } = fakeChain();
		const { directory } = fakeDirectory();
		const service = createZamaBudgetService({
			identity: () => '03ab…', // an anonymous OrbitDB identity is a public key, not a DID
			credential: () => null,
			chain,
			directory: /** @type {any} */ (directory),
			accounts: createAccountStore(memoryStorage())
		});
		expect(await codeOf(service.balance())).toBe('not-allowed');
		// Asking whether a read key exists is not acting: no error before sign-in.
		expect(await service.readKeyStatus()).toEqual({ state: 'missing', expiresAt: null });
	});
});

describe('the sealed read key', () => {
	it('is stored only sealed, and after a reload reads stop without asking until it is opened', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		await w.alice.service.lock({
			todoRef: TODO_REF,
			beneficiaryDid: BOB,
			amount: 5n,
			deadline: null
		});

		// Nothing in storage that could sign: the session is an address and a seal.
		expect(storedText(w.bob.storage)).not.toMatch(/privateKey/i);
		const stored = JSON.parse(storedText(w.bob.storage));
		expect(Object.keys(stored.session).sort()).toEqual(['address', 'sealed']);
		expect(Object.keys(stored.session.sealed).sort()).toEqual([
			'address',
			'algorithm',
			'ciphertext',
			'iv',
			'version'
		]);

		// The same browser, reloaded: the record is there, the open key is not.
		const reloaded = w.serviceFor(BOB, { storage: w.bob.storage });
		expect((await reloaded.service.readKeyStatus()).state).toBe('locked');
		expect(await codeOf(reloaded.service.balance())).toBe('read-access-locked');
		expect(
			await codeOf(reloaded.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE }))
		).toBe('read-access-locked');
		expect(reloaded.prompts).toEqual([]);

		const opened = await reloaded.service.unlockReadKey();
		expect(opened.state).toBe('valid');
		expect(reloaded.prompts).toEqual(['budget-read-unlock']);
		expect(await reloaded.service.decryptAmount({ todoRef: TODO_REF, creatorDid: ALICE })).toBe(5n);
		// Opened once per session: a second unlock asks nothing.
		await reloaded.service.unlockReadKey();
		expect(reloaded.prompts).toEqual(['budget-read-unlock']);
	});

	it('opens a sealed read key for a lock, with one touch before the lock itself', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		await w.alice.service.prepareAccount();

		const reloaded = w.serviceFor(ALICE, { storage: w.alice.storage });
		await reloaded.service.lock({
			todoRef: TODO_REF,
			beneficiaryDid: BOB,
			amount: 2n,
			deadline: null
		});
		expect(reloaded.prompts).toEqual(['budget-read-unlock', 'budget-lock']);
	});

	it('asks for the sealing key once per session, at the first renewal that needs it', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		const record = /** @type {any} */ (w.bob.accounts.load(BOB, CHAIN_ID));
		w.bob.accounts.save(BOB, { ...record, readKeyExpiresAt: 1 });

		const reloaded = w.serviceFor(BOB, { storage: w.bob.storage });
		expect((await reloaded.service.readKeyStatus()).state).toBe('expired');
		await reloaded.service.renewReadKey();
		await reloaded.service.renewReadKey();
		expect(reloaded.prompts).toEqual(['budget-read-seal', 'budget-read-key', 'budget-read-key']);
		expect(reloaded.accounts.load(BOB, CHAIN_ID)?.session?.sealed).not.toBeNull();
	});

	it('sends nothing when the seal touch of a renewal is declined', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		const reloaded = w.serviceFor(BOB, { storage: w.bob.storage });
		reloaded.prf.mode = 'cancel';
		const sentBefore = w.state.sent.length;

		expect(await codeOf(reloaded.service.renewReadKey())).toBe('passkey-cancelled');
		expect(w.state.sent).toHaveLength(sentBefore);
		expect(reloaded.prompts).toEqual(['budget-read-seal']);
	});

	it('keeps a read key for the session only when the passkey has no PRF', async () => {
		const w = world();
		const prf = fakePrf(BOB);
		prf.mode = 'none';
		const bob = w.serviceFor(BOB, { prf });
		await bob.service.prepareAccount();

		// The account stands, and this session reads.
		expect(w.state.created).toHaveLength(1);
		expect((await bob.service.readKeyStatus()).state).toBe('valid');
		expect(bob.accounts.load(BOB, CHAIN_ID)?.session?.sealed).toBeNull();
		// A renewal still works, for this session too.
		expect((await bob.service.renewReadKey()).state).toBe('valid');

		const reloaded = w.serviceFor(BOB, { storage: bob.storage, prf });
		expect((await reloaded.service.readKeyStatus()).state).toBe('missing');
	});

	it('keeps the account when the seal touch at setup is declined', async () => {
		const w = world();
		const prf = fakePrf(BOB);
		prf.mode = 'cancel';
		const bob = w.serviceFor(BOB, { prf });
		await bob.service.prepareAccount();

		expect(w.state.created).toHaveLength(1);
		expect((await bob.service.readKeyStatus()).state).toBe('valid');
		const reloaded = w.serviceFor(BOB, { storage: bob.storage });
		expect((await reloaded.service.readKeyStatus()).state).toBe('missing');
	});

	it('drops a seal that does not open, so a renewal is offered instead of the same button', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		const prf = fakePrf(BOB);
		prf.mode = 'other';
		const reloaded = w.serviceFor(BOB, { storage: w.bob.storage, prf });

		expect(await codeOf(reloaded.service.unlockReadKey())).toBe('read-access-expired');
		expect((await reloaded.service.readKeyStatus()).state).toBe('missing');
		prf.mode = 'answer';
		expect((await reloaded.service.renewReadKey()).state).toBe('valid');
	});

	it('shares one passkey prompt between two opens at the same time', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		const reloaded = w.serviceFor(BOB, { storage: w.bob.storage });

		const [first, second] = await Promise.all([
			reloaded.service.unlockReadKey(),
			reloaded.service.unlockReadKey()
		]);
		expect(first.state).toBe('valid');
		expect(second.state).toBe('valid');
		expect(reloaded.prf.asked).toBe(1);
		expect(reloaded.prompts).toEqual(['budget-read-unlock']);
	});

	it('takes a plain key from before the seal over once, and removes it from storage', async () => {
		const w = world();
		await w.bob.service.prepareAccount();
		const record = /** @type {any} */ (w.bob.accounts.load(BOB, CHAIN_ID));
		// A record as the app wrote it before: the read key in plain text.
		const plain = `0x${'11'.repeat(32)}`;
		const plainAddress = privateKeyToAccount(/** @type {`0x${string}`} */ (plain)).address;
		w.bob.storage().setItem(
			`simpleTodo.chainAccount.v1.${BOB}`,
			JSON.stringify({
				...record,
				session: { address: plainAddress, privateKey: plain }
			})
		);

		const updated = w.serviceFor(BOB, { storage: w.bob.storage });
		expect((await updated.service.readKeyStatus()).state).toBe('valid');
		expect(storedText(w.bob.storage)).not.toContain(plain.slice(2));
		expect(updated.prompts).toEqual([]);

		const next = w.serviceFor(BOB, { storage: w.bob.storage });
		expect((await next.service.readKeyStatus()).state).toBe('missing');
	});
});

describe('the stored account record', () => {
	const sealed = {
		version: 1,
		algorithm: 'AES-GCM',
		address: address('c'),
		iv: `0x${'01'.repeat(12)}`,
		ciphertext: `0x${'02'.repeat(48)}`
	};
	const base = { chainId: CHAIN_ID, address: address('a'), readKeyExpiresAt: 5, createdAt: 'x' };

	it('reads a sealed read key, and refuses one sealed for another address or malformed', () => {
		const good = parseRecord({ ...base, session: { address: address('c'), sealed } }, CHAIN_ID);
		expect(good?.session?.sealed?.ciphertext).toBe(sealed.ciphertext);
		expect(good?.readKeyExpiresAt).toBe(5);
		expect(
			parseRecord({ ...base, session: { address: address('d'), sealed } }, CHAIN_ID)?.session
		).toBeNull();
		expect(
			parseRecord(
				{ ...base, session: { address: address('c'), sealed: { ...sealed, iv: '0x01' } } },
				CHAIN_ID
			)?.session
		).toBeNull();
	});

	it('hands a plain key over as legacyPrivateKey, and never writes one', () => {
		const plain = `0x${'22'.repeat(32)}`;
		const legacy = parseRecord(
			{ ...base, session: { address: address('c'), privateKey: plain } },
			CHAIN_ID
		);
		expect(legacy?.legacyPrivateKey).toBe(plain);
		expect(legacy?.session).toEqual({ address: getAddress(address('c')), sealed: null });

		const storage = memoryStorage();
		const store = createAccountStore(storage);
		store.save(ALICE, /** @type {any} */ ({ ...legacy, extra: plain }));
		expect(storedText(storage)).not.toContain(plain.slice(2));
		expect(store.load(ALICE, CHAIN_ID)?.session).toEqual({
			address: getAddress(address('c')),
			sealed: null
		});
	});
});

describe('what the Sepolia service reads from outside', () => {
	it('recognises a cancelled prompt anywhere in the cause chain', () => {
		const notAllowed = Object.assign(new Error('x'), { name: 'NotAllowedError' });
		expect(
			wasCancelled(new Error('outer', { cause: new Error('mid', { cause: notAllowed }) }))
		).toBe(true);
		expect(wasCancelled(new Error('Passkey authentication was cancelled or not allowed'))).toBe(
			true
		);
		expect(wasCancelled(new Error('insufficient funds'))).toBe(false);
	});

	it('takes the bundler endpoint from the environment, and never a secret key', () => {
		const ok = readChainEndpoints({
			VITE_BUNDLER_URL: 'https://api.openfort.io/rpc/11155111',
			VITE_BUNDLER_AUTH_HEADER: 'Authorization: Bearer pk_test_abc',
			VITE_OPENFORT_POLICY_ID: 'pol_1'
		});
		expect(ok.ok && ok.endpoints.authorization).toBe('Bearer pk_test_abc');
		expect(ok.ok && ok.endpoints.policyId).toBe('pol_1');

		const secret = readChainEndpoints({
			VITE_BUNDLER_URL: 'https://api.openfort.io/rpc/11155111',
			VITE_BUNDLER_AUTH_HEADER: 'sk_test_abc'
		});
		expect(secret.ok).toBe(false);
		expect(
			readChainEndpoints({ VITE_BUNDLER_URL: 'http://x', VITE_BUNDLER_AUTH_HEADER: 'pk_test' }).ok
		).toBe(false);
		expect(readChainEndpoints({}).ok).toBe(false);
	});

	it('ignores stored accounts and published entries for another chain or of the wrong shape', () => {
		const good = { chainId: CHAIN_ID, address: address('a'), createdAt: 'x' };
		expect(parseRecord(good, CHAIN_ID)?.session).toBeNull();
		expect(parseRecord({ ...good, chainId: 1 }, CHAIN_ID)).toBeNull();
		expect(parseRecord({ ...good, address: 'nope' }, CHAIN_ID)).toBeNull();
		expect(parsePublished({ chainId: CHAIN_ID, address: address('b') }, CHAIN_ID)?.address).toMatch(
			/^0x/
		);
		expect(parsePublished({ chainId: 1, address: address('b') }, CHAIN_ID)).toBeNull();
		expect(parsePublished('0xabc', CHAIN_ID)).toBeNull();
	});
});
