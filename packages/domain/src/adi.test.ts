import {describe, expect, it} from 'vitest';
import {addQuoteLine, seedAlarmBook} from './alarm-ops';
import {adiQuoteLine, applyAdiPrices, createMockAdiParts, markedUpUnitPrice} from './adi';

describe('ADI parts catalog', () => {
  it('searches the mock catalog by part number or description', async () => {
    const catalog = createMockAdiParts();
    expect(await catalog.search('s')).toEqual([]);
    const smoke = await catalog.search('smoke');
    expect(smoke.map(item => item.partNumber)).toEqual(['2W-B']);
    expect(smoke[0]).toMatchObject({description: 'System Sensor photoelectric smoke detector, 2-wire', dealerPrice: 18.4});
    expect(smoke[0].stock).toEqual([{branch: 'Boise', quantity: 42}, {branch: 'Meridian', quantity: 11}, {branch: 'Nampa', quantity: 0}]);
    expect(smoke[0].imageUrl.startsWith('data:image/svg+xml,')).toBe(true);
    expect((await catalog.search('PROA7')).map(item => item.partNumber)).toEqual(['PROA7PLUS']);
  });

  it('prices a quote line at dealer cost plus markup and leaves the ADI price untouched when a part cannot be bought', () => {
    expect(markedUpUnitPrice(18.4, 35)).toBe(24.84);
    expect(markedUpUnitPrice(27.15, 0)).toBe(27.15);
    expect(() => markedUpUnitPrice(10, 301)).toThrow(/0 to 300/);
    const [part] = applyAdiPrices(
      [{partNumber: '2W-B', description: 'Smoke', dealerPrice: 18.4, stock: [{branch: 'Boise', quantity: 42}], imageUrl: 'img'}],
      {ItemList: [{ItemNumber: '2W-B', ItemPrice: '16.00', AllowedToBuy: 'Y'}, {ItemNumber: 'P2RL', ItemPrice: '10.00', AllowedToBuy: 'N'}]},
    );
    expect(part.dealerPrice).toBe(16);
    expect(part.stock).toEqual([{branch: 'Boise', quantity: 42}]);
    const line = adiQuoteLine({...part, dealerPrice: 18.4}, 4, 35, 'ql-adi');
    expect(line).toMatchObject({id: 'ql-adi', kind: 'device', quantity: 4, unitPrice: 24.84, description: '2W-B · Smoke'});
  });

  it('adds the priced part to a sent quote and refuses a closed quote', async () => {
    const catalog = createMockAdiParts();
    const [part] = await catalog.search('2W-B');
    const book = seedAlarmBook();
    const next = addQuoteLine(book, 'q-clinic', adiQuoteLine(part, 2, 35, 'ql-smoke'));
    const quote = next.quotes.find(item => item.id === 'q-clinic');
    const lines = quote?.lines ?? [];
    expect(lines[lines.length - 1]).toMatchObject({description: '2W-B · System Sensor photoelectric smoke detector, 2-wire', quantity: 2, unitPrice: 24.84});
    expect(() => addQuoteLine(book, 'q-library', adiQuoteLine(part, 1, 35, 'ql-no'))).toThrow(/draft or sent/);
  });
});
