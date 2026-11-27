import { afterEach, describe, expect, it } from 'vitest';
import { PrfUnavailableError } from '@le-space/orbitdb-identity-provider-webauthn-did/vault';
import { forgetPrfOutputs, holdPrfOutput, lacksPrf, prfForStart } from './start-prf.js';

const credential = (/** @type {string} */ id, /** @type {any} */ extra = {}) => ({
	credentialId: id,
	...extra
});
const output = (/** @type {number} */ fill) => new Uint8Array(32).fill(fill);

/** A stand-in for the passkey that counts how often it is asked. */
function passkey(/** @type {() => Promise<Uint8Array>} */ answer) {
	const asked = { count: 0 };
	const read = async () => {
		asked.count += 1;
		return answer();
	};
	return { asked, read };
}

afterEach(() => forgetPrfOutputs());

describe('the PRF read of a start', () => {
	it('asks the passkey once, and a restart in the same tab not again', async () => {
		const { asked, read } = passkey(async () => output(7));

		const first = await prfForStart(credential('alice'), { read });
		const again = await prfForStart(credential('alice'), { read });

		expect(asked.count).toBe(1);
		expect(first).toEqual(output(7));
		expect(again).toEqual(output(7));
	});

	it('hands out copies, so a caller that zeroes its bytes leaves the next one whole', async () => {
		const { read } = passkey(async () => output(7));
		const first = /** @type {Uint8Array} */ (await prfForStart(credential('alice'), { read }));
		first.fill(0);

		expect(await prfForStart(credential('alice'), { read })).toEqual(output(7));
	});

	it('asks each passkey for its own answer', async () => {
		const alice = passkey(async () => output(1));
		const bob = passkey(async () => output(2));

		expect(await prfForStart(credential('alice'), { read: alice.read })).toEqual(output(1));
		expect(await prfForStart(credential('bob'), { read: bob.read })).toEqual(output(2));
	});

	it('does not ask a passkey that says it has no PRF', async () => {
		const { asked, read } = passkey(async () => output(7));
		const without = credential('graphene', { extensionSupport: { prf: false } });

		expect(lacksPrf(without)).toBe(true);
		await expect(prfForStart(without, { read })).resolves.toBeNull();
		expect(asked.count).toBe(0);
	});

	it('takes an answer without PRF as none, and does not ask again in this tab', async () => {
		const { asked, read } = passkey(async () => {
			throw new PrfUnavailableError('no PRF output');
		});

		await expect(prfForStart(credential('alice'), { read })).resolves.toBeNull();
		await expect(prfForStart(credential('alice'), { read })).resolves.toBeNull();
		expect(asked.count).toBe(1);
	});

	it('lets a cancelled prompt stop the start, and asks again next time', async () => {
		const cancelled = Object.assign(
			new Error('The operation either timed out or was not allowed.'),
			{
				name: 'NotAllowedError'
			}
		);
		let refuse = true;
		const { asked, read } = passkey(async () => {
			if (refuse) throw cancelled;
			return output(7);
		});

		await expect(prfForStart(credential('alice'), { read })).rejects.toBe(cancelled);
		refuse = false;
		await expect(prfForStart(credential('alice'), { read })).resolves.toEqual(output(7));
		expect(asked.count).toBe(2);
	});

	it('holds what a restore handed out, so the start after it asks nothing', async () => {
		const { asked, read } = passkey(async () => output(9));
		holdPrfOutput(credential('alice'), output(3));

		expect(await prfForStart(credential('alice'), { read })).toEqual(output(3));
		expect(asked.count).toBe(0);
	});

	it('forgets what it held', async () => {
		const { asked, read } = passkey(async () => output(7));
		await prfForStart(credential('alice'), { read });
		forgetPrfOutputs();
		await prfForStart(credential('alice'), { read });

		expect(asked.count).toBe(2);
	});

	it('needs a credential to belong to', async () => {
		await expect(prfForStart({}, { read: async () => output(1) })).rejects.toThrow(TypeError);
	});
});
