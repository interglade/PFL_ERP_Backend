/**
 * Approval outcome of Stock Adjustments (C10) and Repacks (C9): called by the
 * approval engine when the document reaches COMPLETE (stock moves) or is
 * rejected (held stock released). Kept apart from the service so the stock
 * movement service can import it without pulling in the approval services.
 */

import { EntityManager } from 'typeorm';
import AppError from '../../utils/appError';
import { DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import type { StockMovement } from '../service/inventoryMovement.service';
import { consumeDocument, postIn, releaseDocument } from '../batch/stockBatch.core';
import { StockType } from '../batch/stockBatch.entity';
import { StockAdjustment, StockRepack } from './stockAdjustment.entity';

/** Allocation / ledger document types (same strings as the approval document types). */
export const ADJUSTMENT_DOC = DocumentTypeEnum.STOCK_ADJUSTMENT;
export const REPACK_DOC = DocumentTypeEnum.STOCK_REPACK;

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export interface BatchRow {
  id: string;
  company_id: string;
  location_id: string;
  product_id: string;
  variant_id: string | null;
  uom_id: string | null;
  batch_no: string;
  stock_type: StockType;
  qty: string;
  reserved_qty: string;
  net_kg: string;
  unit_cost: string;
}

/** Applies kg / value to the `inventory_stock` roll-up (InventoryMovementService.applyManualAdjustment). */
export interface RollUpApplier {
  applyManualAdjustment(movements: StockMovement[], manager: EntityManager): Promise<void>;
}

export async function loadBatch(manager: EntityManager, id: string): Promise<BatchRow> {
  const rows: BatchRow[] = await manager.query(
    `SELECT id::text AS id, company_id::text AS company_id, location_id::text AS location_id, product_id::text AS product_id,
            variant_id::text AS variant_id, uom_id::text AS uom_id, batch_no, stock_type, qty, reserved_qty, net_kg, unit_cost
       FROM stock_batch WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'Stock batch not found');
  return rows[0];
}

function rollUp(
  key: { company_id: string; location_id: string; product_id: string; variant_id: string | null },
  kgDelta: number,
  valueDelta: number,
): StockMovement[] {
  if (!kgDelta && !valueDelta) return [];
  return [{
    companyId: key.company_id, locationId: key.location_id, productId: key.product_id, variantId: key.variant_id,
    qtyDelta: round3(kgDelta), amtDelta: round2(valueDelta),
  }];
}

// ─── Approval outcome (called by the approval engine) ───────────────────────

/**
 * The Stock Adjustment reached COMPLETE (both approval levels, like the Dump
 * Register): its stock moves. Runs inside the approval's transaction.
 */
export async function applyApprovedAdjustment(manager: EntityManager, rollUpApplier: RollUpApplier, id: string, userId: string | null): Promise<void> {
  const repo = manager.getRepository(StockAdjustment);
  await manager.query(`SELECT id FROM stock_adjustment WHERE id = $1 FOR UPDATE`, [id]);
  const adj = await repo.findOneBy({ id });
  if (!adj || adj.status !== 'PENDING') return;

  const qtyDelta = num(adj.qtyDelta);
  const key = { company_id: adj.companyId, location_id: adj.locationId, product_id: adj.productId, variant_id: adj.variantId };
  let valueDelta: number;
  if (qtyDelta < 0) {
    const out = await consumeDocument(manager, { docType: ADJUSTMENT_DOC, docId: adj.id, docNo: adj.adjustmentNo, movementType: 'ADJUSTMENT', postedBy: userId });
    valueDelta = -out.value;
    await rollUpApplier.applyManualAdjustment(rollUp(key, -out.kg, -out.value), manager);
  } else {
    const batch = adj.stockBatchId ? await loadBatch(manager, adj.stockBatchId) : null;
    const unitCost = adj.unitCost !== null ? num(adj.unitCost) : batch ? num(batch.unit_cost) : 0;
    valueDelta = round2(qtyDelta * unitCost);
    await postIn(manager, {
      companyId: adj.companyId, locationId: adj.locationId, productId: adj.productId, variantId: adj.variantId,
      uomId: adj.uomId, batchNo: adj.batchNo, stockType: adj.stockType as StockType,
      qty: qtyDelta, kg: num(adj.kgDelta), value: valueDelta,
      originType: adj.reason === 'OPENING' ? 'OPENING' : 'ADJUSTMENT', originId: adj.id, originNo: adj.adjustmentNo,
      movementType: adj.reason === 'OPENING' ? 'OPENING' : 'ADJUSTMENT',
      doc: { type: ADJUSTMENT_DOC, id: adj.id, no: adj.adjustmentNo }, postedBy: userId, remark: adj.remark,
    });
    await rollUpApplier.applyManualAdjustment(rollUp(key, num(adj.kgDelta), valueDelta), manager);
  }
  Object.assign(adj, { status: 'APPROVED', valueDelta: String(valueDelta), decidedBy: userId, decidedAt: new Date() });
  await repo.save(adj);
}

/** The Repack reached COMPLETE: the from-quantity leaves, the to-quantity arrives in the same batch, value carried. */
export async function applyApprovedRepack(manager: EntityManager, rollUpApplier: RollUpApplier, id: string, userId: string | null): Promise<void> {
  const repo = manager.getRepository(StockRepack);
  await manager.query(`SELECT id FROM stock_repack WHERE id = $1 FOR UPDATE`, [id]);
  const rp = await repo.findOneBy({ id });
  if (!rp || rp.status !== 'PENDING') return;

  const batch = await loadBatch(manager, rp.stockBatchId);
  const out = await consumeDocument(manager, { docType: REPACK_DOC, docId: rp.id, docNo: rp.repackNo, movementType: 'REPACK_OUT', postedBy: userId });
  await postIn(manager, {
    companyId: batch.company_id, locationId: batch.location_id, productId: batch.product_id, variantId: batch.variant_id,
    uomId: rp.toUomId, batchNo: batch.batch_no, stockType: batch.stock_type,
    qty: num(rp.toQty), kg: num(rp.toKg), value: out.value,
    originType: 'REPACK', originId: rp.id, originNo: rp.repackNo, movementType: 'REPACK_IN',
    doc: { type: REPACK_DOC, id: rp.id, no: rp.repackNo }, postedBy: userId, remark: rp.remark,
  });
  // Roll-up: value stays; net kg changes by the repack loss.
  await rollUpApplier.applyManualAdjustment(rollUp(batch, round3(num(rp.toKg) - out.kg), 0), manager);
  Object.assign(rp, { status: 'APPROVED', value: String(out.value), decidedBy: userId, decidedAt: new Date() });
  await repo.save(rp);
}

/** The Stock Adjustment / Repack was rejected: whatever it held goes back. */
export async function applyRejectedAdjustmentOrRepack(
  manager: EntityManager,
  type: DocumentTypeEnum,
  id: string,
  userId: string | null,
  reason?: string | null,
): Promise<void> {
  const table = type === DocumentTypeEnum.STOCK_ADJUSTMENT ? 'stock_adjustment' : type === DocumentTypeEnum.STOCK_REPACK ? 'stock_repack' : null;
  if (!table) return;
  await releaseDocument(manager, type, id);
  await manager.query(
    `UPDATE ${table} SET status = 'REJECTED', decided_by = $2, decided_at = now(), decision_remark = $3, updated_at = now()
      WHERE id = $1 AND status = 'PENDING'`,
    [id, userId, reason ?? null],
  );
}

