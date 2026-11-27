import { describe, expect, it } from 'vitest';
import { readListInput } from './list-input.js';

const CID = 'zdpuAoWDTgsZRCqwcLocq9jrv4byF3vcJDiUXS3J7g6tVFCSF';
const ADDRESS = `/orbitdb/${CID}`;

describe('readListInput', () => {
	it('takes an address, with or without its prefix', () => {
		expect(readListInput(ADDRESS)).toEqual({ address: ADDRESS, words: null });
		expect(readListInput(`  ${CID} `)).toEqual({ address: ADDRESS, words: null });
	});

	it('takes three words in any spelling the start dialog accepts', () => {
		expect(readListInput('luna-camino-verde')).toEqual({
			address: null,
			words: 'luna-camino-verde'
		});
		expect(readListInput('Luna camino  VERDE')).toEqual({
			address: null,
			words: 'luna-camino-verde'
		});
	});

	it('takes a link by what its fragment names', () => {
		expect(readListInput(`https://escrow01.le-space.de/en/#db=${CID}`)).toEqual({
			address: ADDRESS,
			words: null
		});
		expect(readListInput('https://escrow01.le-space.de/#listen&list=luna-camino-verde')).toEqual({
			address: null,
			words: 'luna-camino-verde'
		});
	});

	it('takes a link a messenger shortened, and a fragment alone', () => {
		expect(readListInput(`escrow01.le-space.de/#db=${CID}`)).toEqual({
			address: ADDRESS,
			words: null
		});
		expect(readListInput(`#db=${CID}`)).toEqual({ address: ADDRESS, words: null });
	});

	it('names nothing for anything else', () => {
		for (const input of [
			'',
			'   ',
			'hola',
			'luna camino',
			'/orbitdb/not-a-cid',
			'https://example.org/#x=1'
		]) {
			expect(readListInput(input), input).toEqual({ address: null, words: null });
		}
	});
});
