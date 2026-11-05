/**
 * Transaction number of a GRN (docs/transaction-tracking-plan.md §9.4).
 *
 * A GRN raised against a Deal Slip joins the deal slip's purchase (R…); a GRN
 * without a Deal Slip starts its own purchase (G…). Everything is read from
 * the saved GRN row and its deal slip, never from the request body. Call
 * inside the DB transaction that saves the GRN, after the save.
 */

import { EntityManager } from 'typeorm';
import { attachToTransaction, openTransaction, refreshTransaction } from '../transactions/transaction.core';

export type GrnTxnAction = 'attach' | 'open' | 'detach' | 'none';

export interface GrnTxnFacts {
  /** The GRN's current `txn_no`. */
  grnTxnNo: string | null;
  /** The GRN references a deal slip. */
  hasDealSlip: boolean;
  /** The deal slip's `txn_no` (null for a slip created before go-live). */
  dealSlipTxnNo: string | null;
  /** True on create; an edit never opens a number for a GRN created before go-live. */
  creating: boolean;
}

/** What to do with the GRN's transaction number. Pure. */
export function grnTransactionAction(facts: GrnTxnFacts): GrnTxnAction {
  if (facts.hasDealSlip) {
    if (facts.dealSlipTxnNo) return facts.dealSlipTxnNo === facts.grnTxnNo ? 'none' : 'attach';
    // The new parent has no number: the GRN leaves the transaction it was in.
    return facts.grnTxnNo ? 'detach' : 'none';
  }
  if (facts.grnTxnNo) return 'none';
  return facts.creating ? 'open' : 'none';
}

interface GrnTxnRow {
  id: string;
  grn_no: string | null;
  txn_no: string | null;
  source: string | null;
  company_id: string | null;
  location_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  farmer_id: string | null;
  farmer_name: string | null;
  deal_slip_id: string | null;
  deal_slip_txn_no: string | null;
}

/**
 * Opens, attaches or detaches the GRN's transaction from its saved row.
 * Returns the GRN's transaction number afterwards. Throws only on a real
 * error of `openTransaction` (that fails the create, as it should).
 */
export async function stampGrnTransaction(manager: EntityManager, grnId: string, opts: { creating: boolean }): Promise<string | null> {
  const rows: GrnTxnRow[] = await manager.query(
    `SELECT g.id::text AS id, g."grnNo" AS grn_no, g.txn_no, g.source::text AS source,
            g.company_id::text AS company_id, g.purchaselocation_id::text AS location_id,
            g.vendor_id::text AS vendor_id, v.company_name AS vendor_name,
            g.farmer_id::text AS farmer_id,
            NULLIF(TRIM(CONCAT_WS(' ', f."farmerfName", f."farmermName", f."farmerlName")), '') AS farmer_name,
            ds.id::text AS deal_slip_id, ds.txn_no AS deal_slip_txn_no
       FROM grns g
       LEFT JOIN deal_slips ds ON ds.id = g.deal_slip_id
       LEFT JOIN vendor v ON v.id = g.vendor_id
       LEFT JOIN farmer f ON f.id = g.farmer_id
      WHERE g.id = $1::uuid`,
    [grnId],
  );
  const row = rows[0];
  if (!row) return null;

  const action = grnTransactionAction({
    grnTxnNo: row.txn_no,
    hasDealSlip: Boolean(row.deal_slip_id),
    dealSlipTxnNo: row.deal_slip_txn_no,
    creating: opts.creating,
  });

  switch (action) {
    case 'attach':
      return attachToTransaction(manager, { txnNo: row.deal_slip_txn_no, docType: 'grn', docId: row.id, docNo: row.grn_no });
    case 'open': {
      const farmer = row.source === 'farmer' || (!row.vendor_id && row.farmer_id);
      return openTransaction(manager, {
        type: 'purchase',
        origin: { docType: 'grn', docId: row.id, docNo: row.grn_no },
        companyId: row.company_id,
        locationId: row.location_id,
        partyType: farmer ? (row.farmer_id ? 'farmer' : null) : row.vendor_id ? 'vendor' : null,
        partyId: farmer ? row.farmer_id : row.vendor_id,
        partyName: farmer ? row.farmer_name : row.vendor_name,
      });
    }
    case 'detach': {
      const previous = row.txn_no as string;
      await manager.query(`DELETE FROM transaction_documents WHERE doc_type = 'grn' AND doc_id = $1::uuid`, [row.id]);
      await manager.query(`UPDATE grns SET txn_no = NULL WHERE id = $1::uuid`, [row.id]);
      await refreshTransaction(manager, previous);
      return null;
    }
    default:
      return row.txn_no;
  }
}
