/**
 * Every `Locked` event of the escrow, for the auditor view, newest first.
 *
 * One `eth_getLogs` from the deployment block to the latest one stopped
 * working once the escrow was a few weeks old: Sepolia's free public RPCs
 * answer only small ranges (1rpc 50 blocks, publicnode 50,000, measured
 * 2026-11-25; Tenderly 50,000 on 2026-11-27). So the list comes from a block explorer first, which
 * has the events indexed already, and only when that fails from the RPC, in
 * windows walking back from the latest block.
 *
 * The explorer only says *which* escrows exist. Every entry is decoded against
 * the escrow's ABI here, and the view reads status and amount from the escrow
 * contract itself; an explorer could leave an escrow out, not change one.
 */
import { decodeEventLog, getAddress, isAddressEqual, toEventSelector } from 'viem';

/** @typedef {`0x${string}`} Hex */
/**
 * @typedef {{
 *   creator: Hex
 *   todoRef: Hex
 *   beneficiary: Hex
 *   deadline: bigint
 *   lockedAt: bigint
 *   txHash: Hex
 *   blockNumber: bigint
 *   logIndex: number
 * }} LockedEvent
 */

/** What publicnode and Tenderly, the widest of the public RPCs, answer in one call. */
export const RPC_WINDOW = 50_000n;
/** The explorer's page size (Etherscan-compatible APIs cap it at 1,000). */
const PAGE = 1000;
const MAX_PAGES = 20;

/** @param {readonly any[]} abi */
const lockedEventOf = (abi) => {
	const event = abi.find((item) => item.type === 'event' && item.name === 'Locked');
	if (!event) throw new Error('The escrow ABI has no Locked event.');
	return event;
};

/**
 * One log, as an explorer or an RPC returns it, decoded as `Locked`.
 *
 * @param {{ abi: readonly any[], address: Hex, log: { address: string, topics: readonly string[], data: string } }} input
 */
function decodeLocked({ abi, address, log }) {
	if (!isAddressEqual(getAddress(log.address), address)) {
		throw new Error(`A log from ${log.address} is not the escrow's.`);
	}
	const { eventName, args } = /** @type {any} */ (
		decodeEventLog({
			abi: [lockedEventOf(abi)],
			data: /** @type {Hex} */ (log.data),
			topics: /** @type {[Hex, ...Hex[]]} */ (log.topics)
		})
	);
	if (eventName !== 'Locked') throw new Error(`Expected Locked, got ${eventName}.`);
	return {
		creator: getAddress(args.creator),
		todoRef: /** @type {Hex} */ (args.todoRef),
		beneficiary: getAddress(args.beneficiary),
		deadline: BigInt(args.deadline)
	};
}

/** Newest first: by block, then by position in the block. @param {LockedEvent[]} events */
const newestFirst = (events) =>
	events.sort((a, b) =>
		a.blockNumber === b.blockNumber
			? b.logIndex - a.logIndex
			: a.blockNumber < b.blockNumber
				? 1
				: -1
	);

/**
 * From an Etherscan-compatible explorer API (`module=logs&action=getLogs`),
 * Blockscout's by default. The answer carries each log's block time, so no
 * block has to be fetched for it.
 *
 * @param {{
 *   apiUrl: string
 *   abi: readonly any[]
 *   address: Hex
 *   fromBlock: bigint
 *   fetch?: typeof globalThis.fetch
 * }} input
 * @returns {Promise<LockedEvent[]>}
 */
export async function lockedEventsFromExplorer({
	apiUrl,
	abi,
	address,
	fromBlock,
	fetch = globalThis.fetch
}) {
	const topic0 = toEventSelector(lockedEventOf(abi));
	/** @type {LockedEvent[]} */
	const events = [];
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const url = new URL(apiUrl);
		url.search = new URLSearchParams({
			module: 'logs',
			action: 'getLogs',
			address,
			topic0,
			fromBlock: String(fromBlock),
			toBlock: 'latest',
			page: String(page),
			offset: String(PAGE)
		}).toString();
		const response = await fetch(url, { headers: { accept: 'application/json' } });
		if (!response.ok) throw new Error(`The explorer answered HTTP ${response.status}.`);
		const body = await response.json();
		// An empty list comes back as status "0" with a message, not as an error.
		if (!Array.isArray(body?.result)) {
			if (/no (records|logs) found/i.test(String(body?.message ?? ''))) break;
			throw new Error(`The explorer answered: ${body?.message ?? 'no result'}.`);
		}
		for (const log of body.result) {
			events.push({
				...decodeLocked({ abi, address, log }),
				lockedAt: BigInt(log.timeStamp),
				txHash: /** @type {Hex} */ (log.transactionHash),
				blockNumber: BigInt(log.blockNumber),
				logIndex: Number(log.logIndex)
			});
		}
		if (body.result.length < PAGE) break;
	}
	return newestFirst(events);
}

/**
 * From the RPC, in windows of `window` blocks walking back from the latest,
 * until `want` locks are found or the deployment block is reached.
 *
 * @param {{
 *   client: { getBlockNumber: () => Promise<bigint>, getLogs: (args: any) => Promise<any[]>, getBlock: (args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }> }
 *   abi: readonly any[]
 *   address: Hex
 *   fromBlock: bigint
 *   want?: number
 *   window?: bigint
 * }} input
 * @returns {Promise<LockedEvent[]>}
 */
export async function lockedEventsFromRpc({
	client,
	abi,
	address,
	fromBlock,
	want = 50,
	window = RPC_WINDOW
}) {
	const event = lockedEventOf(abi);
	/** @type {any[]} */
	const logs = [];
	let to = await client.getBlockNumber();
	while (to >= fromBlock && logs.length < want) {
		const from = to - window + 1n > fromBlock ? to - window + 1n : fromBlock;
		logs.push(...(await client.getLogs({ address, event, fromBlock: from, toBlock: to })));
		to = from - 1n;
	}
	/** @type {Map<bigint, bigint>} */
	const times = new Map();
	for (const blockNumber of new Set(logs.map((log) => BigInt(log.blockNumber)))) {
		times.set(blockNumber, (await client.getBlock({ blockNumber })).timestamp);
	}
	return newestFirst(
		logs.map((log) => ({
			...decodeLocked({ abi, address, log }),
			lockedAt: times.get(BigInt(log.blockNumber)) ?? 0n,
			txHash: log.transactionHash,
			blockNumber: BigInt(log.blockNumber),
			logIndex: Number(log.logIndex)
		}))
	);
}

/**
 * The explorer first, the RPC when the explorer is switched off or fails.
 * Throws only when both fail, with both reasons.
 *
 * @param {Parameters<typeof lockedEventsFromRpc>[0] & { apiUrl: string | null, fetch?: typeof globalThis.fetch }} input
 * @returns {Promise<LockedEvent[]>}
 */
export async function findLockedEvents({ apiUrl, fetch, ...rpc }) {
	let explorerError = null;
	if (apiUrl) {
		try {
			return await lockedEventsFromExplorer({
				apiUrl,
				abi: rpc.abi,
				address: rpc.address,
				fromBlock: rpc.fromBlock,
				fetch
			});
		} catch (error) {
			explorerError = error;
		}
	}
	try {
		return await lockedEventsFromRpc(rpc);
	} catch (error) {
		const reasons = [explorerError, error]
			.filter(Boolean)
			.map((e) => (e instanceof Error ? e.message : String(e)));
		throw new Error(`The escrow's locks could not be listed: ${reasons.join(' / ')}`);
	}
}
