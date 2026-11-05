/**
 * SQL pieces that tie stock movements to transactions (§9.4 *Stock*). Used by
 * the batch stock primitives, so it stays free of services and entities: the
 * table names come from the constant TXN_DOC_TYPES map, values are bound.
 */

import { CONSUME_LINK_KIND, toTxnDocType, TxnLinkKind, txnTableOf } from './transaction.types';

/**
 * `(SELECT txn_no FROM <header table of docType> WHERE id = <param>)`, or null
 * when the document type carries no transaction number (adjustment, repack …).
 * `param` is a bound placeholder such as `$25`.
 */
export function txnNoSubquerySql(docType: string | null | undefined, param: string): string | null {
  const table = txnTableOf(docType);
  return table ? `(SELECT th.txn_no FROM "${table}" th WHERE th.id = ${param}::uuid)` : null;
}

/** Link kind written when a document of this type consumes a batch, or null. */
export function consumeLinkKindOf(docType: string | null | undefined): TxnLinkKind | null {
  const txnDocType = toTxnDocType(docType);
  return txnDocType ? CONSUME_LINK_KIND[txnDocType] ?? null : null;
}

/**
 * One allocation consumed: adds `qty` / `net_kg` to the link from the batch's
 * origin transaction to the consuming document's transaction. Writes nothing
 * when either side has no number, or when both are the same transaction.
 * Params: $1 stock_batch id, $2 document id, $3 kind, $4 qty, $5 net kg.
 */
export function consumeLinkSql(docType: string): string | null {
  const table = txnTableOf(docType);
  if (!table) return null;
  return `INSERT INTO transaction_links (from_txn, to_txn, kind, batch_no, qty, net_kg, created_at, updated_at)
          SELECT b.origin_txn_no, h.txn_no, $3, b.batch_no, $4, $5, now(), now()
            FROM stock_batch b, "${table}" h
           WHERE b.id = $1::uuid AND h.id = $2::uuid
             AND b.origin_txn_no IS NOT NULL AND h.txn_no IS NOT NULL AND b.origin_txn_no <> h.txn_no
          ON CONFLICT (from_txn, to_txn, kind, batch_no) DO UPDATE SET
            qty = transaction_links.qty + EXCLUDED.qty,
            net_kg = transaction_links.net_kg + EXCLUDED.net_kg,
            updated_at = now()`;
}
