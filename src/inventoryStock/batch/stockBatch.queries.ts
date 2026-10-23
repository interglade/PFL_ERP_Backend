/**
 * Read side of batch stock (Phase C11 screens, C3 batch picker, C7 in transit).
 * Plain parameterised SQL; nothing here writes.
 */

import { EntityManager } from 'typeorm';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface StockFilter {
  companyId?: string | null;
  locationId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  uomId?: string | null;
  stockType?: string | null;
  search?: string | null;
  /** batches with quantity on hand only (default true) */
  inStock?: boolean;
  page?: number;
  limit?: number;
}

const pageOf = (f: { page?: number; limit?: number }) => {
  const page = Math.max(1, Math.floor(Number(f.page) || 1));
  const limit = Math.min(500, Math.max(1, Math.floor(Number(f.limit) || 25)));
  return { page, limit, offset: (page - 1) * limit };
};

/** Shared WHERE for stock_batch (alias b); returns SQL and parameters. */
function batchWhere(f: StockFilter, params: unknown[]): string {
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.companyId) add('b.company_id = ?', f.companyId);
  if (f.locationId) add('b.location_id = ?', f.locationId);
  if (f.productId) add('b.product_id = ?', f.productId);
  if (f.variantId !== undefined && f.variantId !== null) add('b.variant_id = ?', f.variantId);
  if (f.uomId) add('b.uom_id = ?', f.uomId);
  if (f.stockType) add('b.stock_type = ?', f.stockType);
  if (f.search) {
    params.push(`%${f.search}%`);
    const p = `$${params.length}`;
    where.push(`(b.batch_no ILIKE ${p} OR p.product_name ILIKE ${p} OR v."variantName" ILIKE ${p} OR b.origin_no ILIKE ${p})`);
  }
  if (f.inStock !== false) where.push('b.qty > 0');
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

const BATCH_SELECT = `
  b.id::text AS id, b.batch_no AS "batchNo", b.stock_type AS "stockType",
  b.company_id::text AS "companyId", c.name AS "companyName",
  b.location_id::text AS "locationId", br.name AS "locationName",
  b.product_id::text AS "productId", p.product_name AS "productName",
  b.variant_id::text AS "variantId", v."variantName" AS "variantName",
  b.uom_id::text AS "uomId", u.unit AS "uomName",
  b.origin_type AS "originType", b.origin_id::text AS "originId", b.origin_no AS "originNo",
  b.qty::float AS qty, b.reserved_qty::float AS "reservedQty", (b.qty - b.reserved_qty)::float AS available,
  b.net_kg::float AS "netKg", b.unit_cost::float AS "unitCost", b.value::float AS value,
  b.first_in_at AS "firstInAt", b.last_movement_at AS "lastMovementAt",
  CASE WHEN b.first_in_at IS NULL THEN NULL ELSE FLOOR(EXTRACT(EPOCH FROM (now() - b.first_in_at)) / 86400)::int END AS "ageDays"`;

const BATCH_JOINS = `
  FROM stock_batch b
  LEFT JOIN company c ON c.id = b.company_id
  LEFT JOIN branches br ON br.id = b.location_id
  LEFT JOIN product p ON p.id = b.product_id
  LEFT JOIN "productVarient" v ON v.id = b.variant_id
  LEFT JOIN uom u ON u.id = b.uom_id`;

/** Batches that can still be allocated (available > 0), oldest first — the DC / Second Sale batch picker. */
export async function availableBatches(manager: EntityManager, f: StockFilter): Promise<unknown[]> {
  const params: unknown[] = [];
  const where = batchWhere({ ...f, inStock: true }, params);
  return manager.query(
    `SELECT ${BATCH_SELECT} ${BATCH_JOINS} ${where}${where ? ' AND' : ' WHERE'} b.qty - b.reserved_qty > 0
      ORDER BY b.first_in_at NULLS LAST, b.created_at, b.id LIMIT 200`,
    params,
  );
}

/** Batch Stock screen: one row per batch. */
export async function listBatches(manager: EntityManager, f: StockFilter): Promise<Paged<unknown>> {
  const params: unknown[] = [];
  const where = batchWhere(f, params);
  const { page, limit, offset } = pageOf(f);
  const total: Array<{ n: string }> = await manager.query(`SELECT COUNT(*) AS n ${BATCH_JOINS} ${where}`, params);
  const data = await manager.query(
    `SELECT ${BATCH_SELECT} ${BATCH_JOINS} ${where}
      ORDER BY b.first_in_at NULLS LAST, p.product_name, b.batch_no
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data, total: Number(total[0]?.n ?? 0), page, limit };
}

/** Stock Summary screen: company → location → product → variant → unit → stock type. */
export async function stockSummary(manager: EntityManager, f: StockFilter): Promise<Paged<unknown>> {
  const params: unknown[] = [];
  const where = batchWhere(f, params);
  const { page, limit, offset } = pageOf(f);
  const group = `b.company_id, c.name, b.location_id, br.name, b.product_id, p.product_name, b.variant_id, v."variantName", b.uom_id, u.unit, b.stock_type`;
  const total: Array<{ n: string }> = await manager.query(
    `SELECT COUNT(*) AS n FROM (SELECT 1 ${BATCH_JOINS} ${where} GROUP BY ${group}) g`,
    params,
  );
  const data = await manager.query(
    `SELECT b.company_id::text AS "companyId", c.name AS "companyName",
            b.location_id::text AS "locationId", br.name AS "locationName",
            b.product_id::text AS "productId", p.product_name AS "productName",
            b.variant_id::text AS "variantId", v."variantName" AS "variantName",
            b.uom_id::text AS "uomId", u.unit AS "uomName", b.stock_type AS "stockType",
            SUM(b.qty)::float AS qty, SUM(b.reserved_qty)::float AS "reservedQty",
            SUM(b.qty - b.reserved_qty)::float AS available, SUM(b.net_kg)::float AS "netKg",
            SUM(b.value)::float AS value, COUNT(*) FILTER (WHERE b.qty > 0)::int AS batches,
            MIN(b.first_in_at) FILTER (WHERE b.qty > 0) AS "oldestInAt"
       ${BATCH_JOINS} ${where}
      GROUP BY ${group}
      ORDER BY c.name, br.name, p.product_name, v."variantName" NULLS FIRST, u.unit, b.stock_type
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data, total: Number(total[0]?.n ?? 0), page, limit };
}

export interface LedgerFilter {
  stockBatchId?: string | null;
  batchNo?: string | null;
  companyId?: string | null;
  locationId?: string | null;
  productId?: string | null;
  docType?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  limit?: number;
}

/** Stock Ledger screen: movements, newest first. */
export async function listLedger(manager: EntityManager, f: LedgerFilter): Promise<Paged<unknown>> {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.stockBatchId) add('l.stock_batch_id = ?', f.stockBatchId);
  if (f.batchNo) add('UPPER(l.batch_no) = UPPER(?)', f.batchNo);
  if (f.companyId) add('l.company_id = ?', f.companyId);
  if (f.locationId) add('l.location_id = ?', f.locationId);
  if (f.productId) add('l.product_id = ?', f.productId);
  if (f.docType) add('l.doc_type = ?', f.docType);
  if (f.from) add('l.posted_at >= ?::date', f.from);
  if (f.to) add(`l.posted_at < (?::date + interval '1 day')`, f.to);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { page, limit, offset } = pageOf(f);
  const joins = `FROM stock_ledger l
    LEFT JOIN company c ON c.id = l.company_id
    LEFT JOIN branches br ON br.id = l.location_id
    LEFT JOIN product p ON p.id = l.product_id
    LEFT JOIN "productVarient" v ON v.id = l.variant_id
    LEFT JOIN uom u ON u.id = l.uom_id`;
  const total: Array<{ n: string }> = await manager.query(`SELECT COUNT(*) AS n ${joins} ${clause}`, params);
  const data = await manager.query(
    `SELECT l.id::text AS id, l.posted_at AS "postedAt", l.movement_type AS "movementType",
            l.doc_type AS "docType", l.doc_id::text AS "docId", l.doc_no AS "docNo",
            l.stock_batch_id::text AS "stockBatchId", l.batch_no AS "batchNo", l.stock_type AS "stockType",
            c.name AS "companyName", br.name AS "locationName", p.product_name AS "productName",
            v."variantName" AS "variantName", u.unit AS "uomName",
            l.qty_in::float AS "qtyIn", l.qty_out::float AS "qtyOut", l.kg_in::float AS "kgIn", l.kg_out::float AS "kgOut",
            l.value_in::float AS "valueIn", l.value_out::float AS "valueOut",
            l.qty_after::float AS "qtyAfter", l.kg_after::float AS "kgAfter", l.value_after::float AS "valueAfter",
            l.remark
       ${joins} ${clause}
      ORDER BY l.posted_at DESC, l.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { data, total: Number(total[0]?.n ?? 0), page, limit };
}

/** Batch Trace screen: every location the batch is at, its movements in order, and what pending documents hold. */
export async function traceBatch(manager: EntityManager, batchNo: string) {
  const batches = await manager.query(
    `SELECT ${BATCH_SELECT} ${BATCH_JOINS} WHERE UPPER(b.batch_no) = UPPER($1) ORDER BY b.first_in_at NULLS LAST`,
    [batchNo],
  );
  const movements = await manager.query(
    `SELECT l.posted_at AS "postedAt", l.movement_type AS "movementType", l.doc_type AS "docType",
            l.doc_id::text AS "docId", l.doc_no AS "docNo", br.name AS "locationName", p.product_name AS "productName",
            v."variantName" AS "variantName", u.unit AS "uomName", l.stock_type AS "stockType",
            l.qty_in::float AS "qtyIn", l.qty_out::float AS "qtyOut", l.kg_in::float AS "kgIn", l.kg_out::float AS "kgOut",
            l.value_in::float AS "valueIn", l.value_out::float AS "valueOut", l.qty_after::float AS "qtyAfter"
       FROM stock_ledger l
       LEFT JOIN branches br ON br.id = l.location_id
       LEFT JOIN product p ON p.id = l.product_id
       LEFT JOIN "productVarient" v ON v.id = l.variant_id
       LEFT JOIN uom u ON u.id = l.uom_id
      WHERE UPPER(l.batch_no) = UPPER($1)
      ORDER BY l.posted_at, l.id`,
    [batchNo],
  );
  const pending = await manager.query(
    `SELECT a.doc_type AS "docType", a.doc_id::text AS "docId", a.doc_no AS "docNo", a.qty::float AS qty,
            br.name AS "locationName", p.product_name AS "productName"
       FROM stock_allocation a JOIN stock_batch b ON b.id = a.stock_batch_id
       LEFT JOIN branches br ON br.id = b.location_id
       LEFT JOIN product p ON p.id = b.product_id
      WHERE UPPER(a.batch_no) = UPPER($1) AND a.status = 'RESERVED'
      ORDER BY a.created_at`,
    [batchNo],
  );
  return { batchNo, batches, movements, pending };
}

/**
 * C7 — In transit: per approved Stock Transfer DC and batch, what left the
 * from-location and is not yet accounted for at the destination (Inward +
 * Dump lines of that batch on non-rejected documents).
 */
export async function inTransit(manager: EntityManager, f: { companyId?: string | null; locationId?: string | null; toLocationId?: string | null }) {
  const params: unknown[] = [DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER, DocumentStatus.COMPLETE, DocumentStatus.REJECT];
  const where: string[] = [];
  if (f.companyId) { params.push(f.companyId); where.push(`b.company_id = $${params.length}`); }
  if (f.locationId) { params.push(f.locationId); where.push(`b.location_id = $${params.length}`); }
  if (f.toLocationId) { params.push(f.toLocationId); where.push(`dc.to_location_id = $${params.length}`); }
  const extra = where.length ? `AND ${where.join(' AND ')}` : '';
  const latestStatus = (alias: string, type: string) =>
    `(SELECT d.status::text FROM documents d WHERE d.document_type_id::text = ${alias}.id::text AND d.type::text = '${type}' ORDER BY d."createdAt" DESC LIMIT 1)`;
  return manager.query(
    `WITH sent AS (
       SELECT a.doc_id, a.doc_no, a.batch_no, b.product_id, b.variant_id, b.uom_id, b.company_id, b.location_id,
              SUM(a.qty) AS qty, SUM(a.net_kg) AS kg, SUM(a.qty * COALESCE(a.unit_cost, 0)) AS value
         FROM stock_allocation a JOIN stock_batch b ON b.id = a.stock_batch_id
        WHERE a.doc_type = $1 AND a.status = 'CONSUMED'
        GROUP BY a.doc_id, a.doc_no, a.batch_no, b.product_id, b.variant_id, b.uom_id, b.company_id, b.location_id
     ),
     received AS (
       SELECT rec.delivery_challan_id::text AS doc_id, UPPER(l."batchNo") AS batch_no, l.product_id, l.uom_id, SUM(l.quantity) AS qty
         FROM "inwardProduct" l JOIN inward_register rec ON rec.id = l."inwardRegisterId"
        WHERE rec.delivery_challan_id IS NOT NULL AND COALESCE(rec."isDeleted", false) = false
          AND COALESCE(${latestStatus('rec', DocumentTypeEnum.INWARD_REGISTER)}, '') <> $3
        GROUP BY 1, 2, 3, 4
       UNION ALL
       SELECT rec.delivery_challan_id::text, UPPER(l."batchNo"), l.product_id, l.uom_id, SUM(l.quantity)
         FROM dump_product l JOIN dump_register rec ON rec.id = l.dump_register_id
        WHERE rec.delivery_challan_id IS NOT NULL AND COALESCE(rec."isDeleted", false) = false
          AND COALESCE(${latestStatus('rec', DocumentTypeEnum.DUMP_REGISTER)}, '') <> $3
        GROUP BY 1, 2, 3, 4
     )
     SELECT s.doc_id::text AS "dcId", s.doc_no AS "dcNo", s.batch_no AS "batchNo",
            p.product_name AS "productName", v."variantName" AS "variantName", u.unit AS "uomName",
            fb.name AS "fromLocationName", tb.name AS "toLocationName",
            s.qty::float AS "sentQty", COALESCE(r.qty, 0)::float AS "receivedQty",
            (s.qty - COALESCE(r.qty, 0))::float AS "inTransitQty", s.kg::float AS "sentKg",
            CASE WHEN s.qty > 0 THEN (s.value / s.qty * (s.qty - COALESCE(r.qty, 0))) ELSE 0 END::float AS "inTransitValue",
            dc."createdAt" AS "dcDate"
       FROM sent s
       JOIN stock_batch b ON b.batch_no = s.batch_no AND b.product_id = s.product_id AND b.location_id = s.location_id
                          AND b.uom_id IS NOT DISTINCT FROM s.uom_id AND b.variant_id IS NOT DISTINCT FROM s.variant_id
                          AND b.stock_type = 'FRESH'
       JOIN delivery_challan_purchase dc ON dc.id::text = s.doc_id::text
       LEFT JOIN (SELECT doc_id, batch_no, product_id, uom_id, SUM(qty) AS qty FROM received GROUP BY 1, 2, 3, 4) r
              ON r.doc_id = s.doc_id::text AND r.batch_no = UPPER(s.batch_no) AND r.product_id = s.product_id
             AND r.uom_id IS NOT DISTINCT FROM s.uom_id
       LEFT JOIN product p ON p.id = s.product_id
       LEFT JOIN "productVarient" v ON v.id = s.variant_id
       LEFT JOIN uom u ON u.id = s.uom_id
       LEFT JOIN branches fb ON fb.id = s.location_id
       LEFT JOIN branches tb ON tb.id = dc.to_location_id
      WHERE COALESCE(${latestStatus('dc', DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER)}, '') = $2
        AND COALESCE(dc."isDeleted", false) = false
        AND s.qty - COALESCE(r.qty, 0) > 0
        ${extra}
      ORDER BY dc."createdAt", s.doc_no, p.product_name`,
    params,
  );
}

/** Batches a document's lines hold or took (DC edit / view: which batches each line uses). */
export async function documentAllocations(manager: EntityManager, docType: string, docId: string) {
  return manager.query(
    `SELECT a.id::text AS id, a.line_id::text AS "lineId", a.stock_batch_id::text AS "stockBatchId", a.batch_no AS "batchNo",
            a.qty::float AS qty, a.net_kg::float AS "netKg", a.unit_cost::float AS "unitCost", a.status,
            b.first_in_at AS "firstInAt", (b.qty - b.reserved_qty)::float AS "batchAvailable"
       FROM stock_allocation a JOIN stock_batch b ON b.id = a.stock_batch_id
      WHERE a.doc_type = $1 AND a.doc_id = $2 AND a.status IN ('RESERVED', 'CONSUMED')
      ORDER BY a.created_at, a.id`,
    [docType, docId],
  );
}
