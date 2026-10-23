/**
 * Batch stock primitives (Phase C1–C4): reservation (FIFO / chosen batches),
 * consumption at batch cost, posting in.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { consumeDocument, postIn, reserveLines, stockKeyOf } from '../../inventoryStock/batch/stockBatch.core';

type Call = { sql: string; params: unknown[] };

/** Fake manager: the first rule whose pattern matches the SQL answers; every call is recorded. */
const fakeManager = (rules: Array<[RegExp, unknown[]]>) => {
  const calls: Call[] = [];
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rule = rules.find(([pattern]) => pattern.test(sql));
      return rule ? rule[1] : [];
    }),
  } as unknown as EntityManager;
  return { manager, calls };
};

const BATCHES = [
  // id order (lock order) differs from FIFO order on purpose
  { id: 'b-new', batch_no: 'MNG-0820', qty: '20', reserved_qty: '0' },
  { id: 'b-old', batch_no: 'MNG-0815', qty: '8', reserved_qty: '2' },
];
const FIFO = [{ id: 'b-old' }, { id: 'b-new' }];
const LINE = { lineId: 'item-1', productId: 'mango', variantId: 'hapus', uomId: 'box', qty: 10, kg: 50, label: 'Mango (Hapus) [Box]' };
const DOC = { type: 'DC_TYPE_CUSTOMER', id: 'dc-1', no: 'CN20261015C00001' };

describe('reserveLines', () => {
  it('takes the oldest batch first and splits a line over batches, kg shared by quantity', async () => {
    const { manager, calls } = fakeManager([[/FOR UPDATE/, BATCHES], [/ORDER BY first_in_at/, FIFO]]);
    await reserveLines(manager, { doc: DOC, companyId: 'c', locationId: 'l', stockType: 'FRESH', lines: [LINE] });
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO stock_allocation'));
    // b-old has 8 − 2 reserved = 6 free, the rest (4) comes from b-new.
    expect(inserts.map((c) => [c.params[4], c.params[6], c.params[7]])).toEqual([
      ['b-old', 6, 30],
      ['b-new', 4, 20],
    ]);
    const holds = calls.filter((c) => c.sql.startsWith('UPDATE stock_batch SET reserved_qty'));
    expect(holds.map((c) => c.params)).toEqual([['b-old', 6], ['b-new', 4]]);
  });

  it('uses the batches the user chose and checks they add up to the line', async () => {
    const { manager, calls } = fakeManager([[/FOR UPDATE/, BATCHES], [/ORDER BY first_in_at/, FIFO]]);
    await reserveLines(manager, {
      doc: DOC, companyId: 'c', locationId: 'l', stockType: 'FRESH',
      lines: [{ ...LINE, requested: [{ stockBatchId: 'b-new', qty: 10 }] }],
    });
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO stock_allocation'));
    expect(inserts.map((c) => [c.params[4], c.params[6]])).toEqual([['b-new', 10]]);

    const { manager: m2 } = fakeManager([[/FOR UPDATE/, BATCHES], [/ORDER BY first_in_at/, FIFO]]);
    await expect(reserveLines(m2, {
      doc: DOC, companyId: 'c', locationId: 'l', stockType: 'FRESH',
      lines: [{ ...LINE, requested: [{ stockBatchId: 'b-old', qty: 7 }] }],
    })).rejects.toThrow('Mango (Hapus) [Box]: batch MNG-0815 has only 6 available; 7 chosen; Mango (Hapus) [Box]: the batches add up to 0, the line needs 10');
  });

  it('refuses a line stock cannot cover and writes nothing', async () => {
    const { manager, calls } = fakeManager([[/FOR UPDATE/, BATCHES], [/ORDER BY first_in_at/, FIFO]]);
    await expect(reserveLines(manager, {
      doc: DOC, companyId: 'c', locationId: 'l', stockType: 'FRESH', lines: [{ ...LINE, qty: 30 }],
    })).rejects.toThrow('Insufficient stock: Mango (Hapus) [Box]: 30 needed but only 26 available (MNG-0815: 6, MNG-0820: 20)');
    expect(calls.some((c) => c.sql.includes('INSERT INTO stock_allocation'))).toBe(false);
  });
});

describe('consumeDocument', () => {
  it('takes reserved quantity out at the batch average cost and writes the ledger', async () => {
    const { manager, calls } = fakeManager([
      [/FROM stock_allocation WHERE doc_type/, [{ id: 'a1', line_id: 'item-1', stock_batch_id: 'b-old', qty: '4', net_kg: '20' }]],
      [/FROM stock_batch WHERE id = \$1 FOR UPDATE/, [{
        id: 'b-old', company_id: 'c', location_id: 'l', product_id: 'mango', variant_id: 'hapus', uom_id: 'box',
        batch_no: 'MNG-0815', stock_type: 'FRESH', qty: '10', net_kg: '50', value: '12500', unit_cost: '1250',
      }]],
      [/RETURNING qty, net_kg, value/, [{ qty: '6', net_kg: '30', value: '7500' }]],
    ]);
    await consumeDocument(manager, { docType: DOC.type, docId: DOC.id, docNo: DOC.no, movementType: 'DC_CUSTOMER' });
    const update = calls.find((c) => c.sql.includes('qty = qty - $2'))!;
    expect(update.params).toEqual(['b-old', 4, 20, 5000]);
    const ledger = calls.find((c) => c.sql.includes('INSERT INTO stock_ledger'))!;
    // qty_out, kg_out, value_out and the balance after
    expect(ledger.params.slice(14, 23)).toEqual([0, 4, 0, 20, 0, 5000, 6, 30, 7500]);
  });
});

describe('postIn', () => {
  it('adds to the batch row of the key (upper-case batch no) and records the movement', async () => {
    const { manager, calls } = fakeManager([[/INSERT INTO stock_batch/, [{ id: 'b1', qty: '50', net_kg: '250', value: '62500' }]]]);
    const id = await postIn(manager, {
      companyId: 'c', locationId: 'l', productId: 'mango', variantId: null, uomId: 'box', batchNo: ' mng-0815 ', stockType: 'FRESH',
      qty: 50, kg: 250, value: 62500, originType: 'GRN', originId: 'g1', originNo: 'GRN-1', movementType: 'INWARD_PURCHASE',
      doc: { type: 'inward-register', id: 'iw1', no: 'IWD1', lineId: 'l1' },
    });
    expect(id).toBe('b1');
    expect(calls[0].params[0]).toBe(stockKeyOf({ companyId: 'c', locationId: 'l', productId: 'mango', variantId: null, uomId: 'box', batchNo: 'MNG-0815', stockType: 'FRESH' }));
    expect(calls[0].params[0]).toBe('c|l|mango|-|box|MNG-0815|FRESH');
    expect(calls[1].sql).toContain('INSERT INTO stock_ledger');
  });
});
