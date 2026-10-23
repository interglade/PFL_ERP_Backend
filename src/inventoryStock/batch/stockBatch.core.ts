/**
 * Batch stock primitives (Phase C1–C4 of docs/stock-implementation-plan.md).
 *
 * Every function takes the caller's transactional EntityManager and writes
 * with atomic, column-relative SQL, so a movement commits or rolls back with
 * the document that caused it. Rows are always locked in a stable order
 * (stock key / batch id) to avoid deadlocks between concurrent documents.
 *
 *   postIn          — Inward / Repack-in / Adjustment-in: adds to a batch row
 *                     (created on first use), recomputes its unit cost.
 *   reserveLines    — a pending stock-out document holds batch quantity:
 *                     the requested batches, or oldest first (FIFO).
 *   releaseDocument — the document was rejected / deleted / re-entered.
 *   consumeDocument — the document was approved: reserved quantity leaves
 *                     stock at the batch's cost.
 * Every movement writes one `stock_ledger` row.
 */

import { EntityManager } from 'typeorm';
import AppError from '../../utils/appError';
import { returnedRows } from '../../utils/queryRows';
import { StockMovementType } from './stockLedger.entity';
import { StockOriginType, StockType } from './stockBatch.entity';

export interface BatchKey {
  companyId: string;
  locationId: string;
  productId: string;
  variantId: string | null;
  uomId: string | null;
  batchNo: string;
  stockType: StockType;
}

export interface DocRef {
  /** DocumentTypeEnum value or another stable document label. */
  type: string;
  id: string | null;
  no: string | null;
  lineId?: string | null;
}

const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

export function stockKeyOf(k: BatchKey): string {
  return [k.companyId, k.locationId, k.productId, k.variantId ?? '-', k.uomId ?? '-', k.batchNo.trim().toUpperCase(), k.stockType].join('|');
}

async function writeLedger(
  manager: EntityManager,
  row: {
    batchId: string;
    key: BatchKey;
    movementType: StockMovementType;
    doc: DocRef;
    qtyIn?: number;
    qtyOut?: number;
    kgIn?: number;
    kgOut?: number;
    valueIn?: number;
    valueOut?: number;
    after: { qty: unknown; kg: unknown; value: unknown };
    postedBy?: string | null;
    remark?: string | null;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO stock_ledger
       (posted_at, posted_by, stock_batch_id, company_id, location_id, product_id, variant_id, uom_id, batch_no, stock_type,
        movement_type, doc_type, doc_id, doc_no, doc_line_id, qty_in, qty_out, kg_in, kg_out, value_in, value_out,
        qty_after, kg_after, value_after, remark)
     VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      row.postedBy ?? null, row.batchId, row.key.companyId, row.key.locationId, row.key.productId, row.key.variantId,
      row.key.uomId, row.key.batchNo, row.key.stockType, row.movementType, row.doc.type, row.doc.id, row.doc.no,
      row.doc.lineId ?? null, round3(row.qtyIn ?? 0), round3(row.qtyOut ?? 0), round3(row.kgIn ?? 0), round3(row.kgOut ?? 0),
      round2(row.valueIn ?? 0), round2(row.valueOut ?? 0), num(row.after.qty), num(row.after.kg), num(row.after.value),
      row.remark ?? null,
    ],
  );
}

/** Adds `qty` (units) / `kg` / `value` to the batch row of `key`, creating it on first use. Returns the batch id. */
export async function postIn(
  manager: EntityManager,
  input: BatchKey & {
    qty: number;
    kg: number;
    value: number;
    originType: StockOriginType;
    originId?: string | null;
    originNo?: string | null;
    movementType: StockMovementType;
    doc: DocRef;
    postedBy?: string | null;
    remark?: string | null;
  },
): Promise<string> {
  const qty = round3(input.qty);
  const kg = round3(input.kg);
  const value = round2(input.value);
  if (qty <= 0 && kg <= 0) return '';
  const key: BatchKey = { ...input, batchNo: input.batchNo.trim().toUpperCase() };
  const rows: Array<{ id: string; qty: string; net_kg: string; value: string }> = await manager.query(
    `INSERT INTO stock_batch
       (stock_key, company_id, location_id, product_id, variant_id, uom_id, batch_no, stock_type,
        origin_type, origin_id, origin_no, qty, reserved_qty, net_kg, value, unit_cost,
        first_in_at, last_movement_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, $13, $14,
             CASE WHEN $12::numeric > 0 THEN $14::numeric / $12::numeric ELSE 0 END,
             now(), now(), now(), now())
     ON CONFLICT (stock_key) DO UPDATE SET
       qty = stock_batch.qty + EXCLUDED.qty,
       net_kg = stock_batch.net_kg + EXCLUDED.net_kg,
       value = stock_batch.value + EXCLUDED.value,
       unit_cost = CASE WHEN stock_batch.qty + EXCLUDED.qty > 0
                        THEN (stock_batch.value + EXCLUDED.value) / (stock_batch.qty + EXCLUDED.qty)
                        ELSE stock_batch.unit_cost END,
       first_in_at = COALESCE(stock_batch.first_in_at, now()),
       last_movement_at = now(),
       updated_at = now()
     RETURNING id::text AS id, qty, net_kg, value`,
    [
      stockKeyOf(key), key.companyId, key.locationId, key.productId, key.variantId, key.uomId, key.batchNo, key.stockType,
      input.originType, input.originId ?? null, input.originNo ?? null, qty, kg, value,
    ],
  );
  const row = rows[0];
  await writeLedger(manager, {
    batchId: row.id, key, movementType: input.movementType, doc: input.doc,
    qtyIn: qty, kgIn: kg, valueIn: value, after: { qty: row.qty, kg: row.net_kg, value: row.value },
    postedBy: input.postedBy, remark: input.remark,
  });
  return row.id;
}

export interface AllocationRequest {
  stockBatchId: string;
  qty: number;
}

export interface ReserveLine {
  lineId: string | null;
  productId: string;
  variantId: string | null;
  uomId: string | null;
  /** quantity of the line in its unit */
  qty: number;
  /** net kg of the line (split over the allocations by quantity) */
  kg: number;
  label: string;
  /** Batches chosen by the user; FIFO (oldest first) when absent. */
  requested?: AllocationRequest[] | null;
}

interface CandidateBatch {
  id: string;
  batch_no: string;
  qty: string;
  reserved_qty: string;
}

/**
 * Holds batch quantity for every line of a pending stock-out document.
 * Throws 400 (nothing written) when a line cannot be covered.
 */
export async function reserveLines(
  manager: EntityManager,
  input: {
    doc: DocRef;
    companyId: string;
    locationId: string;
    stockType: StockType;
    lines: ReserveLine[];
  },
): Promise<void> {
  // Stable lock order across documents: by product / variant / unit.
  const lines = [...input.lines].sort((a, b) =>
    `${a.productId}|${a.variantId ?? ''}|${a.uomId ?? ''}`.localeCompare(`${b.productId}|${b.variantId ?? ''}|${b.uomId ?? ''}`),
  );
  const errors: string[] = [];
  const plan: Array<{ line: ReserveLine; batch: CandidateBatch; qty: number }> = [];

  for (const line of lines) {
    const need = round3(line.qty);
    if (need <= 0) continue;
    const candidates: CandidateBatch[] = await manager.query(
      `SELECT id::text AS id, batch_no, qty, reserved_qty FROM stock_batch
        WHERE company_id = $1 AND location_id = $2 AND product_id = $3
          AND variant_id IS NOT DISTINCT FROM $4 AND uom_id IS NOT DISTINCT FROM $5 AND stock_type = $6
        ORDER BY id FOR UPDATE`,
      [input.companyId, input.locationId, line.productId, line.variantId, line.uomId, input.stockType],
    );
    // FIFO order (oldest first in) for the automatic pick; locks were taken by id.
    const fifo: CandidateBatch[] = await manager.query(
      `SELECT id::text AS id FROM stock_batch WHERE id = ANY($1::uuid[]) ORDER BY first_in_at NULLS LAST, created_at, id`,
      [candidates.map((c) => c.id)],
    );
    const ordered = fifo.map((f) => candidates.find((c) => c.id === f.id)!).filter(Boolean);
    // Quantity already planned for earlier lines of this document on the same batch.
    const plannedOn = (batchId: string) => plan.filter((p) => p.batch.id === batchId).reduce((s, p) => s + p.qty, 0);
    const free = (b: CandidateBatch) => round3(num(b.qty) - num(b.reserved_qty) - plannedOn(b.id));

    if (line.requested && line.requested.length) {
      let total = 0;
      for (const req of line.requested) {
        const batch = ordered.find((b) => b.id === req.stockBatchId);
        const qty = round3(num(req.qty));
        if (qty <= 0) continue;
        if (!batch) {
          errors.push(`${line.label}: the chosen batch is not stock of this product, unit and location`);
          continue;
        }
        if (qty > free(batch)) {
          errors.push(`${line.label}: batch ${batch.batch_no} has only ${Math.max(free(batch), 0)} available; ${qty} chosen`);
          continue;
        }
        plan.push({ line, batch, qty });
        total = round3(total + qty);
      }
      if (round3(total) !== need) errors.push(`${line.label}: the batches add up to ${total}, the line needs ${need}`);
      continue;
    }

    // What each batch can still give before this line takes anything (for the error message).
    const freeBefore = ordered.map((b) => ({ batch: b, free: free(b) }));
    let left = need;
    for (const batch of ordered) {
      if (left <= 0) break;
      const take = round3(Math.min(free(batch), left));
      if (take <= 0) continue;
      plan.push({ line, batch, qty: take });
      left = round3(left - take);
    }
    if (left > 0) {
      const available = round3(need - left);
      const detail = freeBefore.filter((f) => f.free > 0).map((f) => `${f.batch.batch_no}: ${f.free}`).join(', ');
      errors.push(`${line.label}: ${need} needed but only ${available} available${detail ? ` (${detail})` : ''}`);
    }
  }

  if (errors.length) throw new AppError(400, `Insufficient stock: ${errors.join('; ')}`);

  for (const p of plan) {
    await manager.query(`UPDATE stock_batch SET reserved_qty = reserved_qty + $2, updated_at = now() WHERE id = $1`, [p.batch.id, p.qty]);
    const lineQty = round3(p.line.qty);
    const kgShare = lineQty > 0 ? round3((p.line.kg * p.qty) / lineQty) : 0;
    await manager.query(
      `INSERT INTO stock_allocation (doc_type, doc_id, doc_no, line_id, stock_batch_id, batch_no, qty, net_kg, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RESERVED', now(), now())`,
      [input.doc.type, input.doc.id, input.doc.no, p.line.lineId, p.batch.id, p.batch.batch_no, p.qty, kgShare],
    );
  }
}

/** Gives back what a pending document holds (rejected, deleted or lines re-entered). */
export async function releaseDocument(manager: EntityManager, docType: string, docId: string): Promise<void> {
  await manager.query(
    `UPDATE stock_batch b SET reserved_qty = GREATEST(b.reserved_qty - a.qty, 0), updated_at = now()
       FROM (SELECT stock_batch_id, SUM(qty) AS qty FROM stock_allocation
              WHERE doc_type = $1 AND doc_id = $2 AND status = 'RESERVED' GROUP BY stock_batch_id) a
      WHERE b.id = a.stock_batch_id`,
    [docType, docId],
  );
  await manager.query(
    `UPDATE stock_allocation SET status = 'RELEASED', updated_at = now() WHERE doc_type = $1 AND doc_id = $2 AND status = 'RESERVED'`,
    [docType, docId],
  );
}

/** True when the document has allocations (reserved or already consumed). */
export async function hasAllocations(manager: EntityManager, docType: string, docId: string): Promise<boolean> {
  const rows: Array<{ n: string }> = await manager.query(
    `SELECT COUNT(*) AS n FROM stock_allocation WHERE doc_type = $1 AND doc_id = $2 AND status IN ('RESERVED', 'CONSUMED')`,
    [docType, docId],
  );
  return num(rows[0]?.n) > 0;
}

/** The approved document takes its reserved quantity out of stock, at each batch's cost. */
export async function consumeDocument(
  manager: EntityManager,
  input: { docType: string; docId: string; docNo: string | null; movementType: StockMovementType; postedBy?: string | null },
): Promise<{ qty: number; kg: number; value: number }> {
  const totals = { qty: 0, kg: 0, value: 0 };
  const allocations: Array<{ id: string; line_id: string | null; stock_batch_id: string; qty: string; net_kg: string }> = await manager.query(
    `SELECT id::text AS id, line_id::text AS line_id, stock_batch_id::text AS stock_batch_id, qty, net_kg
       FROM stock_allocation WHERE doc_type = $1 AND doc_id = $2 AND status = 'RESERVED' ORDER BY stock_batch_id, id`,
    [input.docType, input.docId],
  );
  for (const a of allocations) {
    const batches: Array<{
      id: string; company_id: string; location_id: string; product_id: string; variant_id: string | null; uom_id: string | null;
      batch_no: string; stock_type: StockType; qty: string; net_kg: string; value: string; unit_cost: string;
    }> = await manager.query(
      `SELECT id::text AS id, company_id::text AS company_id, location_id::text AS location_id, product_id::text AS product_id,
              variant_id::text AS variant_id, uom_id::text AS uom_id, batch_no, stock_type, qty, net_kg, value, unit_cost
         FROM stock_batch WHERE id = $1 FOR UPDATE`,
      [a.stock_batch_id],
    );
    const b = batches[0];
    if (!b) throw new AppError(409, 'A reserved stock batch no longer exists');
    const qty = round3(num(a.qty));
    const onHand = round3(num(b.qty));
    if (qty > onHand) throw new AppError(409, `Batch ${b.batch_no} has only ${onHand} left; ${qty} was reserved`);
    const unitCost = onHand > 0 ? num(b.value) / onHand : num(b.unit_cost);
    const emptied = round3(onHand - qty) <= 0;
    const valueOut = emptied ? round2(num(b.value)) : round2(qty * unitCost);
    const kgOut = emptied ? round3(num(b.net_kg)) : Math.min(round3(num(a.net_kg)), round3(num(b.net_kg)));

    const after = returnedRows<{ qty: string; net_kg: string; value: string }>(
      await manager.query(
        `UPDATE stock_batch SET
           qty = qty - $2, reserved_qty = GREATEST(reserved_qty - $2, 0),
           net_kg = GREATEST(net_kg - $3, 0), value = GREATEST(value - $4, 0),
           last_movement_at = now(), updated_at = now()
         WHERE id = $1 RETURNING qty, net_kg, value`,
        [b.id, qty, kgOut, valueOut],
      ),
    );
    await manager.query(
      `UPDATE stock_allocation SET status = 'CONSUMED', unit_cost = $2, updated_at = now() WHERE id = $1`,
      [a.id, round2(unitCost * 10000) / 10000],
    );
    await writeLedger(manager, {
      batchId: b.id,
      key: {
        companyId: b.company_id, locationId: b.location_id, productId: b.product_id, variantId: b.variant_id,
        uomId: b.uom_id, batchNo: b.batch_no, stockType: b.stock_type,
      },
      movementType: input.movementType,
      doc: { type: input.docType, id: input.docId, no: input.docNo, lineId: a.line_id },
      qtyOut: qty, kgOut, valueOut,
      after: { qty: after[0]?.qty, kg: after[0]?.net_kg, value: after[0]?.value },
      postedBy: input.postedBy,
    });
    totals.qty = round3(totals.qty + qty);
    totals.kg = round3(totals.kg + kgOut);
    totals.value = round2(totals.value + valueOut);
  }
  return totals;
}
