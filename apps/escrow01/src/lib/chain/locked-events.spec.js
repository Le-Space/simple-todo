import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, pad, toHex } from 'viem';
import { escrowAbi } from './abis.js';
import {
	findLockedEvents,
	lockedEventsFromExplorer,
	lockedEventsFromRpc
} from './locked-events.js';

const ESCROW = /** @type {`0x${string}`} */ ('0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429');
const OTHER = /** @type {`0x${string}`} */ ('0x1111111111111111111111111111111111111111');
const CREATOR = /** @type {`0x${string}`} */ ('0x2222222222222222222222222222222222222222');
const BENEFICIARY = /** @type {`0x${string}`} */ ('0x3333333333333333333333333333333333333333');

/** A `Locked` log as an RPC or an explorer returns it, made with the escrow's ABI. */
function lockedLog({ block = 100n, index = 0, ref = 1, address = ESCROW } = {}) {
	const todoRef = pad(toHex(ref), { size: 32 });
	return {
		address: address.toLowerCase(),
		topics: encodeEventTopics({
			abi: escrowAbi,
			eventName: 'Locked',
			args: { creator: CREATOR, todoRef, beneficiary: BENEFICIARY }
		}),
		data: encodeAbiParameters([{ type: 'uint64' }], [1_800_000_000n]),
		blockNumber: toHex(block),
		logIndex: toHex(index),
		timeStamp: toHex(1_760_000_000 + Number(block)),
		transactionHash: pad(toHex(ref + 1000), { size: 32 })
	};
}

/** @param {any} body @param {number} [status] */
const answer = (body, status = 200) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('lockedEventsFromExplorer', () => {
	it('decodes every lock, newest first, with the time the explorer gives', async () => {
		const fetch = answer({
			status: '1',
			message: 'OK',
			result: [lockedLog({ block: 10n, ref: 1 }), lockedLog({ block: 20n, ref: 2 })]
		});
		const events = await lockedEventsFromExplorer({
			apiUrl: 'https://explorer.test/api',
			abi: escrowAbi,
			address: ESCROW,
			fromBlock: 1n,
			fetch
		});
		expect(events.map((e) => e.blockNumber)).toEqual([20n, 10n]);
		expect(events[0]).toMatchObject({
			creator: CREATOR,
			beneficiary: BENEFICIARY,
			deadline: 1_800_000_000n,
			lockedAt: BigInt(1_760_000_020)
		});
		const url = new URL(/** @type {any} */ (fetch.mock.calls[0])[0]);
		expect(url.searchParams.get('module')).toBe('logs');
		expect(url.searchParams.get('address')).toBe(ESCROW);
		expect(url.searchParams.get('fromBlock')).toBe('1');
		expect(url.searchParams.get('topic0')).toBe(lockedLog().topics[0]);
	});

	it('reads "no logs found" as an empty list, not as a failure', async () => {
		const events = await lockedEventsFromExplorer({
			apiUrl: 'https://explorer.test/api',
			abi: escrowAbi,
			address: ESCROW,
			fromBlock: 1n,
			fetch: answer({ status: '0', message: 'No logs found', result: null })
		});
		expect(events).toEqual([]);
	});

	it('refuses a log that is not the escrow’s', async () => {
		await expect(
			lockedEventsFromExplorer({
				apiUrl: 'https://explorer.test/api',
				abi: escrowAbi,
				address: ESCROW,
				fromBlock: 1n,
				fetch: answer({ status: '1', message: 'OK', result: [lockedLog({ address: OTHER })] })
			})
		).rejects.toThrow(/not the escrow/);
	});

	it('fails on an HTTP error', async () => {
		await expect(
			lockedEventsFromExplorer({
				apiUrl: 'https://explorer.test/api',
				abi: escrowAbi,
				address: ESCROW,
				fromBlock: 1n,
				fetch: answer({}, 502)
			})
		).rejects.toThrow(/HTTP 502/);
	});
});

/**
 * An RPC client that answers `getLogs` only within `limit` blocks, as the free RPCs do.
 * @param {{ latest: bigint, logs: ReturnType<typeof lockedLog>[], limit?: bigint }} options
 */
function rpcClient({ latest, logs, limit = 50_000n }) {
	return {
		getBlockNumber: vi.fn(async () => latest),
		getLogs: vi.fn(
			async (/** @type {{ fromBlock: bigint, toBlock: bigint }} */ { fromBlock, toBlock }) => {
				if (toBlock - fromBlock + 1n > limit) throw new Error('range too large');
				return logs
					.filter((log) => {
						const block = BigInt(log.blockNumber);
						return block >= fromBlock && block <= toBlock;
					})
					.map((log) => ({ ...log, blockNumber: BigInt(log.blockNumber) }));
			}
		),
		getBlock: vi.fn(async (/** @type {{ blockNumber: bigint }} */ { blockNumber }) => ({
			timestamp: 1_760_000_000n + blockNumber
		}))
	};
}

describe('lockedEventsFromRpc', () => {
	it('walks back in windows the RPC accepts, down to the deployment block', async () => {
		const client = rpcClient({
			latest: 250_000n,
			logs: [lockedLog({ block: 120_000n, ref: 1 }), lockedLog({ block: 240_000n, ref: 2 })]
		});
		const events = await lockedEventsFromRpc({
			client,
			abi: escrowAbi,
			address: ESCROW,
			fromBlock: 100_000n
		});
		expect(events.map((e) => e.blockNumber)).toEqual([240_000n, 120_000n]);
		expect(events[1].lockedAt).toBe(1_760_000_000n + 120_000n);
		// 250,000 back to 100,000 is 150,001 blocks: four windows of at most 50,000.
		expect(client.getLogs).toHaveBeenCalledTimes(4);
		expect(client.getLogs.mock.calls.at(-1)?.[0].fromBlock).toBe(100_000n);
	});

	it('stops once it has as many locks as it wants', async () => {
		const client = rpcClient({
			latest: 300_000n,
			logs: [lockedLog({ block: 290_000n, ref: 1 }), lockedLog({ block: 280_000n, ref: 2 })]
		});
		await lockedEventsFromRpc({
			client,
			abi: escrowAbi,
			address: ESCROW,
			fromBlock: 1n,
			want: 2
		});
		expect(client.getLogs).toHaveBeenCalledTimes(1);
	});
});

describe('findLockedEvents', () => {
	it('takes the explorer when it answers', async () => {
		const client = rpcClient({ latest: 10n, logs: [] });
		const events = await findLockedEvents({
			apiUrl: 'https://explorer.test/api',
			fetch: answer({ status: '1', message: 'OK', result: [lockedLog({ block: 5n })] }),
			client,
			abi: escrowAbi,
			address: ESCROW,
			fromBlock: 1n
		});
		expect(events).toHaveLength(1);
		expect(client.getLogs).not.toHaveBeenCalled();
	});

	it('falls back to the RPC when the explorer fails, or is switched off', async () => {
		for (const apiUrl of ['https://explorer.test/api', null]) {
			const client = rpcClient({ latest: 10n, logs: [lockedLog({ block: 5n })] });
			const events = await findLockedEvents({
				apiUrl,
				fetch: answer({}, 503),
				client,
				abi: escrowAbi,
				address: ESCROW,
				fromBlock: 1n
			});
			expect(events).toHaveLength(1);
		}
	});

	it('names both reasons when both fail', async () => {
		const client = rpcClient({ latest: 10n, logs: [] });
		client.getLogs.mockRejectedValue(new Error('ranges over 100 blocks are not supported'));
		await expect(
			findLockedEvents({
				apiUrl: 'https://explorer.test/api',
				fetch: answer({}, 503),
				client,
				abi: escrowAbi,
				address: ESCROW,
				fromBlock: 1n
			})
		).rejects.toThrow(/HTTP 503\. \/ ranges over 100 blocks/);
	});
});
