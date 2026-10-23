/**
 * Document-level batch stock (Phase C2–C4): what an Inward Register puts into
 * batch stock, and what a delivery challan holds / takes out.
 *
 * Called by InventoryMovementService when a document reaches COMPLETE, and by
 * the DC services on create / edit / delete / reject.
 */

import { EntityManager } from 'typeorm';
import AppError from '../../utils/appError';
import { DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { GrnDeliveryMode } from '../../grn/entity/grn.entity';
import { InwardRegister, InwardType } from '../../inwardRegister/entity/inwardRegister.entity';
import { DeliveryChallanPurchase } from '../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity';
import {
  AllocationRequest,
  consumeDocument,
  hasAllocations,
  postIn,
  releaseDocument,
  ReserveLine,
  reserveLines,
} from './stockBatch.core';
import { StockMovementType } from './stockLedger.entity';
import { StockOriginType, StockType } from './stockBatch.entity';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Cost per unit of what a Customer DC sold of a product (its consumed allocations), for returned stock (C6). */
export async function soldUnitCost(
  manager: EntityManager,
  dcId: string,
  productId: string,
  variantId: string | null,
): Promise<number | null> {
  const rows: Array<{ qty: string | null; value: string | null }> = await manager.query(
    `SELECT SUM(a.qty) AS qty, SUM(a.qty * COALESCE(a.unit_cost, 0)) AS value
       FROM stock_allocation a JOIN item it ON it.id = a.line_id
      WHERE a.doc_id = $1 AND a.status = 'CONSUMED' AND it.product_id = $2 AND it.varient_id IS NOT DISTINCT FROM $3`,
    [dcId, productId, variantId],
  );
  const qty = num(rows[0]?.qty);
  return qty > 0 ? num(rows[0]?.value) / qty : null;
}

/**
 * C2 — an approved Inward Register adds each line to its batch at the
 * receiving location: quantity in the line's unit, net kg, value = line amount.
 *   purchase    → FRESH, batch = the GRN batch no
 *   transferred → FRESH, batch = the line's batch (the batch the Transfer DC took), value at that batch cost
 *   returned    → RETURNED, batch = the RBC no, value at the cost of what the DC sold
 */
export async function postInwardToBatches(manager: EntityManager, inwardId: string, postedBy?: string | null): Promise<void> {
  const inward = await manager.findOne(InwardRegister, {
    where: { id: inwardId },
    relations: [
      'companyName', 'location', 'grnNo', 'deliveryChallanNo', 'rbcNo', 'rbcNo.deliveryChallanNo',
      'inwardProducts', 'inwardProducts.productName', 'inwardProducts.variant', 'inwardProducts.uom',
    ],
  });
  if (!inward) throw new AppError(404, `Inward Register ${inwardId} not found`);
  const companyId = inward.companyName?.id;
  const locationId = inward.location?.id;
  if (!companyId || !locationId) {
    throw new AppError(400, `Inward Register ${inward.inwardNo ?? inwardId} is missing company or location; cannot move stock`);
  }

  const type = inward.inwardType;
  const movementType: StockMovementType =
    type === InwardType.Transferred ? 'INWARD_TRANSFER' : type === InwardType.ReturnedByCustomer ? 'INWARD_RETURN' : 'INWARD_PURCHASE';
  const stockType: StockType = type === InwardType.ReturnedByCustomer ? 'RETURNED' : 'FRESH';
  const originType: StockOriginType =
    type === InwardType.Transferred ? 'TRANSFER' : type === InwardType.ReturnedByCustomer ? 'RBC' : 'GRN';
  const grn = inward.grnNo ?? null;
  const dc = inward.deliveryChallanNo ?? null;
  const rbc = inward.rbcNo ?? null;
  const originId = grn?.id ?? dc?.id ?? rbc?.id ?? null;
  const originNo = grn?.grnNo ?? dc?.challanNo ?? rbc?.rbcNo ?? null;

  for (const line of inward.inwardProducts ?? []) {
    const productId = line.productName?.id;
    if (!productId) continue;
    const variantId = line.variant?.id ?? null;
    const qty = num(line.quantity);
    const kg = num(line.netWeight);
    if (qty <= 0 && kg <= 0) continue;

    let batchNo: string | null;
    let value = num(line.amount) || qty * num(line.unitPrice);
    if (type === InwardType.ReturnedByCustomer) {
      batchNo = clean(rbc?.rbcNo) ?? clean(line.batchNo) ?? clean(inward.batchNo);
      const soldDcId = (rbc as unknown as { deliveryChallanNo?: { id?: string } } | null)?.deliveryChallanNo?.id ?? null;
      const cost = soldDcId ? await soldUnitCost(manager, soldDcId, productId, variantId) : null;
      if (cost !== null) value = qty * cost;
    } else if (type === InwardType.Transferred) {
      batchNo = clean(line.batchNo) ?? clean(inward.batchNo) ?? clean(dc?.challanNo);
    } else {
      batchNo = clean(inward.batchNo) ?? clean(grn?.batchNo) ?? (grn?.grnNo ? `GRN-${grn.grnNo}` : null);
    }
    if (!batchNo) batchNo = `IWD-${inward.inwardNo ?? inwardId}`;

    await postIn(manager, {
      companyId, locationId, productId, variantId, uomId: line.uom?.id ?? null, batchNo, stockType,
      qty, kg, value, originType, originId, originNo, movementType,
      doc: { type: DocumentTypeEnum.INWARD_REGISTER, id: inward.id, no: inward.inwardNo ?? null, lineId: line.id ?? null },
      postedBy,
    });
  }
}

const DC_MOVEMENT: Partial<Record<DocumentTypeEnum, StockMovementType>> = {
  [DocumentTypeEnum.DC_TYPE_CUSTOMER]: 'DC_CUSTOMER',
  [DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER]: 'DC_TRANSFER',
  [DocumentTypeEnum.DC_TYPE_OTHER]: 'DC_OTHER',
};

export const isDcType = (type: unknown): type is DocumentTypeEnum =>
  type === DocumentTypeEnum.DC_TYPE_CUSTOMER || type === DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER || type === DocumentTypeEnum.DC_TYPE_OTHER;

interface LoadedDcForStock {
  id: string;
  challanNo: string | null;
  companyId: string | null;
  locationId: string | null;
  directSale: boolean;
  lines: ReserveLine[];
}

/** Physical columns a DC child may have stored its from-location in (STI collision, see dispatchSource.ts). */
const FROM_LOCATION_COLUMNS = ['branch_id', 'from_location_id', 'other_from_location_id_for_other'];

async function loadDcForStock(manager: EntityManager, dcId: string): Promise<LoadedDcForStock> {
  const dc = await manager
    .getRepository(DeliveryChallanPurchase)
    .createQueryBuilder('dc')
    .select(['dc.id', 'dc.challanNo'])
    .leftJoin('dc.companyName', 'company')
    .addSelect(['company.id'])
    .leftJoin('dc.grnNo', 'grn')
    .addSelect(['grn.id', 'grn.deliveryMode'])
    .leftJoin('dc.deliveryChallanProducts', 'item')
    .addSelect(['item.id', 'item.quantity', 'item.netWeight'])
    .leftJoin('item.productName', 'product')
    .addSelect(['product.id', 'product.name'])
    .leftJoin('item.variant', 'variant')
    .addSelect(['variant.id', 'variant.variantName'])
    .leftJoin('variant.product', 'variantProduct')
    .addSelect(['variantProduct.id'])
    .leftJoin('item.uom', 'uom')
    .addSelect(['uom.id', 'uom.unit'])
    .leftJoin('item.saleUoM', 'saleUom')
    .addSelect(['saleUom.id', 'saleUom.unit'])
    .where('dc.id = :dcId', { dcId })
    .getOne();
  if (!dc) throw new AppError(404, `Delivery challan ${dcId} not found`);

  // From-location through the physical column (the relation is ambiguous on this STI table).
  const present: Array<{ column_name: string }> = await manager.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_challan_purchase' AND column_name = ANY($1::text[])`,
    [FROM_LOCATION_COLUMNS],
  );
  const cols = FROM_LOCATION_COLUMNS.filter((c) => present.some((p) => p.column_name === c));
  const loc: Array<{ id: string | null }> = cols.length
    ? await manager.query(
        `SELECT COALESCE(${cols.map((c) => `"${c}"`).join(', ')})::text AS id FROM delivery_challan_purchase WHERE id = $1`,
        [dcId],
      )
    : [];

  const lines: ReserveLine[] = (dc.deliveryChallanProducts ?? []).map((item) => {
    const variantId = item.variant?.id ?? null;
    const productId = (variantId ? item.variant?.product?.id : null) ?? item.productName?.id ?? '';
    const uom = item.saleUoM ?? item.uom ?? null;
    const name = item.productName?.name ?? 'Product';
    const label = `${item.variant?.variantName ? `${name} (${item.variant.variantName})` : name}${uom?.unit ? ` [${uom.unit}]` : ''}`;
    return { lineId: item.id, productId, variantId, uomId: uom?.id ?? null, qty: num(item.quantity), kg: num(item.netWeight), label };
  });

  return {
    id: dc.id,
    challanNo: dc.challanNo ?? null,
    companyId: dc.companyName?.id ?? null,
    locationId: loc[0]?.id ?? null,
    directSale: dc.grnNo?.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER,
    lines: lines.filter((l) => l.productId),
  };
}

/**
 * C3 / C4 — a pending DC holds batch stock for every line: the batches the
 * user chose (`requests` by line id) or the oldest first. Anything the DC held
 * before is released first, so this also serves an edit. A direct-sale DC
 * holds nothing. Throws 400 when stock does not cover the lines.
 */
export async function reserveDcStock(
  manager: EntityManager,
  docType: DocumentTypeEnum,
  dcId: string,
  requests?: Map<string, AllocationRequest[]>,
): Promise<void> {
  await releaseDocument(manager, docType, dcId);
  const dc = await loadDcForStock(manager, dcId);
  if (dc.directSale) return;
  if (!dc.companyId) throw new AppError(400, 'Select the company');
  if (!dc.locationId) throw new AppError(400, 'Select the from-location');
  await reserveLines(manager, {
    doc: { type: docType, id: dc.id, no: dc.challanNo },
    companyId: dc.companyId,
    locationId: dc.locationId,
    stockType: 'FRESH',
    lines: dc.lines.map((l) => ({ ...l, requested: (l.lineId && requests?.get(l.lineId)) || null })),
  });
}

/** Batch requests of the submitted lines, keyed by the saved line ids (same order as submitted). */
export function allocationRequestsByLine(
  savedLines: Array<{ id?: string }> | null | undefined,
  submittedLines: ReadonlyArray<object> | null | undefined,
): Map<string, AllocationRequest[]> {
  const result = new Map<string, AllocationRequest[]>();
  (savedLines ?? []).forEach((saved, index) => {
    const raw = (submittedLines?.[index] as { allocations?: unknown } | undefined)?.allocations;
    if (!saved?.id || !Array.isArray(raw)) return;
    const requests = raw
      .map((r) => ({ stockBatchId: String((r as { stockBatchId?: unknown }).stockBatchId ?? ''), qty: num((r as { qty?: unknown }).qty) }))
      .filter((r) => r.stockBatchId && r.qty > 0);
    if (requests.length) result.set(saved.id, requests);
  });
  return result;
}

/** C4 — an approved DC takes its held batches out of stock (DCs created before batch stock are allocated FIFO first). */
export async function consumeDcStock(manager: EntityManager, docType: DocumentTypeEnum, dcId: string, postedBy?: string | null): Promise<void> {
  const movementType = DC_MOVEMENT[docType];
  if (!movementType) return;
  const dc = await loadDcForStock(manager, dcId);
  if (dc.directSale) return;
  if (!(await hasAllocations(manager, docType, dcId))) {
    await reserveDcStock(manager, docType, dcId);
  }
  await consumeDocument(manager, { docType, docId: dcId, docNo: dc.challanNo, movementType, postedBy });
}

/** A rejected / deleted DC gives back what it held. */
export async function releaseDcStock(manager: EntityManager, docType: DocumentTypeEnum, dcId: string): Promise<void> {
  await releaseDocument(manager, docType, dcId);
}

// ---------------------------------------------------------------------------
// C8 — Second Sale sells RETURNED stock at its location.
// ---------------------------------------------------------------------------

const SECOND_SALE_DOC = DocumentTypeEnum.SECOND_SALE;

async function loadSecondSaleForStock(manager: EntityManager, id: string) {
  const rows: Array<{ id: string; no: string | null; company_id: string | null; location_id: string | null }> = await manager.query(
    `SELECT id::text AS id, "secondSaleNo" AS no, company_id::text AS company_id, branch_id::text AS location_id
       FROM second_sale_document WHERE id = $1`,
    [id],
  );
  const head = rows[0];
  if (!head) throw new AppError(404, `Second Sale ${id} not found`);
  const lines: Array<{
    id: string; product_id: string | null; product_name: string | null; variant_id: string | null; variant_product_id: string | null;
    variant_name: string | null; uom_id: string | null; uom_name: string | null; quantity: string | null; net_weight: string | null;
  }> = await manager.query(
    `SELECT l.id::text AS id, l.product_id::text AS product_id, p.product_name, l.varient_id::text AS variant_id,
            v.product_id::text AS variant_product_id, v."variantName" AS variant_name,
            l.saleuom_id::text AS uom_id, u.unit AS uom_name, l.quantity, l."netWeight" AS net_weight
       FROM second_sale_product l
       LEFT JOIN product p ON p.id = l.product_id
       LEFT JOIN "productVarient" v ON v.id = l.varient_id
       LEFT JOIN uom u ON u.id = l.saleuom_id
      WHERE l.second_sale_register_id = $1
      ORDER BY l."createdAt", l.id`,
    [id],
  );
  return {
    id: head.id,
    no: head.no,
    companyId: head.company_id,
    locationId: head.location_id,
    lines: lines
      .map((l): ReserveLine => {
        const name = l.product_name ?? 'Product';
        return {
          lineId: l.id,
          productId: l.variant_product_id ?? l.product_id ?? '',
          variantId: l.variant_id,
          uomId: l.uom_id,
          qty: num(l.quantity),
          kg: num(l.net_weight),
          label: `${l.variant_name ? `${name} (${l.variant_name})` : name}${l.uom_name ? ` [${l.uom_name}]` : ''} (returned stock)`,
        };
      })
      .filter((l) => l.productId),
  };
}

/** A pending Second Sale holds RETURNED batch stock at its location (chosen batches or oldest first). */
export async function reserveSecondSaleStock(
  manager: EntityManager,
  secondSaleId: string,
  requests?: Map<string, AllocationRequest[]>,
): Promise<void> {
  await releaseDocument(manager, SECOND_SALE_DOC, secondSaleId);
  const sale = await loadSecondSaleForStock(manager, secondSaleId);
  if (!sale.companyId) throw new AppError(400, 'Select the company');
  if (!sale.locationId) throw new AppError(400, 'Select the location');
  await reserveLines(manager, {
    doc: { type: SECOND_SALE_DOC, id: sale.id, no: sale.no },
    companyId: sale.companyId,
    locationId: sale.locationId,
    stockType: 'RETURNED',
    lines: sale.lines.map((l) => ({ ...l, requested: (l.lineId && requests?.get(l.lineId)) || null })),
  });
}

/** An approved Second Sale takes its held returned batches out of stock. */
export async function consumeSecondSaleStock(manager: EntityManager, secondSaleId: string, postedBy?: string | null): Promise<void> {
  const sale = await loadSecondSaleForStock(manager, secondSaleId);
  if (!(await hasAllocations(manager, SECOND_SALE_DOC, secondSaleId))) {
    await reserveSecondSaleStock(manager, secondSaleId);
  }
  await consumeDocument(manager, { docType: SECOND_SALE_DOC, docId: secondSaleId, docNo: sale.no, movementType: 'SECOND_SALE', postedBy });
}

export async function releaseSecondSaleStock(manager: EntityManager, secondSaleId: string): Promise<void> {
  await releaseDocument(manager, SECOND_SALE_DOC, secondSaleId);
}
