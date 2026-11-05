/**
 * Documents raised against a Customer DC (RBC, Final Invoice) join the DC's
 * Sale transaction (docs/transaction-tracking-plan.md §9.4). The DC is read
 * from the document's own row, never from the request.
 */

import { EntityManager } from 'typeorm';
import { attachToTransaction } from '../../../transactions/transaction.core';
import { ident } from '../../../transactions/transaction.docs';
import { TXN_DOC_TYPES } from '../../../transactions/transaction.types';

export type DcChildDocType = 'return-by-customer' | 'final-invoice';

/**
 * Stamps the document with its Customer DC's transaction number (moving it
 * when the DC was switched). A no-op when the DC has no number. Returns the
 * number, or null.
 */
export async function attachToDcTransaction(manager: EntityManager, docType: DcChildDocType, docId: string): Promise<string | null> {
  const info = TXN_DOC_TYPES[docType];
  const rows: Array<{ no: string | null; txn_no: string | null }> = await manager.query(
    `SELECT h.${ident(info.numberColumn)}::text AS no, dc.txn_no
       FROM ${ident(info.table)} h
       JOIN delivery_challan_purchase dc ON dc.id = h.delivery_challan_id
      WHERE h.id = $1`,
    [docId],
  );
  const row = rows[0];
  if (!row?.txn_no) return null;
  return attachToTransaction(manager, { txnNo: row.txn_no, docType, docId, docNo: row.no });
}
