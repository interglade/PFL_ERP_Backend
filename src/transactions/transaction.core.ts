/**
 * Transaction numbers on documents (docs/transaction-tracking-plan.md §5.2, §9.2).
 *
 * Plain functions taking the caller's EntityManager (same style as
 * dcDelivery.ts), so they run inside the document's own DB transaction:
 *   openTransaction      — the first document of a deal issues the number;
 *   attachToTransaction  — every following document copies its parent's number;
 *   txnNoOf              — the number stored on a document;
 *   refreshTransaction   — recomputes stage, status and summary;
 *   refreshTransactionOf — the same, starting from a document.
 *
 * `refresh*` and `linkDirectSale` never throw: errors are logged and, inside a
 * DB transaction, undone with a savepoint so the caller's transaction stays
 * usable. A document action must never fail because the summary could not be
 * computed.
 */

import { EntityManager } from 'typeorm';
import AppError from '../utils/appError';
import logger from '../utils/logger';
import { DocumentTypeEnum } from '../approvalFlow/entity/docuemnt.entity';
import { nextSerial, SERIES } from '../global/numbering/documentNumber';
import { Item } from '../deliveryChallans/deliverychllan/entity/dItem.entity';
import { fkColumn, ident, isUuid } from './transaction.docs';
import { businessDateOf, formatTxnNo, txnSeedPattern, txnSequenceScope } from './transaction.number';
import { evaluateTransaction } from './transaction.stage';
import {
  ORIGIN_DOC_TYPES,
  prefixOf,
  stepOfDoc,
  toTxnDocType,
  TXN_DOC_TYPES,
  TxnDocType,
  TxnPartyType,
  TxnType,
} from './transaction.types';

export interface OpenTransactionInput {
  type: TxnType;
  origin: { docType: TxnDocType; docId: string; docNo: string | null };
  companyId?: string | null;
  locationId?: string | null;
  toLocationId?: string | null;
  partyType?: TxnPartyType | null;
  partyId?: string | null;
  partyName?: string | null;
}

export interface AttachInput {
  txnNo: string | null | undefined;
  docType: TxnDocType;
  docId: string;
  docNo: string | null;
}

const uuidOrNull = (v: string | null | undefined): string | null => (isUuid(v) ? v : null);

/**
 * Runs `fn`; on error logs it and, when the manager is inside a DB
 * transaction, rolls back to a savepoint so the caller can carry on.
 */
async function safely<T>(manager: EntityManager, what: string, fn: () => Promise<T>): Promise<T | null> {
  const inTransaction = Boolean(manager.queryRunner?.isTransactionActive);
  const savepoint = `txn_${Math.random().toString(36).slice(2, 10)}`;
  try {
    if (inTransaction) await manager.query(`SAVEPOINT ${savepoint}`);
    const result = await fn();
    if (inTransaction) await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    if (inTransaction) await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
    logger.error(`Transactions: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Newest approval row id of a document, or null. */
async function approvalDocumentId(manager: EntityManager, docType: TxnDocType, docId: string): Promise<string | null> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT id::text AS id FROM documents WHERE document_type_id = $1 AND type::text = $2 AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC LIMIT 1`,
    [docId, TXN_DOC_TYPES[docType].documentsType],
  );
  return rows[0]?.id ?? null;
}

/** Writes the document row and the header column. Returns the transaction the document belonged to before, if another. */
async function stampDocument(manager: EntityManager, txnNo: string, txnType: TxnType, docType: TxnDocType, docId: string, docNo: string | null): Promise<string | null> {
  const before: Array<{ txn_no: string }> = await manager.query(
    `SELECT txn_no FROM transaction_documents WHERE doc_type = $1 AND doc_id = $2`,
    [docType, docId],
  );
  await manager.query(
    `INSERT INTO transaction_documents (txn_no, doc_type, doc_id, doc_no, approval_document_id, step, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (doc_type, doc_id) DO UPDATE SET
       txn_no = EXCLUDED.txn_no, doc_no = EXCLUDED.doc_no, step = EXCLUDED.step,
       approval_document_id = COALESCE(EXCLUDED.approval_document_id, transaction_documents.approval_document_id)`,
    [txnNo, docType, docId, docNo, await approvalDocumentId(manager, docType, docId), stepOfDoc(txnType, docType)],
  );
  await manager.query(`UPDATE ${ident(TXN_DOC_TYPES[docType].table)} SET txn_no = $1 WHERE id = $2`, [txnNo, docId]);
  const previous = before[0]?.txn_no ?? null;
  return previous && previous !== txnNo ? previous : null;
}

/**
 * Issues a new transaction number for the origin document of a deal, writes
 * `transactions`, the first `transaction_documents` row and the header
 * `txn_no`, and returns the number. Throws (and so fails the create) only on a
 * real error: unknown origin type, bad id, number space of the day exhausted.
 */
export async function openTransaction(manager: EntityManager, input: OpenTransactionInput): Promise<string> {
  const { type, origin } = input;
  if (!ORIGIN_DOC_TYPES[type]?.includes(origin.docType)) {
    throw new AppError(500, `A ${type} transaction cannot start with a ${origin.docType}`);
  }
  if (!isUuid(origin.docId)) throw new AppError(500, `Transaction origin id "${origin.docId}" is not a uuid`);

  // Opening twice for the same document (a retried create) returns the existing number.
  const existing = await txnNoOf(manager, origin.docType, origin.docId);
  if (existing) return existing;

  const prefix = prefixOf(type, origin.docType);
  const day = businessDateOf();
  const serial = await nextSerial(manager, txnSequenceScope(prefix, day.compact), SERIES.transaction, txnSeedPattern(prefix, day.compact));
  let txnNo: string;
  try {
    txnNo = formatTxnNo(prefix, day.compact, serial);
  } catch (error) {
    throw new AppError(500, error instanceof Error ? error.message : 'Transaction number could not be issued');
  }

  await manager.query(
    `INSERT INTO transactions
       (txn_no, txn_type, prefix, business_date, serial, origin_doc_type, origin_doc_id, company_id, location_id, to_location_id,
        party_type, party_id, party_name, status, stage, stage_label, opened_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Open', '', '', now(), now())`,
    [
      txnNo, type, prefix, day.date, serial, origin.docType, origin.docId,
      uuidOrNull(input.companyId), uuidOrNull(input.locationId), uuidOrNull(input.toLocationId),
      input.partyType ?? null, uuidOrNull(input.partyId), input.partyName?.trim() ? input.partyName.trim().slice(0, 255) : null,
    ],
  );
  await stampDocument(manager, txnNo, type, origin.docType, origin.docId, origin.docNo);
  await refreshTransaction(manager, txnNo);
  return txnNo;
}

/**
 * Copies the parent's transaction number onto a child document. A no-op
 * returning null when `txnNo` is empty (parent created before go-live) or
 * unknown; never throws for that reason.
 */
export async function attachToTransaction(manager: EntityManager, input: AttachInput): Promise<string | null> {
  const txnNo = input.txnNo?.trim();
  if (!txnNo) return null;
  if (!isUuid(input.docId) || !TXN_DOC_TYPES[input.docType]) {
    logger.warn(`Transactions: cannot attach ${input.docType} ${input.docId} to ${txnNo}`);
    return null;
  }
  const rows: Array<{ txn_type: TxnType }> = await manager.query(`SELECT txn_type FROM transactions WHERE txn_no = $1`, [txnNo]);
  if (!rows[0]) {
    logger.warn(`Transactions: ${input.docType} ${input.docId} references unknown transaction ${txnNo}`);
    return null;
  }
  const previous = await stampDocument(manager, txnNo, rows[0].txn_type, input.docType, input.docId, input.docNo);
  await refreshTransaction(manager, txnNo);
  if (previous) await refreshTransaction(manager, previous);
  return txnNo;
}

/** The transaction number stored on a document's header row, or null. */
export async function txnNoOf(manager: EntityManager, docType: TxnDocType, docId: string): Promise<string | null> {
  const info = TXN_DOC_TYPES[docType];
  if (!info || !isUuid(docId)) return null;
  const rows: Array<{ txn_no: string | null }> = await manager.query(`SELECT txn_no FROM ${ident(info.table)} WHERE id = $1`, [docId]);
  return rows[0]?.txn_no ?? null;
}

async function refreshOne(manager: EntityManager, txnNo: string): Promise<void> {
  const evaluation = await evaluateTransaction(manager, txnNo);
  if (!evaluation) return;
  const { docs, result, summary } = evaluation;
  // Keep the cached document number / approval id of each row current.
  for (const d of docs) {
    if (d.documentId || d.docNo) {
      await manager.query(
        `UPDATE transaction_documents SET doc_no = COALESCE($3::varchar, doc_no), approval_document_id = COALESCE($4::uuid, approval_document_id)
          WHERE doc_type = $1 AND doc_id = $2 AND (doc_no IS DISTINCT FROM COALESCE($3::varchar, doc_no) OR approval_document_id IS DISTINCT FROM COALESCE($4::uuid, approval_document_id))`,
        [d.docType, d.id, d.docNo, d.documentId],
      );
    }
  }

  await manager.query(
    `UPDATE transactions SET
       status = $2::varchar, stage = $3::varchar, stage_label = $4::varchar, summary = $5::jsonb,
       closed_at = CASE WHEN $2::varchar = 'Closed' THEN COALESCE(closed_at, now()) ELSE NULL END,
       cancelled_at = CASE WHEN $2::varchar = 'Cancelled' THEN COALESCE(cancelled_at, now()) ELSE NULL END,
       updated_at = now()
     WHERE txn_no = $1`,
    [txnNo, result.status, result.stage, result.stageLabel.slice(0, 80), JSON.stringify(summary)],
  );
}

/** Recomputes stage, status and summary of a transaction (and of a direct-sale partner). Never throws. */
export async function refreshTransaction(manager: EntityManager, txnNo: string): Promise<void> {
  if (!txnNo) return;
  await safely(manager, `refresh of ${txnNo}`, async () => {
    await refreshOne(manager, txnNo);
    // A direct-sale purchase closes on its Customer DC's delivery, so the partner moves too.
    const partners: Array<{ txn: string }> = await manager.query(
      `SELECT CASE WHEN from_txn = $1 THEN to_txn ELSE from_txn END AS txn FROM transaction_links
        WHERE kind = 'direct-sale' AND (from_txn = $1 OR to_txn = $1)`,
      [txnNo],
    );
    for (const partner of partners) if (partner.txn !== txnNo) await refreshOne(manager, partner.txn);
  });
}

/**
 * Refreshes the transaction of a document, given as a TxnDocType, a
 * `documents.type` (DocumentTypeEnum) or a dispatch type. Never throws.
 */
export async function refreshTransactionOf(manager: EntityManager, docType: TxnDocType | DocumentTypeEnum | string, docId: string | null | undefined): Promise<void> {
  const txnDocType = toTxnDocType(docType);
  if (!txnDocType || !isUuid(docId)) return;
  const txnNo = await safely(manager, `lookup of ${txnDocType} ${docId}`, () => txnNoOf(manager, txnDocType, docId));
  if (txnNo) await refreshTransaction(manager, txnNo);
}

/**
 * A direct-sale Customer DC (raised from a GRN delivered straight to the
 * customer) links the GRN's purchase to the DC's sale, kind `direct-sale`,
 * with the DC's quantity. Call after both numbers are stamped; safe to call
 * again on edit (the quantities are replaced). Never throws.
 */
export async function linkDirectSale(manager: EntityManager, dcId: string): Promise<void> {
  if (!isUuid(dcId)) return;
  await safely(manager, `direct-sale link of DC ${dcId}`, async () => {
    const itemDc = fkColumn(manager, Item, 'deliveryChallan');
    const rows: Array<{ dc_txn: string | null; grn_txn: string | null; batch_no: string | null; qty: string | null; kg: string | null }> = await manager.query(
      `SELECT dc.txn_no AS dc_txn, g.txn_no AS grn_txn, g."batchNo" AS batch_no,
              (SELECT SUM(it.quantity) FROM item it WHERE it.${itemDc} = dc.id AND it."deletedAt" IS NULL) AS qty,
              (SELECT SUM(it."netWeight") FROM item it WHERE it.${itemDc} = dc.id AND it."deletedAt" IS NULL) AS kg
         FROM delivery_challan_purchase dc JOIN grns g ON g.id = dc.grn_id
        WHERE dc.id = $1`,
      [dcId],
    );
    const row = rows[0];
    if (!row?.dc_txn || !row.grn_txn || row.dc_txn === row.grn_txn) return;
    await manager.query(
      `INSERT INTO transaction_links (from_txn, to_txn, kind, batch_no, qty, net_kg, created_at, updated_at)
       VALUES ($1, $2, 'direct-sale', $3, $4, $5, now(), now())
       ON CONFLICT (from_txn, to_txn, kind, batch_no) DO UPDATE SET qty = EXCLUDED.qty, net_kg = EXCLUDED.net_kg, updated_at = now()`,
      [row.grn_txn, row.dc_txn, (row.batch_no ?? '').trim().toUpperCase().slice(0, 100), Number(row.qty) || 0, Number(row.kg) || 0],
    );
  });
  // The purchase's "delivered to customer" step now depends on this DC.
  const grnTxn: Array<{ txn: string | null }> = await safely(manager, 'direct-sale partner lookup', () =>
    manager.query(`SELECT g.txn_no AS txn FROM delivery_challan_purchase dc JOIN grns g ON g.id = dc.grn_id WHERE dc.id = $1`, [dcId]),
  ) ?? [];
  if (grnTxn[0]?.txn) await refreshTransaction(manager, grnTxn[0].txn);
}
