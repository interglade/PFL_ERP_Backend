/**
 * Shared document numbering (A5): sequence row first, seed from the business
 * table only when the series is new, format kept per document.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { compactDate, escapeRegex, nextDeliveryChallanNo, nextDocumentNumber, nextSerial, SERIES } from '../../global/numbering/documentNumber';

type Call = { sql: string; params: unknown[] };

/** A manager whose `query` answers UPDATE / SELECT MAX / INSERT from the given rows. */
const fakeManager = (answers: { update: unknown[]; max?: string | null; insert?: string }) => {
  const calls: Call[] = [];
  const manager = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('UPDATE document_sequences')) return answers.update;
      if (sql.includes('SELECT MAX')) return [{ max: answers.max ?? null }];
      if (sql.startsWith('INSERT INTO document_sequences')) return [{ last_serial: answers.insert ?? String(params[1]) }];
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  return { manager, calls };
};

describe('document numbering', () => {
  it('advances an existing series with one UPDATE and never reads the business table', async () => {
    const { manager, calls } = fakeManager({ update: [{ last_serial: '42' }] });
    await expect(nextDocumentNumber(manager, SERIES.inward, 'IWD20261015', 4)).resolves.toBe('IWD202610150042');
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(['inward_register:IWD20261015']);
  });

  it('seeds a new series from the highest stored serial (deleted rows included) and continues after it', async () => {
    const { manager, calls } = fakeManager({ update: [], max: '7' });
    await expect(nextDocumentNumber(manager, SERIES.rbc, 'RBC20261015', 5)).resolves.toBe('RBC2026101500008');
    expect(calls[1].sql).toContain('FROM "return_by_customer"');
    expect(calls[1].params).toEqual(['^RBC20261015([0-9]+)$']);
    expect(calls[2].params).toEqual(['return_by_customer:RBC20261015', 8]);
  });

  it('starts at 1 when nothing matches the series yet', async () => {
    const { manager } = fakeManager({ update: [], max: null });
    await expect(nextDocumentNumber(manager, SERIES.multiCashVoucher, 'CV-20261015-', 5)).resolves.toBe('CV-20261015-00001');
  });

  it('keeps the value another create inserted first (ON CONFLICT path)', async () => {
    const { manager } = fakeManager({ update: [], max: '0', insert: '2' });
    await expect(nextSerial(manager, 'delivery_challan_purchase:CN-S', SERIES.deliveryChallan, '^CN[0-9]{8}S([0-9]+)$')).resolves.toBe(2);
  });

  it('escapes regex characters of a prefix (invoice prefixes contain dots / dashes / brackets)', () => {
    expect(escapeRegex('PF-2026-Vashi (APMC).-')).toBe('PF-2026-Vashi \\(APMC\\)\\.-');
  });

  it('numbers delivery challans DC-<year>-<type><serial>, one series per type and year', async () => {
    const { manager, calls } = fakeManager({ update: [], max: null });
    await expect(nextDeliveryChallanNo(manager, 'O', new Date(2026, 11, 31))).resolves.toBe('DC-2026-O00001');
    expect(calls[0].params).toEqual(['delivery_challan_purchase:DC-2026-O']);
    expect(calls[1].params).toEqual(['^DC-2026-O([0-9]+)$']);

    const next = fakeManager({ update: [{ last_serial: '12' }] });
    await expect(nextDeliveryChallanNo(next.manager, 'C', new Date(2026, 5, 1))).resolves.toBe('DC-2026-C00012');

    // 1 January: a new scope, so the serial starts again at 1.
    const newYear = fakeManager({ update: [], max: null });
    await expect(nextDeliveryChallanNo(newYear.manager, 'S', new Date(2027, 0, 1))).resolves.toBe('DC-2027-S00001');
    expect(newYear.calls[0].params).toEqual(['delivery_challan_purchase:DC-2027-S']);
  });

  it('formats today as yyyyMMdd', () => {
    expect(compactDate(new Date(2026, 9, 5))).toBe('20261005');
  });
});
