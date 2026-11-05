/**
 * Transaction numbers (docs/transaction-tracking-plan.md §3, §9.2): format,
 * Asia/Kolkata business day, prefixes and document type mapping.
 */

import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { nextSerial, SERIES } from '../../global/numbering/documentNumber';
import {
  businessDateOf,
  formatTxnNo,
  isTxnNo,
  parseTxnNo,
  txnSeedPattern,
  txnSequenceScope,
} from '../../transactions/transaction.number';
import {
  CONSUME_LINK_KIND,
  DOCUMENT_TYPE_TO_TXN_DOC,
  prefixOf,
  stepOfDoc,
  toTxnDocType,
  TXN_DOC_TYPE_LIST,
  TXN_DOC_TYPES,
  txnTableOf,
} from '../../transactions/transaction.types';
import { consumeLinkKindOf, consumeLinkSql, txnNoSubquerySql } from '../../transactions/transaction.links';

describe('transaction number format', () => {
  it('is prefix + yyMMdd + 5-digit serial', () => {
    expect(formatTxnNo('R', '261029', 1)).toBe('R26102900001');
    expect(formatTxnNo('T', '261029', 12345)).toBe('T26102912345');
    expect(formatTxnNo('R', '261029', 1)).toHaveLength(12);
  });

  it('gives the two-letter prefixes 13 characters, the column width', () => {
    expect(formatTxnNo('SO', '261029', 1)).toBe('SO26102900001');
    expect(formatTxnNo('SS', '261029', 99999)).toBe('SS26102999999');
    expect(formatTxnNo('SO', '261029', 1)).toHaveLength(13);
  });

  it('refuses a serial beyond 99999 or below 1, and a bad date', () => {
    expect(() => formatTxnNo('S', '261029', 100000)).toThrow('out of range');
    expect(() => formatTxnNo('S', '261029', 0)).toThrow('out of range');
    expect(() => formatTxnNo('S', '2610', 1)).toThrow('yyMMdd');
  });

  it('parses numbers, reading SO / SS before S', () => {
    expect(parseTxnNo('SO26102900007')).toEqual({ prefix: 'SO', compactDate: '261029', serial: 7 });
    expect(parseTxnNo('s26102900007')).toEqual({ prefix: 'S', compactDate: '261029', serial: 7 });
    expect(parseTxnNo('GRN-00012')).toBeNull();
    expect(isTxnNo('X26102900001')).toBe(false);
    expect(isTxnNo('G26102900001')).toBe(true);
  });

  it('uses one sequence scope per prefix and day, and a seed pattern that matches only that day', () => {
    expect(txnSequenceScope('S', '261029')).toBe('txn:S:261029');
    const pattern = new RegExp(txnSeedPattern('S', '261029'));
    expect(pattern.exec('S26102900042')?.[1]).toBe('00042');
    expect(pattern.test('SO26102900042')).toBe(false);
    expect(pattern.test('S26103000042')).toBe(false);
  });

  it('issues the serial from document_sequences of the transactions series', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.startsWith('UPDATE document_sequences')) return [];
        if (sql.includes('SELECT MAX')) return [{ max: null }];
        return [{ last_serial: String(params[1]) }];
      }),
    } as unknown as EntityManager;
    const serial = await nextSerial(manager, txnSequenceScope('SO', '261029'), SERIES.transaction, txnSeedPattern('SO', '261029'));
    expect(serial).toBe(1);
    expect(calls[1].sql).toContain('FROM "transactions" WHERE "txn_no"');
  });
});

describe('business date (Asia/Kolkata)', () => {
  it('rolls over at IST midnight, not UTC midnight', () => {
    // 18:29:59 UTC = 23:59:59 IST on the 29th; 18:30 UTC = 00:00 IST on the 30th.
    expect(businessDateOf(new Date('2026-10-29T18:29:59Z'))).toEqual({ date: '2026-10-29', compact: '261029' });
    expect(businessDateOf(new Date('2026-10-29T18:30:00Z'))).toEqual({ date: '2026-10-30', compact: '261030' });
    // Early UTC morning is already the same IST day.
    expect(businessDateOf(new Date('2026-10-29T00:10:00Z')).compact).toBe('261029');
  });

  it('handles the year boundary', () => {
    expect(businessDateOf(new Date('2026-12-31T18:45:00Z')).compact).toBe('270101');
  });
});

describe('prefixes and document types', () => {
  it('picks R for an RFPA purchase, G for a GRN without deal slip, and one prefix per other type', () => {
    expect(prefixOf('purchase', 'rfpa')).toBe('R');
    expect(prefixOf('purchase', 'grn')).toBe('G');
    expect(prefixOf('transfer', 'dc-transfer')).toBe('T');
    expect(prefixOf('sale', 'dc-customer')).toBe('S');
    expect(prefixOf('other-sale', 'dc-other')).toBe('SO');
    expect(prefixOf('second-sale', 'second-sale')).toBe('SS');
  });

  it('maps all 14 document types to a table, number column and approval type', () => {
    expect(TXN_DOC_TYPE_LIST).toHaveLength(14);
    expect(TXN_DOC_TYPES['dc-customer'].table).toBe('delivery_challan_purchase');
    expect(TXN_DOC_TYPES['dc-transfer'].table).toBe('delivery_challan_purchase');
    expect(TXN_DOC_TYPES['dc-other'].table).toBe('delivery_challan_purchase');
    expect(TXN_DOC_TYPES.dispatch).toEqual(expect.objectContaining({ table: 'dispatch', numberColumn: 'vehicleDispatchNo', documentsType: DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER }));
    // Every documents type maps back to the TxnDocType whose documentsType it is.
    const enumValues: string[] = Object.keys(DocumentTypeEnum).map((k) => (DocumentTypeEnum as Record<string, string>)[k]);
    for (const docType of TXN_DOC_TYPE_LIST) {
      expect(enumValues).toContain(TXN_DOC_TYPES[docType].documentsType);
      expect(DOCUMENT_TYPE_TO_TXN_DOC[TXN_DOC_TYPES[docType].documentsType]).toBe(docType);
    }
  });

  it('reads documents types, ledger doc types, dispatch types and TxnDocTypes', () => {
    expect(toTxnDocType(DocumentTypeEnum.DC_TYPE_CUSTOMER)).toBe('dc-customer');
    expect(toTxnDocType(DocumentTypeEnum.INWARD_REGISTER)).toBe('inward-register');
    expect(toTxnDocType(DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER)).toBe('dispatch');
    expect(toTxnDocType('stock-transfer')).toBe('dispatch');
    expect(toTxnDocType('dc-other')).toBe('dc-other');
    expect(toTxnDocType(DocumentTypeEnum.STOCK_ADJUSTMENT)).toBeNull();
    expect(toTxnDocType(DocumentTypeEnum.MULTI_CASH_VOUCHER)).toBeNull();
    expect(txnTableOf(DocumentTypeEnum.SECOND_SALE)).toBe('second_sale_document');
    expect(txnTableOf(null)).toBeNull();
  });

  it('puts receiving documents in the receiving step, or the return step of a sale', () => {
    expect(stepOfDoc('purchase', 'aqr')).toBe('receiving');
    expect(stepOfDoc('transfer', 'inward-register')).toBe('receiving');
    expect(stepOfDoc('sale', 'dump-register')).toBe('return-receiving');
    expect(stepOfDoc('sale', 'return-by-customer')).toBe('return');
    expect(stepOfDoc('sale', 'final-invoice')).toBe('invoice');
  });

  it('links consumption by DC kind / second sale only', () => {
    expect(CONSUME_LINK_KIND).toEqual({ 'dc-transfer': 'transferred', 'dc-customer': 'sold', 'dc-other': 'sold-other', 'second-sale': 'resold' });
    expect(consumeLinkKindOf(DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER)).toBe('transferred');
    expect(consumeLinkKindOf('stock-repack')).toBeNull();
    expect(consumeLinkSql(DocumentTypeEnum.SECOND_SALE)).toContain('FROM stock_batch b, "second_sale_document" h');
    expect(txnNoSubquerySql(DocumentTypeEnum.INWARD_REGISTER, '$25')).toBe('(SELECT th.txn_no FROM "inward_register" th WHERE th.id = $25::uuid)');
    expect(txnNoSubquerySql('stock-adjustment', '$25')).toBeNull();
  });
});
