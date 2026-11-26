/**
 * What the Sepolia adapter asks of `@le-space/passkey-wallet` 0.3.0: its cost
 * limit, its gas ceilings, and one user operation per account at a time.
 *
 * The client, the bundler and the passkey are stand-ins; the wallet is the
 * real one, so its checks decide. The gas figures are escrow01's own on
 * Sepolia, as Openfort estimated them (config.js says where they come from).
 */

import { describe, expect, it } from 'vitest';
import { createPublicClient, custom, encodeAbiParameters, parseGwei } from 'viem';
import { sepolia } from 'viem/chains';
import { createSepoliaChain } from './sepolia-chain.js';
import { CHAIN_ID, MAX_USER_OPERATION_COST } from './config.js';

const ACCOUNT = /** @type {`0x${string}`} */ ('0x7018eFcc4e6cf52Bc805857D2A17DAcE86E4750A');
const PAYMASTER = /** @type {`0x${string}`} */ ('0x8888fee873E7035789Db91C16b5dDDbad7214CDa');
const HASH = /** @type {`0x${string}`} */ (`0x${'aa'.repeat(32)}`);

/** The P-256 generator point: a valid public key, and nobody's. */
const DESCRIPTOR = {
	x: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
	y: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
	rawCredentialId: new Uint8Array([1, 2, 3, 4]),
	rpId: 'localhost'
};

/** @param {number} value 32 bytes, big-endian */
const word = (value) => Object.assign(new Uint8Array(32), { [31]: value });

/**
 * The parts of an assertion, as `signP256Challenge` returns them; enough for
 * `encodeWebAuthnAuth`, not for Calibur.
 *
 * @type {import('@le-space/orbitdb-identity-provider-webauthn-did/standalone').P256ChallengeSignature}
 */
const ASSERTION = {
	authenticatorData: new Uint8Array(37),
	clientDataJSON: '{"type":"webauthn.get","challenge":"x"}',
	challengeIndex: 23,
	typeIndex: 1,
	r: word(1),
	s: word(1)
};

const ENDPOINTS = {
	bundlerUrl: 'https://bundler.invalid',
	authorization: 'Bearer pk_test',
	policyId: null,
	rpcUrls: ['https://rpc.invalid'],
	explorerApi: null
};

/**
 * A user operation as viem hands it to `signUserOperation`.
 *
 * @param {Record<string, unknown>} gas
 */
function userOperation(gas) {
	return {
		chainId: CHAIN_ID,
		sender: ACCOUNT,
		nonce: 0n,
		callData: /** @type {`0x${string}`} */ ('0x'),
		paymaster: PAYMASTER,
		paymasterData: /** @type {`0x${string}`} */ ('0x'),
		paymasterVerificationGasLimit: 100_000n,
		paymasterPostOpGasLimit: 200_000n,
		maxFeePerGas: parseGwei('1.21'),
		maxPriorityFeePerGas: parseGwei('1.21'),
		signature: /** @type {`0x${string}`} */ ('0x'),
		...gas
	};
}

/** The setups of 2026-11-25. */
const SETUP = {
	factory: '0x7702',
	factoryData: '0x',
	preVerificationGas: 317_856n,
	verificationGasLimit: 180_238n,
	callGasLimit: 1_379_526n
};
/** A first lock, with the account's funding in the same operation: the dearest one sent. */
const FIRST_LOCK = {
	preVerificationGas: 72_894n,
	verificationGasLimit: 800_000n,
	callGasLimit: 2_958_629n
};
/** A read-key renewal of 2026-11-24: the most preVerificationGas a passkey operation carried. */
const RENEWAL = {
	preVerificationGas: 137_608n,
	verificationGasLimit: 800_000n,
	callGasLimit: 275_767n
};

/**
 * A chain client that answers what the wallet reads: the chain, the setup
 * EOA's transaction count, and `EntryPoint.getNonce` as `nonce()` says.
 *
 * @param {{ nonce?: () => bigint }} [options]
 */
function fakeClient({ nonce = () => 0n } = {}) {
	return createPublicClient({
		chain: sepolia,
		transport: custom(
			{
				async request({ method }) {
					if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
					if (method === 'eth_getTransactionCount') return '0x0';
					if (method === 'eth_call') return encodeAbiParameters([{ type: 'uint256' }], [nonce()]);
					throw new Error(`The fake client does not answer ${method}`);
				}
			},
			{ retryCount: 0 }
		)
	});
}

/**
 * A bundler that has the account sign `operation` (plus the nonce it was
 * given), and answers with a receipt once `include` resolves.
 *
 * @param {{ operation: Record<string, unknown>, include?: () => Promise<{ success: boolean, nonce: bigint }> }} options
 */
function fakeBundler({ operation, include }) {
	/** @type {Array<{ nonce: bigint | undefined, signed: boolean }>} */
	const sent = [];
	const bundler = {
		/** @param {any} parameters */
		async sendUserOperation({ account, nonce, authorization }) {
			const entry = { nonce, signed: false };
			sent.push(entry);
			await account.signUserOperation({
				...userOperation(operation),
				...(nonce === undefined ? {} : { nonce }),
				...(authorization ? { authorization } : {})
			});
			entry.signed = true;
			return HASH;
		},
		async waitForUserOperationReceipt() {
			const { success, nonce } = include ? await include() : { success: false, nonce: 0n };
			return { success, nonce, receipt: { transactionHash: HASH, blockNumber: 1n } };
		}
	};
	return { bundler, sent };
}

/**
 * The passkey: counts its prompts and returns a well-formed assertion.
 */
function fakePasskey() {
	const passkey = {
		asked: 0,
		signChallenge: async () => {
			passkey.asked += 1;
			return ASSERTION;
		}
	};
	return passkey;
}

/** @param {Promise<unknown>} promise */
async function failure(promise) {
	try {
		await promise;
	} catch (error) {
		return /** @type {any} */ (error);
	}
	throw new Error('expected a rejection');
}

describe('the account setup on wallet 0.3.0', () => {
	const setupInput = {
		descriptor: DESCRIPTOR,
		sessionAddress: ACCOUNT,
		readUntil: 1_900_000_000n
	};

	it("signs a setup of the size Openfort estimates, over the wallet's own Sepolia ceiling", async () => {
		const { bundler, sent } = fakeBundler({ operation: SETUP });
		const chain = createSepoliaChain({ endpoints: ENDPOINTS, client: fakeClient(), bundler });
		// The stand-in's receipt says it reverted, which ends the setup there.
		const error = await failure(chain.createAccount(setupInput));
		expect(error.message).toMatch(/did not register the passkey/);
		expect(sent).toEqual([{ nonce: undefined, signed: true }]);
	});

	it('refuses a setup whose preVerificationGas is past the raised ceiling, before signing', async () => {
		const { bundler, sent } = fakeBundler({
			operation: { ...SETUP, preVerificationGas: 500_001n }
		});
		const chain = createSepoliaChain({ endpoints: ENDPOINTS, client: fakeClient(), bundler });
		const error = await failure(chain.createAccount(setupInput));
		expect(error.name).toBe('UserOperationLimitError');
		expect(error.field).toBe('preVerificationGas');
		expect(sent[0].signed).toBe(false);
	});
});

describe('a user operation the passkey signs, on wallet 0.3.0', () => {
	/** @param {Record<string, unknown>} operation */
	function send(operation) {
		const passkey = fakePasskey();
		const prompts = { shown: 0, signed: 0 };
		const { bundler, sent } = fakeBundler({
			operation,
			include: async () => ({ success: true, nonce: 0n })
		});
		const chain = createSepoliaChain({
			endpoints: ENDPOINTS,
			client: fakeClient(),
			bundler,
			signChallenge: passkey.signChallenge
		});
		const result = chain.sendWithPasskey({
			address: ACCOUNT,
			descriptor: DESCRIPTOR,
			calls: [],
			onPrompt: () => (prompts.shown += 1),
			onSigned: () => (prompts.signed += 1)
		});
		return { result, passkey, prompts, sent };
	}

	it('signs the dearest operation escrow01 has sent, with one prompt', async () => {
		const { result, passkey, prompts } = send(FIRST_LOCK);
		expect(await result).toMatchObject({ success: true, txHash: HASH, nonce: 0n });
		expect(passkey.asked).toBe(1);
		expect(prompts).toEqual({ shown: 1, signed: 1 });
	});

	it('signs the most preVerificationGas a passkey operation has carried', async () => {
		const { result, passkey } = send(RENEWAL);
		expect((await result).success).toBe(true);
		expect(passkey.asked).toBe(1);
	});

	it('refuses an operation dearer than MAX_USER_OPERATION_COST, and never shows the prompt', async () => {
		const gas =
			FIRST_LOCK.preVerificationGas +
			FIRST_LOCK.verificationGasLimit +
			FIRST_LOCK.callGasLimit +
			300_000n;
		const fee = MAX_USER_OPERATION_COST / gas + 1n;
		const { result, passkey, prompts } = send({
			...FIRST_LOCK,
			maxFeePerGas: fee,
			maxPriorityFeePerGas: fee
		});
		const error = await failure(result);
		expect(error.name).toBe('UserOperationLimitError');
		expect(error.field).toBe('maxUserOperationCost');
		expect(passkey.asked).toBe(0);
		expect(prompts).toEqual({ shown: 0, signed: 0 });
	});

	it("keeps the wallet's Sepolia ceiling for the passkey: a setup's preVerificationGas is refused", async () => {
		const { result, passkey } = send({ ...RENEWAL, preVerificationGas: SETUP.preVerificationGas });
		const error = await failure(result);
		expect(error.name).toBe('UserOperationLimitError');
		expect(error.field).toBe('preVerificationGas');
		expect(passkey.asked).toBe(0);
	});
});

describe("one account's user operations", () => {
	it('go one after the other, and the second takes the nonce after the first', async () => {
		let chainNonce = 0n;
		/** @type {Array<() => void>} */
		const inclusions = [];
		const { bundler, sent } = fakeBundler({
			operation: RENEWAL,
			include: () =>
				new Promise((resolve) => {
					inclusions.push(() => {
						const nonce = chainNonce;
						chainNonce += 1n;
						resolve({ success: true, nonce });
					});
				})
		});
		const passkey = fakePasskey();
		const chain = createSepoliaChain({
			endpoints: ENDPOINTS,
			client: fakeClient({ nonce: () => chainNonce }),
			bundler,
			signChallenge: passkey.signChallenge
		});
		const input = { address: ACCOUNT, descriptor: DESCRIPTOR, calls: [] };
		const first = chain.sendWithPasskey(input);
		const second = chain.sendWithPasskey(input);

		await expect.poll(() => inclusions.length).toBe(1);
		// The first is signed and waits for inclusion; the second has not started.
		expect(sent).toEqual([{ nonce: 0n, signed: true }]);
		expect(passkey.asked).toBe(1);

		inclusions[0]();
		expect((await first).nonce).toBe(0n);
		await expect.poll(() => inclusions.length).toBe(2);
		expect(sent).toEqual([
			{ nonce: 0n, signed: true },
			{ nonce: 1n, signed: true }
		]);
		inclusions[1]();
		expect((await second).nonce).toBe(1n);
	});

	it('still sends the next one when the one before it failed', async () => {
		let failNext = true;
		const { bundler, sent } = fakeBundler({
			operation: RENEWAL,
			include: async () => {
				if (failNext) {
					failNext = false;
					throw new Error('The bundler timed out.');
				}
				return { success: true, nonce: 0n };
			}
		});
		const chain = createSepoliaChain({
			endpoints: ENDPOINTS,
			client: fakeClient(),
			bundler,
			signChallenge: fakePasskey().signChallenge
		});
		const input = { address: ACCOUNT, descriptor: DESCRIPTOR, calls: [] };
		const first = chain.sendWithPasskey(input);
		const second = chain.sendWithPasskey(input);
		expect((await failure(first)).message).toBe('The bundler timed out.');
		expect((await second).success).toBe(true);
		expect(sent).toHaveLength(2);
	});
});
