/**
 * Processing documents (AQR / Inward / Dump / RTV) take the transaction number
 * of their receiving source (docs/transaction-tracking-plan.md §9.4).
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';

jest.mock('../../transactions/transaction.core', () => ({
  attachToTransaction: jest.fn(async (_m: unknown, input: { txnNo: string }) => input.txnNo),
  refreshTransaction: jest.fn(async () => undefined),
  refreshTransactionOf: jest.fn(async () => undefined),
  txnNoOf: jest.fn(),
}));

import * as core from '../../transactions/transaction.core';
import { attachToReceivingSource, PROCESSING_TXN_DOC } from '../../receiving/receiving.transaction';
import { RECEIVING_SOURCE_TXN_DOC } from '../../receiving/receiving.types';

const mocked = core as jest.Mocked<typeof core>;
const SOURCE = '11111111-1111-1111-1111-111111111111';
const DOC = '22222222-2222-2222-2222-222222222222';

const fakeManager = () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const manager = { query: jest.fn(async (sql: string, params: unknown[]) => { queries.push({ sql, params }); return []; }) };
  return { manager: manager as unknown as EntityManager, queries };
};

beforeEach(() => jest.clearAllMocks());

describe('receiving source → transaction document type', () => {
  it('maps every source and processing document', () => {
    expect(RECEIVING_SOURCE_TXN_DOC).toEqual({ grn: 'grn', 'stock-transfer-dc': 'dc-transfer', rbc: 'return-by-customer' });
    expect(PROCESSING_TXN_DOC).toEqual({ aqr: 'aqr', inward: 'inward-register', dump: 'dump-register', rtv: 'return-to-vendor' });
  });
});

describe('attachToReceivingSource', () => {
  it('attaches to the number read from the source row', async () => {
    const { manager } = fakeManager();
    mocked.txnNoOf.mockImplementation(async (_m, docType) => (docType === 'dc-transfer' ? 'T26102900001' : null));
    const txn = await attachToReceivingSource(manager, { sourceType: 'stock-transfer-dc', sourceId: SOURCE, docType: 'inward', docId: DOC, docNo: 'IWD1' });
    expect(txn).toBe('T26102900001');
    expect(mocked.txnNoOf).toHaveBeenCalledWith(manager, 'dc-transfer', SOURCE);
    expect(mocked.attachToTransaction).toHaveBeenCalledWith(manager, { txnNo: 'T26102900001', docType: 'inward-register', docId: DOC, docNo: 'IWD1' });
  });

  it('removes a stale number when the source has none', async () => {
    const { manager, queries } = fakeManager();
    mocked.txnNoOf.mockImplementation(async (_m, docType) => (docType === 'aqr' ? 'R26102900003' : null));
    const txn = await attachToReceivingSource(manager, { sourceType: 'grn', sourceId: SOURCE, docType: 'aqr', docId: DOC, docNo: 'AQR1' });
    expect(txn).toBeNull();
    expect(mocked.attachToTransaction).not.toHaveBeenCalled();
    expect(queries.map((q) => q.sql)).toEqual([
      expect.stringContaining('DELETE FROM transaction_documents'),
      expect.stringContaining('UPDATE "aqr" SET txn_no = NULL'),
    ]);
    expect(mocked.refreshTransaction).toHaveBeenCalledWith(manager, 'R26102900003');
  });

  it('does nothing when neither the source nor the document has a number', async () => {
    const { manager, queries } = fakeManager();
    mocked.txnNoOf.mockResolvedValue(null);
    expect(await attachToReceivingSource(manager, { sourceType: 'rbc', sourceId: SOURCE, docType: 'dump', docId: DOC, docNo: null })).toBeNull();
    expect(queries).toHaveLength(0);
    expect(mocked.refreshTransaction).not.toHaveBeenCalled();
  });

  it('never reads a number without a source', async () => {
    const { manager } = fakeManager();
    mocked.txnNoOf.mockResolvedValue(null);
    await attachToReceivingSource(manager, { sourceType: null, sourceId: null, docType: 'rtv', docId: DOC, docNo: null });
    expect(mocked.txnNoOf).toHaveBeenCalledTimes(1);
    expect(mocked.txnNoOf).toHaveBeenCalledWith(manager, 'return-to-vendor', DOC);
  });
});
