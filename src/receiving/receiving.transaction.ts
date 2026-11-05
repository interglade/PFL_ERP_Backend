/**
 * Transaction numbers of the four processing documents (AQR, Inward, Dump, RTV)
 * — docs/transaction-tracking-plan.md §9.4. A processing document joins the
 * transaction of its receiving source (GRN, Transfer DC or RBC), read from the
 * source row, never from the request.
 */

import { EntityManager } from 'typeorm';
import { attachToTransaction, refreshTransaction, refreshTransactionOf, txnNoOf } from '../transactions/transaction.core';
import { ident } from '../transactions/transaction.docs';
import { TXN_DOC_TYPES, TxnDocType } from '../transactions/transaction.types';
import { ProcessingDocType, ReceivingSourceType, RECEIVING_SOURCE_TXN_DOC } from './receiving.types';

/** Transaction document type of each processing document. */
export const PROCESSING_TXN_DOC: Record<ProcessingDocType, TxnDocType> = {
  aqr: 'aqr',
  inward: 'inward-register',
  dump: 'dump-register',
  rtv: 'return-to-vendor',
};

/**
 * Attaches a processing document to its source's transaction (or moves it
 * there when the source changed). Returns the number, or null when the source
 * has none (created before go-live); then any number on the document (copied
 * from the request, or from a previous source) is removed.
 */
export async function attachToReceivingSource(
  manager: EntityManager,
  input: { sourceType: ReceivingSourceType | null | undefined; sourceId: string | null | undefined; docType: ProcessingDocType; docId: string; docNo: string | null },
): Promise<string | null> {
  const txnDocType = PROCESSING_TXN_DOC[input.docType];
  const sourceTxn = input.sourceType && input.sourceId ? await txnNoOf(manager, RECEIVING_SOURCE_TXN_DOC[input.sourceType], input.sourceId) : null;
  if (!sourceTxn) {
    // The source has no number (created before go-live): neither has the document.
    // Clears a number copied from the request or left from a previous source.
    const previous = await txnNoOf(manager, txnDocType, input.docId);
    if (previous) {
      await manager.query(`DELETE FROM transaction_documents WHERE doc_type = $1 AND doc_id = $2`, [txnDocType, input.docId]);
      await manager.query(`UPDATE ${ident(TXN_DOC_TYPES[txnDocType].table)} SET txn_no = NULL WHERE id = $1`, [input.docId]);
      await refreshTransaction(manager, previous);
    }
    return null;
  }
  return attachToTransaction(manager, { txnNo: sourceTxn, docType: txnDocType, docId: input.docId, docNo: input.docNo });
}

/** Refreshes the transaction of a processing document (after delete / edit). Never throws. */
export function refreshProcessingTransaction(manager: EntityManager, docType: ProcessingDocType, docId: string): Promise<void> {
  return refreshTransactionOf(manager, PROCESSING_TXN_DOC[docType], docId);
}
