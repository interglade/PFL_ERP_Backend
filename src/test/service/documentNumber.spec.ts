/**
 * Shared document numbering (A5): sequence row first, seed from the business
 * table only when the series is new, format kept per document.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { compactDate, escapeRegex, nextDocumentNumber, nextSerial, SERIES } from '../../global/numbering/documentNumber';

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

  it('formats today as yyyyMMdd', () => {
    expect(compactDate(new Date(2026, 9, 5))).toBe('20261005');
  });
});
