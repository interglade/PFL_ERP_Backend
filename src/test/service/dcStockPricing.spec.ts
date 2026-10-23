/**
 * Phase B: DC stock checks (pending DCs hold stock, direct sales check the
 * GRN) and per-line pricing basis.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { lineAmount, normalizePricingBasis, priceDcLines } from '../../deliveryChallans/deliverychllan/service/dcPricing';
import { assertDcStockAvailable, assertDirectSaleWithinGrn, resolveDcLines } from '../../deliveryChallans/deliverychllan/service/dcStock';

/** Answers each SQL by the first matching rule. */
const fakeManager = (rules: Array<[RegExp, unknown[]]>) =>
  ({
    query: jest.fn(async (sql: string) => {
      const rule = rules.find(([pattern]) => pattern.test(sql));
      return rule ? rule[1] : [];
    }),
  }) as unknown as EntityManager;

describe('pricing basis', () => {
  it('prices per unit by quantity and per kg by net weight', () => {
    expect(lineAmount('per_unit', 10, 52, 1250)).toBe(12500);
    expect(lineAmount('per_kg', 10, 52, 240)).toBe(12480);
  });

  it('defaults to per unit and rejects anything else', () => {
    expect(normalizePricingBasis(undefined)).toBe('per_unit');
    expect(() => normalizePricingBasis('per_box')).toThrow(/Pricing basis/);
  });

  it('sets every line amount from its basis (client amounts ignored) and returns the total', () => {
    const lines: any[] = [
      { quantity: 10, netWeight: 52, unitPrice: 1250, amount: 1 },
      { pricingBasis: 'per_kg', quantity: 10, netWeight: 52, unitPrice: 240, amount: 1 },
    ];
    expect(priceDcLines(lines)).toBe(24980);
    expect(lines.map((l) => [l.pricingBasis, l.amount])).toEqual([['per_unit', 12500], ['per_kg', 12480]]);
  });
});

describe('DC stock checks', () => {
  const productRows: [RegExp, unknown[]] = [/FROM product WHERE/, [{ id: 'onion', name: 'Onion' }]];

  it('needs a net weight on every line (stock moves by net kg)', async () => {
    const manager = fakeManager([productRows]);
    await expect(resolveDcLines(manager, [{ productName: 'onion', quantity: 5, netWeight: 0 }])).rejects.toThrow(
      'Onion: enter the net weight (kg); stock is moved by net weight',
    );
  });

  it('counts kg held by other pending DCs against the stock on hand', async () => {
    const manager = fakeManager([
      productRows,
      [/information_schema\.columns/, [{ column_name: 'branch_id' }]],
      [/FROM inventory_stock/, [{ kg: '100' }]],
      [/FROM item it/, [{ kg: '70' }]],
    ]);
    const lines = await resolveDcLines(manager, [{ productName: 'onion', quantity: 1, netWeight: 40 }]);
    await expect(assertDcStockAvailable(manager, { companyId: 'c1', locationId: 'l1', lines })).rejects.toThrow(
      'Insufficient stock: Onion: 40 kg needed but only 30 kg available (100 kg in stock, 70 kg held by other pending DCs)',
    );
  });

  it('passes when stock minus pending DCs covers the lines', async () => {
    const manager = fakeManager([
      productRows,
      [/information_schema\.columns/, [{ column_name: 'branch_id' }]],
      [/FROM inventory_stock/, [{ kg: '100' }]],
      [/FROM item it/, [{ kg: '60' }]],
    ]);
    const lines = await resolveDcLines(manager, [{ productName: 'onion', quantity: 1, netWeight: 40 }]);
    await expect(assertDcStockAvailable(manager, { companyId: 'c1', locationId: 'l1', lines })).resolves.toBeUndefined();
  });

  it('limits a direct-sale DC to what is left of its GRN', async () => {
    const manager = fakeManager([
      productRows,
      [/FROM grn_products/, [{ product_id: 'onion', variant_id: null, kg: '1000' }]],
      [/FROM item it JOIN/, [{ product_id: 'onion', variant_id: null, kg: '700' }]],
    ]);
    const lines = await resolveDcLines(manager, [{ productName: 'onion', quantity: 1, netWeight: 400 }]);
    await expect(assertDirectSaleWithinGrn(manager, { grnId: 'g1', lines })).rejects.toThrow(
      'Onion: 400 kg entered but only 300 kg of the GRN is left to sell',
    );
  });
});
