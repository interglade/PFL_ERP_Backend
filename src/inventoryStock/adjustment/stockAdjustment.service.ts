import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { compactDate, nextDocumentNumber, SERIES } from '../../global/numbering/documentNumber';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { DocumentTypeEnum as DocDefEnum } from '../../documentDef/entity/documentdef.entity';
import { DocumentbService } from '../../approvalFlow/service/documentb.service';
import { ApprovalFlowService } from '../../approvalFlow/service/approvalFlow.service';
import { CreatedWithApproval, withApproval } from '../../utils/approvalMessage';
import { reserveLines } from '../batch/stockBatch.core';
import { StockType } from '../batch/stockBatch.entity';
import { ADJUSTMENT_REASONS, AdjustmentReason, StockAdjustment, StockRepack } from './stockAdjustment.entity';
import { ADJUSTMENT_DOC, BatchRow, loadBatch, REPACK_DOC } from './stockAdjustment.apply';

export { ADJUSTMENT_DOC, REPACK_DOC } from './stockAdjustment.apply';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;


export interface CreateAdjustmentInput {
  stockBatchId?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  uomId?: string | null;
  batchNo?: string | null;
  stockType?: string | null;
  qtyDelta: number;
  kgDelta?: number | null;
  unitCost?: number | null;
  reason: string;
  remark?: string | null;
}

export interface CreateRepackInput {
  stockBatchId: string;
  fromQty: number;
  fromKg?: number | null;
  toUomId: string;
  toQty: number;
  toKg?: number | null;
  remark?: string | null;
}

/**
 * C9 Repack and C10 Stock Adjustment. Both are approval documents
 * (`stock-repack`, `stock-adjustment`) that follow the creator's Operation
 * approval flow with two approval levels, exactly like the Dump Register
 * (client decision 2026-10-15). Creating one holds the stock it takes;
 * the stock moves when the document reaches COMPLETE
 * (InventoryMovementService) and is released when it is rejected.
 */
@injectable()
export class StockAdjustmentService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.DocumentbService) private readonly documentbService: DocumentbService,
    @inject(TYPES.ApprovalFlowService) private readonly approvalFlowService: ApprovalFlowService,
  ) {}

  /** Same guard as the Dump / Inward registers: the creator needs an Operation approval flow. */
  private async assertApprovalFlow(userId: string): Promise<void> {
    const flow = await this.approvalFlowService.getApprovalFlowForUserAndDepartment(userId, DocDefEnum.OPERATION);
    if (!flow) {
      throw new AppError(400, `Approval flow not configured for user. Please configure approval flow for ${DocDefEnum.OPERATION} type documents before creating.`);
    }
  }

  private async openApproval(type: DocumentTypeEnum, recordId: string, userId: string) {
    const document = await this.documentbService.createDocument({
      type,
      docDef: DocDefEnum.OPERATION,
      status: DocumentStatus.HOLD,
      remarks: `Document auto-created with ${type === DocumentTypeEnum.STOCK_ADJUSTMENT ? 'Stock Adjustment' : 'Repack'}`,
      lastActionBy: { id: userId },
      document_type_id: recordId,
    });
    return this.documentbService.startApprovalFlow(document.id);
  }

  // ─── C10 Stock Adjustment ────────────────────────────────────────────────

  async createAdjustment(input: CreateAdjustmentInput, userId: string): Promise<CreatedWithApproval<StockAdjustment>> {
    const qtyDelta = round3(num(input.qtyDelta));
    if (!qtyDelta) throw new AppError(400, 'Enter the quantity to add (+) or remove (−)');
    if (!ADJUSTMENT_REASONS.includes(input.reason as AdjustmentReason)) {
      throw new AppError(400, `Reason must be one of ${ADJUSTMENT_REASONS.join(', ')}`);
    }
    await this.assertApprovalFlow(userId);
    const saved = await this.dataSource.transaction(async (manager) => {
      let key: Omit<BatchRow, 'id' | 'qty' | 'reserved_qty' | 'net_kg' | 'unit_cost'>;
      let batch: BatchRow | null = null;
      if (input.stockBatchId) {
        batch = await loadBatch(manager, input.stockBatchId);
        key = batch;
      } else {
        if (qtyDelta < 0) throw new AppError(400, 'Choose the batch to remove stock from');
        if (!input.companyId || !input.locationId || !input.productId || !input.batchNo) {
          throw new AppError(400, 'Company, location, product and batch no are required for a new batch');
        }
        key = {
          company_id: input.companyId, location_id: input.locationId, product_id: input.productId,
          variant_id: input.variantId ?? null, uom_id: input.uomId ?? null, batch_no: input.batchNo.trim().toUpperCase(),
          stock_type: (input.stockType === 'RETURNED' ? 'RETURNED' : 'FRESH') as StockType,
        };
      }
      // kg: given, else in proportion to the batch (kg per unit), else 0.
      const kgPerUnit = batch && num(batch.qty) > 0 ? num(batch.net_kg) / num(batch.qty) : 0;
      const kgDelta = input.kgDelta !== null && input.kgDelta !== undefined && (input.kgDelta as unknown) !== ''
        ? round3(num(input.kgDelta))
        : round3(qtyDelta * kgPerUnit);

      const repo = manager.getRepository(StockAdjustment);
      const created = await repo.save(repo.create({
        adjustmentNo: await nextDocumentNumber(manager, SERIES.stockAdjustment, `ADJ${compactDate()}`, 4),
        stockBatchId: batch?.id ?? null,
        companyId: key.company_id, locationId: key.location_id, productId: key.product_id, variantId: key.variant_id,
        uomId: key.uom_id, batchNo: key.batch_no, stockType: key.stock_type,
        qtyDelta: String(qtyDelta), kgDelta: String(kgDelta),
        unitCost: input.unitCost === null || input.unitCost === undefined ? null : String(num(input.unitCost)),
        reason: input.reason, remark: input.remark ?? null, status: 'PENDING', requestedBy: userId,
      }));

      // A reduction holds its quantity while pending, so no DC can take it meanwhile.
      if (qtyDelta < 0 && batch) {
        await reserveLines(manager, {
          doc: { type: ADJUSTMENT_DOC, id: created.id, no: created.adjustmentNo },
          companyId: batch.company_id, locationId: batch.location_id, stockType: batch.stock_type,
          lines: [{
            lineId: null, productId: batch.product_id, variantId: batch.variant_id, uomId: batch.uom_id,
            qty: -qtyDelta, kg: -kgDelta, label: `Batch ${batch.batch_no}`,
            requested: [{ stockBatchId: batch.id, qty: -qtyDelta }],
          }],
        });
      }
      return created;
    });
    return withApproval(saved, await this.openApproval(DocumentTypeEnum.STOCK_ADJUSTMENT, saved.id, userId));
  }

  // ─── C9 Repack ───────────────────────────────────────────────────────────

  async createRepack(input: CreateRepackInput, userId: string): Promise<CreatedWithApproval<StockRepack>> {
    const fromQty = round3(num(input.fromQty));
    const toQty = round3(num(input.toQty));
    if (fromQty <= 0 || toQty <= 0) throw new AppError(400, 'Enter the quantity to repack and the quantity it becomes');
    if (!input.toUomId) throw new AppError(400, 'Choose the unit to repack into');
    await this.assertApprovalFlow(userId);
    const saved = await this.dataSource.transaction(async (manager) => {
      const batch = await loadBatch(manager, input.stockBatchId);
      if (batch.uom_id === input.toUomId) throw new AppError(400, 'Choose a different unit than the batch is in');
      const kgPerUnit = num(batch.qty) > 0 ? num(batch.net_kg) / num(batch.qty) : 0;
      const fromKg = input.fromKg !== null && input.fromKg !== undefined ? round3(num(input.fromKg)) : round3(fromQty * kgPerUnit);
      const toKg = input.toKg !== null && input.toKg !== undefined ? round3(num(input.toKg)) : fromKg;

      const repo = manager.getRepository(StockRepack);
      const created = await repo.save(repo.create({
        repackNo: await nextDocumentNumber(manager, SERIES.stockRepack, `RPK${compactDate()}`, 4),
        stockBatchId: batch.id, fromQty: String(fromQty), fromKg: String(fromKg), toUomId: input.toUomId,
        toQty: String(toQty), toKg: String(toKg), lossKg: String(round3(fromKg - toKg)),
        remark: input.remark ?? null, status: 'PENDING', requestedBy: userId,
      }));
      // The from-quantity is held while the repack is pending.
      await reserveLines(manager, {
        doc: { type: REPACK_DOC, id: created.id, no: created.repackNo },
        companyId: batch.company_id, locationId: batch.location_id, stockType: batch.stock_type,
        lines: [{
          lineId: null, productId: batch.product_id, variantId: batch.variant_id, uomId: batch.uom_id,
          qty: fromQty, kg: fromKg, label: `Batch ${batch.batch_no}`, requested: [{ stockBatchId: batch.id, qty: fromQty }],
        }],
      });
      return created;
    });
    return withApproval(saved, await this.openApproval(DocumentTypeEnum.STOCK_REPACK, saved.id, userId));
  }

  // ─── Lists ───────────────────────────────────────────────────────────────

  async list(kind: 'adjustment' | 'repack', f: { status?: string | null; locationId?: string | null; page?: number; limit?: number }) {
    const page = Math.max(1, Math.floor(Number(f.page) || 1));
    const limit = Math.min(200, Math.max(1, Math.floor(Number(f.limit) || 25)));
    const params: unknown[] = [kind === 'adjustment' ? DocumentTypeEnum.STOCK_ADJUSTMENT : DocumentTypeEnum.STOCK_REPACK];
    const where: string[] = [];
    if (f.status) { params.push(f.status); where.push(`t.status = $${params.length}`); }
    if (f.locationId) { params.push(f.locationId); where.push(`${kind === 'adjustment' ? 't.location_id' : 'b.location_id'} = $${params.length}`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // The approval document (for the approve / reject actions and the approval status).
    const approval = `LEFT JOIN LATERAL (SELECT d.id::text AS id, d.status::text AS status FROM documents d
                        WHERE d.document_type_id = t.id::text AND d.type::text = $1 ORDER BY d."createdAt" DESC LIMIT 1) doc ON true`;
    if (kind === 'adjustment') {
      const total: Array<{ n: string }> = await this.dataSource.query(`SELECT COUNT(*) AS n FROM stock_adjustment t ${clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) - 1}`)}`, params.slice(1));
      const data = await this.dataSource.query(
        `SELECT t.id::text AS id, t.adjustment_no AS "adjustmentNo", t.batch_no AS "batchNo", t.stock_type AS "stockType",
                t.stock_batch_id::text AS "stockBatchId", br.name AS "locationName", p.product_name AS "productName",
                v."variantName" AS "variantName", u.unit AS "uomName", t.qty_delta::float AS "qtyDelta", t.kg_delta::float AS "kgDelta",
                t.unit_cost::float AS "unitCost", t.value_delta::float AS "valueDelta", t.reason, t.remark, t.status,
                t.requested_by::text AS "requestedBy", t.decided_by::text AS "decidedBy", t.decided_at AS "decidedAt",
                t.decision_remark AS "decisionRemark", t.created_at AS "createdAt",
                doc.id AS "documentId", doc.status AS "approvalStatus"
           FROM stock_adjustment t
           LEFT JOIN branches br ON br.id = t.location_id
           LEFT JOIN product p ON p.id = t.product_id
           LEFT JOIN "productVarient" v ON v.id = t.variant_id
           LEFT JOIN uom u ON u.id = t.uom_id
           ${approval}
          ${clause} ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params,
      );
      return { data, total: Number(total[0]?.n ?? 0), page, limit };
    }
    const total: Array<{ n: string }> = await this.dataSource.query(
      `SELECT COUNT(*) AS n FROM stock_repack t JOIN stock_batch b ON b.id = t.stock_batch_id ${clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) - 1}`)}`,
      params.slice(1),
    );
    const data = await this.dataSource.query(
      `SELECT t.id::text AS id, t.repack_no AS "repackNo", b.batch_no AS "batchNo", b.stock_type AS "stockType",
              t.stock_batch_id::text AS "stockBatchId", br.name AS "locationName", p.product_name AS "productName",
              v."variantName" AS "variantName", fu.unit AS "fromUomName", tu.unit AS "toUomName",
              t.from_qty::float AS "fromQty", t.from_kg::float AS "fromKg", t.to_qty::float AS "toQty", t.to_kg::float AS "toKg",
              t.loss_kg::float AS "lossKg", t.value::float AS value, t.remark, t.status,
              t.requested_by::text AS "requestedBy", t.decided_by::text AS "decidedBy", t.decided_at AS "decidedAt",
              t.decision_remark AS "decisionRemark", t.created_at AS "createdAt",
              doc.id AS "documentId", doc.status AS "approvalStatus"
         FROM stock_repack t JOIN stock_batch b ON b.id = t.stock_batch_id
         LEFT JOIN branches br ON br.id = b.location_id
         LEFT JOIN product p ON p.id = b.product_id
         LEFT JOIN "productVarient" v ON v.id = b.variant_id
         LEFT JOIN uom fu ON fu.id = b.uom_id
         LEFT JOIN uom tu ON tu.id = t.to_uom_id
         ${approval}
        ${clause} ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, total: Number(total[0]?.n ?? 0), page, limit };
  }
}
