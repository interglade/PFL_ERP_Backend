/**
 * Receiving ↔ Vehicle Dispatch (docs/vehicle-dispatch-plan.md §3.2).
 *
 * A GRN can have one live purchase dispatch and a Stock Transfer DC one live stock
 * transfer dispatch ("live" = not deleted, approval not rejected). The receiving
 * status and the Arrivals list show it as a vehicle line and an in-transit /
 * arrived state, and the AQR prefills the arrived kg from its loaded net weight.
 * Receiving may start only once the source and (for documents created since the
 * go-live date) its dispatch are COMPLETE (docs/dispatch-enforcement-plan.md D3);
 * the guard enforces it, this module explains it (`canReceive`, `blockers`).
 */

import { EntityManager } from 'typeorm';
import { DocumentStatus, DocumentTypeEnum } from '../approvalFlow/entity/docuemnt.entity';
import { matchSourceKey, productKey, round3 } from './receiving.helpers';
import { DISPATCH_LABEL, dispatchRequiredSql, isDispatchRequired } from '../vehicleDispatch/service/dispatchRules';
import { DispatchType } from '../vehicleDispatch/entity/vehicleDispatch.entity';
import { DispatchState, DispatchSummary, ReceivingSourceStatus, ReceivingSourceType } from './receiving.types';

const DISPATCH_LINK: Partial<Record<ReceivingSourceType, { fk: 'grn_id' | 'delivery_challan_id'; dispatchType: string }>> = {
  grn: { fk: 'grn_id', dispatchType: 'purchase' },
  'stock-transfer-dc': { fk: 'delivery_challan_id', dispatchType: 'stock-transfer' },
};

const DISPATCH_DOC = DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER;

/** Predicate on `alias` (a dispatch row) for "live dispatch of this source type". Constants only. */
function livePredicate(alias: string, sourceType: ReceivingSourceType): string | null {
  const link = DISPATCH_LINK[sourceType];
  if (!link) return null;
  return (
    `${alias}."dispatchType"::text = '${link.dispatchType}' AND ${alias}."deletedAt" IS NULL AND ${alias}."isDeleted" = false ` +
    `AND NOT EXISTS (SELECT 1 FROM documents ${alias}_d WHERE ${alias}_d.document_type_id = ${alias}.id::text ` +
    `AND ${alias}_d.type::text = '${DISPATCH_DOC}' AND ${alias}_d.status::text = '${DocumentStatus.REJECT}' AND ${alias}_d."deletedAt" IS NULL)`
  );
}

/** SQL expression for the Arrivals CTE: `'in-transit'`, `'arrived'` or NULL (no dispatch). */
export function dispatchStateSql(sourceIdExpr: string, sourceType: ReceivingSourceType): string {
  const link = DISPATCH_LINK[sourceType];
  const live = livePredicate('rl_vd', sourceType);
  if (!link || !live) return 'NULL::text';
  return (
    `(SELECT CASE WHEN rl_vd."arrivedAt" IS NOT NULL THEN 'arrived' ELSE 'in-transit' END FROM dispatch rl_vd ` +
    `WHERE rl_vd."${link.fk}" = ${sourceIdExpr} AND ${live} ORDER BY rl_vd."createdAt" DESC LIMIT 1)`
  );
}

/** SQL for the Arrivals CTE: receiving is not blocked by the dispatch rule (constants only). */
export function dispatchReadySql(sourceIdExpr: string, createdAtExpr: string, sourceType: ReceivingSourceType): string {
  const link = DISPATCH_LINK[sourceType];
  const live = livePredicate('rl_rd', sourceType);
  if (!link || !live) return 'TRUE';
  const approved =
    `EXISTS (SELECT 1 FROM dispatch rl_rd WHERE rl_rd."${link.fk}" = ${sourceIdExpr} AND ${live} ` +
    `AND (SELECT d.status::text FROM documents d WHERE d.document_type_id = rl_rd.id::text AND d.type::text = '${DISPATCH_DOC}' ` +
    `AND d."deletedAt" IS NULL ORDER BY d."createdAt" DESC LIMIT 1) = '${DocumentStatus.COMPLETE}')`;
  return `(CASE WHEN ${dispatchRequiredSql(createdAtExpr)} THEN ${approved} ELSE TRUE END)`;
}

export interface LoadedDispatch {
  summary: DispatchSummary;
  /** Net kg per product key (`productId:variantId`). */
  kgByKey: Map<string, number>;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The live dispatch of each source (newest wins), with its per-product net kg. */
export async function loadDispatches(
  manager: EntityManager,
  sourceType: ReceivingSourceType,
  sourceIds: string[],
): Promise<Map<string, LoadedDispatch>> {
  const result = new Map<string, LoadedDispatch>();
  const link = DISPATCH_LINK[sourceType];
  const live = livePredicate('d', sourceType);
  if (!link || !live || !sourceIds.length) return result;

  const rows: any[] = await manager.query(
    `SELECT d.id::text AS id, d."${link.fk}"::text AS source_id, d."vehicleDispatchNo" AS no, doc.id::text AS document_id,
            doc.status::text AS status, d."vehicleNo" AS vehicle_no, d."vehicleType" AS vehicle_type, d."driverName" AS driver_name,
            d."driverMobNo" AS driver_mob_no, d."transporterName" AS transporter_name, d."outTime"::text AS out_time,
            d."reachingTime"::text AS reaching_time, d."arrivedAt" AS arrived_at, d."totalNetWeight" AS net_weight
       FROM dispatch d
       LEFT JOIN LATERAL (SELECT id, status FROM documents WHERE document_type_id = d.id::text AND type::text = $2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1) doc ON true
      WHERE d."${link.fk}" = ANY($1::uuid[]) AND ${live}
      ORDER BY d."createdAt" DESC`,
    [sourceIds, DISPATCH_DOC],
  );

  for (const row of rows) {
    if (result.has(row.source_id)) continue;
    result.set(row.source_id, {
      summary: {
        id: row.id,
        dispatchNo: row.no ?? null,
        documentId: row.document_id ?? null,
        status: row.status ?? null,
        vehicleNo: row.vehicle_no ?? null,
        vehicleType: row.vehicle_type ?? null,
        driverName: row.driver_name ?? null,
        driverMobNo: row.driver_mob_no ?? null,
        transporterName: row.transporter_name ?? null,
        outTime: row.out_time ?? null,
        reachingTime: row.reaching_time ?? null,
        arrivedAt: row.arrived_at ?? null,
        netWeightKg: num(row.net_weight),
      },
      kgByKey: new Map(),
    });
  }

  const dispatchIds = Array.from(result.values()).map((entry) => entry.summary.id);
  if (dispatchIds.length) {
    const lines: Array<{ dispatch_id: string; product_id: string | null; varient_id: string | null; uom_id: string | null; kg: string | null }> = await manager.query(
      `SELECT dispatch_id::text AS dispatch_id, product_id::text AS product_id, varient_id::text AS varient_id, uom_id::text AS uom_id, SUM("netWeight") AS kg
         FROM dispatch_product WHERE dispatch_id = ANY($1::uuid[]) AND "deletedAt" IS NULL
        GROUP BY dispatch_id, product_id, varient_id, uom_id`,
      [dispatchIds],
    );
    const byDispatch = new Map(Array.from(result.values()).map((entry) => [entry.summary.id, entry]));
    for (const line of lines) {
      if (!line.product_id) continue;
      const entry = byDispatch.get(line.dispatch_id);
      if (entry) entry.kgByKey.set(productKey(line.product_id, line.varient_id, line.uom_id), round3(num(line.kg) ?? 0));
    }
  }
  return result;
}

export function dispatchStateOf(summary: DispatchSummary | null): DispatchState {
  if (!summary) return 'none';
  return summary.arrivedAt ? 'arrived' : 'in-transit';
}

const SOURCE_LABEL: Record<ReceivingSourceType, string> = {
  grn: 'GRN',
  'stock-transfer-dc': 'Stock transfer DC',
  rbc: 'Return by customer',
};

/** Puts the dispatch (or its absence) and the receiving readiness on a computed status. */
export function attachDispatch(status: ReceivingSourceStatus, loaded: LoadedDispatch | undefined): ReceivingSourceStatus {
  status.dispatch = loaded?.summary ?? null;
  status.dispatchState = dispatchStateOf(status.dispatch);

  const { type, isComplete, no, date } = status.source;
  const dispatchType = type === 'grn' ? DispatchType.PURCHASE : type === 'stock-transfer-dc' ? DispatchType.STOCK_TRANSFER : null;
  status.dispatchRequired = !!dispatchType && isDispatchRequired(date);
  const blockers: string[] = [];
  if (!isComplete) blockers.push(`${SOURCE_LABEL[type]} ${no ?? ''} is not approved yet`.replace(/\s+/g, ' ').trim());
  if (dispatchType && status.dispatchRequired) {
    if (!status.dispatch) blockers.push(`${DISPATCH_LABEL[dispatchType]} not created yet`);
    else if (status.dispatch.status !== DocumentStatus.COMPLETE) {
      blockers.push(`${DISPATCH_LABEL[dispatchType]} ${status.dispatch.dispatchNo ?? ''} is not approved yet`.replace(/\s+/g, ' ').trim());
    }
  }
  status.blockers = blockers;
  status.canReceive = blockers.length === 0;
  // Dispatch lines are matched to the products like documents are (product +
  // variant + unit, falling back to the only line of that product + variant).
  const byProduct = new Map(status.products.map((p) => [p.key, { productId: p.productId, variantId: p.variantId }]));
  const dispatched = new Map<string, number>();
  loaded?.kgByKey.forEach((kg, key) => {
    const [productId, variantId, uomId] = key.split(':');
    const target = matchSourceKey(byProduct, productId, variantId === 'null' ? null : variantId, uomId === 'null' ? null : uomId);
    dispatched.set(target, round3((dispatched.get(target) ?? 0) + kg));
  });
  for (const product of status.products) {
    product.dispatchedKg = loaded ? dispatched.get(product.key) ?? null : null;
  }
  return status;
}
