import { isGrnReceivableStatus } from '../../grn/grnApproval';
import { EntityManager } from 'typeorm';
import moment from 'moment-timezone';
import AppError from '../../utils/appError';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { GrnDeliveryMode } from '../../grn/entity/grn.entity';
import { Source } from '../../utils/status.enum';
import { DispatchType, VehicleDispatch } from '../entity/vehicleDispatch.entity';
import { DispatchProduct } from '../entity/dispatchProduct.entity';
import {
  DISPATCH_DOCUMENT_TYPE,
  DispatchSourceResolver,
  liveDispatchExistsSql,
  liveSourceSql,
  SOURCE_FK_COLUMN,
  SourceLine,
  syncGrnVehicleDispatchFlag,
} from './dispatchSource';

/**
 * Mandatory vehicle dispatch per process step (docs/dispatch-enforcement-plan.md):
 *
 * - a dispatch may be created as soon as its source (GRN / Stock Transfer DC /
 *   Customer DC) exists and is not rejected;
 * - it can be approved only once the source is COMPLETE, and its product lines are
 *   re-copied from the final source at that moment;
 * - a pending dispatch is rejected automatically when its source is rejected or deleted;
 * - the next step (receiving, mark arrived, final invoice, return by customer) needs
 *   the source AND the dispatch to be COMPLETE - for documents created on or after
 *   the go-live date (`DISPATCH_REQUIRED_FROM`, YYYY-MM-DD, IST).
 */

const IST = 'Asia/Kolkata';
/** Used when `DISPATCH_REQUIRED_FROM` is not set: the date the rule was introduced. */
const DEFAULT_GO_LIVE = '2026-10-14';
export const AUTO_REJECT_PREFIX = 'Auto-rejected: ';

export const SOURCE_SHORT_LABEL: Record<DispatchType, string> = {
  [DispatchType.PURCHASE]: 'GRN',
  [DispatchType.STOCK_TRANSFER]: 'Stock transfer DC',
  [DispatchType.SALES]: 'Customer DC',
};

export const DISPATCH_LABEL: Record<DispatchType, string> = {
  [DispatchType.PURCHASE]: 'Purchase dispatch',
  [DispatchType.STOCK_TRANSFER]: 'Stock transfer dispatch',
  [DispatchType.SALES]: 'Sales dispatch',
};

const SOURCE_TABLE: Record<DispatchType, { table: string; no: string }> = {
  [DispatchType.PURCHASE]: { table: 'grns', no: '"grnNo"' },
  [DispatchType.STOCK_TRANSFER]: { table: 'delivery_challan_purchase', no: '"challanNo"' },
  [DispatchType.SALES]: { table: 'delivery_challan_purchase', no: '"challanNo"' },
};

/** The source document type a rejected / deleted `documents` row belongs to, per register. */
const DISPATCH_TYPE_OF_SOURCE_DOC: Partial<Record<string, DispatchType>> = {
  [DocumentTypeEnum.GRN]: DispatchType.PURCHASE,
  [DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER]: DispatchType.STOCK_TRANSFER,
  [DocumentTypeEnum.DC_TYPE_CUSTOMER]: DispatchType.SALES,
};

// ─── Go-live ──────────────────────────────────────────────────────────────────

export function dispatchGoLiveDate(): string {
  const configured = (process.env.DISPATCH_REQUIRED_FROM ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : DEFAULT_GO_LIVE;
}

/** Documents created before the go-live date (IST) are exempt from the dispatch rule. */
export function isDispatchRequired(sourceCreatedAt: Date | string | null | undefined): boolean {
  if (!sourceCreatedAt) return true;
  const created = moment(sourceCreatedAt).tz(IST).format('YYYY-MM-DD');
  return created >= dispatchGoLiveDate();
}

/**
 * SQL fragment: the source was created on / after the go-live date. `createdAt` is a
 * timestamp without time zone holding the server's local wall time (that is how the
 * driver writes JS dates), so the boundary is IST midnight expressed in server-local
 * time. Constant only - never user input.
 */
export function dispatchRequiredSql(createdAtExpr: string): string {
  const boundary = moment.tz(dispatchGoLiveDate(), 'YYYY-MM-DD', IST).startOf('day').local().format('YYYY-MM-DD HH:mm:ss');
  return `(${createdAtExpr}) >= TIMESTAMP '${boundary}'`;
}

// ─── Source predicates ────────────────────────────────────────────────────────

/** SQL: a Customer DC raised from a GRN delivered direct to the customer (its transport is the purchase dispatch). */
export function directSaleDcSql(dcIdExpr: string): string {
  return (
    `EXISTS (SELECT 1 FROM delivery_challan_purchase ds_dc JOIN grns ds_g ON ds_g.id = ds_dc.grn_id ` +
    `WHERE ds_dc.id = ${dcIdExpr} AND ds_g."deliveryMode"::text = '${GrnDeliveryMode.DIRECT_TO_CUSTOMER}')`
  );
}

// ─── Lines ────────────────────────────────────────────────────────────────────

const decimalOrNull = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** Dispatch lines from source lines (a read-only copy). */
export function buildDispatchProducts(manager: EntityManager, lines: SourceLine[]): DispatchProduct[] {
  const repo = manager.getRepository(DispatchProduct);
  return lines.map((line) =>
    Object.assign(repo.create(), {
      productName: line.productId ? { id: line.productId } : null,
      variant: line.variantId ? { id: line.variantId } : null,
      uom: line.uomId ? { id: line.uomId } : null,
      packagingMaterial: line.packagingMaterialId ? { id: line.packagingMaterialId } : null,
      quantity: decimalOrNull(line.quantity),
      unitPrice: decimalOrNull(line.unitPrice),
      amount: decimalOrNull(line.amount),
      packingMaterialWeight: decimalOrNull(line.packingMaterialWeight),
      grossWeight: decimalOrNull(line.grossWeight),
      netWeight: decimalOrNull(line.netWeight),
    }),
  );
}

// ─── Gate ─────────────────────────────────────────────────────────────────────

export interface DispatchGate {
  dispatchType: DispatchType;
  sourceId: string;
  sourceNo: string | null;
  sourceStatus: string | null;
  sourceComplete: boolean;
  /** False for documents created before go-live (and, on the sales side, direct-sale DCs). */
  required: boolean;
  dispatch: { id: string; vehicleDispatchNo: string | null; documentId: string | null; status: string | null } | null;
  ready: boolean;
  reasons: string[];
}

interface SourceRow {
  no: string | null;
  created_at: Date | null;
  deleted: boolean;
  direct_sale: boolean;
}

async function loadSourceRow(manager: EntityManager, dispatchType: DispatchType, sourceId: string): Promise<SourceRow | null> {
  const { table, no } = SOURCE_TABLE[dispatchType];
  const directSale = dispatchType === DispatchType.SALES ? directSaleDcSql('s.id') : 'false';
  const rows = await manager.query(
    `SELECT s.${no} AS no, s."createdAt" AS created_at, (s."isDeleted" = true OR s."deletedAt" IS NOT NULL) AS deleted, ${directSale} AS direct_sale
       FROM "${table}" s WHERE s.id = $1`,
    [sourceId],
  );
  return rows[0] ?? null;
}

/** Whether the step after the source may start: source COMPLETE and (when required) its dispatch COMPLETE. */
export async function dispatchGate(manager: EntityManager, dispatchType: DispatchType, sourceId: string): Promise<DispatchGate> {
  const resolver = new DispatchSourceResolver(manager);
  const source = await loadSourceRow(manager, dispatchType, sourceId);
  if (!source || source.deleted) throw new AppError(404, `${SOURCE_SHORT_LABEL[dispatchType]} not found`);

  const document = await resolver.sourceDocument(dispatchType, sourceId);
  // D-4: a GRN only needs its approvers (finance finalisation may be pending).
  const sourceComplete = dispatchType === DispatchType.PURCHASE
    ? isGrnReceivableStatus(document?.status)
    : document?.status === DocumentStatus.COMPLETE;
  const required = isDispatchRequired(source.created_at) && !(dispatchType === DispatchType.SALES && source.direct_sale);
  const live = await resolver.liveDispatch(dispatchType, sourceId);

  const reasons: string[] = [];
  if (!sourceComplete) reasons.push(`${SOURCE_SHORT_LABEL[dispatchType]} ${source.no ?? ''} is not approved yet`.replace(/\s+/g, ' '));
  if (required && !live) reasons.push(`${DISPATCH_LABEL[dispatchType]} not created yet`);
  if (required && live && live.status !== DocumentStatus.COMPLETE) {
    reasons.push(`${DISPATCH_LABEL[dispatchType]} ${live.vehicleDispatchNo ?? ''} is not approved yet`.replace(/\s+/g, ' '));
  }

  return {
    dispatchType,
    sourceId,
    sourceNo: source.no ?? null,
    sourceStatus: document?.status ?? null,
    sourceComplete,
    required,
    dispatch: live,
    ready: reasons.length === 0,
    reasons,
  };
}

export async function assertDispatchGate(manager: EntityManager, dispatchType: DispatchType, sourceId: string): Promise<DispatchGate> {
  const gate = await dispatchGate(manager, dispatchType, sourceId);
  if (!gate.ready) throw new AppError(400, `Cannot continue yet: ${gate.reasons.join('; ')}`);
  return gate;
}

/**
 * Gate for the documents raised from a Customer DC (Final Invoice, Return by
 * Customer): the DC and its sales dispatch - or, for a DC raised from a GRN
 * delivered direct to the customer, that GRN and its purchase dispatch.
 */
export async function assertCustomerDcReady(manager: EntityManager, dcId: string): Promise<void> {
  const rows: Array<{ grn_id: string | null; direct: boolean }> = await manager.query(
    `SELECT dc.grn_id::text AS grn_id, ${directSaleDcSql('dc.id')} AS direct FROM delivery_challan_purchase dc WHERE dc.id = $1`,
    [dcId],
  );
  if (!rows[0]) throw new AppError(404, 'Customer delivery challan not found');
  if (rows[0].direct && rows[0].grn_id) {
    const gate = await dispatchGate(manager, DispatchType.PURCHASE, rows[0].grn_id);
    // The DC itself must be approved too.
    const dcDoc = await new DispatchSourceResolver(manager).sourceDocument(DispatchType.SALES, dcId);
    const reasons = [...gate.reasons];
    if (dcDoc?.status !== DocumentStatus.COMPLETE) reasons.unshift('Customer DC is not approved yet');
    if (reasons.length) throw new AppError(400, `Cannot continue yet: ${reasons.join('; ')}`);
    return;
  }
  await assertDispatchGate(manager, DispatchType.SALES, dcId);
}

// ─── Approval ─────────────────────────────────────────────────────────────────

async function loadDispatchSource(manager: EntityManager, dispatchId: string): Promise<{ dispatchType: DispatchType; sourceId: string | null } | null> {
  const rows = await manager.query(
    `SELECT "dispatchType"::text AS type, COALESCE(grn_id, delivery_challan_id)::text AS source_id FROM dispatch WHERE id = $1`,
    [dispatchId],
  );
  return rows[0] ? { dispatchType: rows[0].type as DispatchType, sourceId: rows[0].source_id ?? null } : null;
}

/** Why the dispatch cannot be approved yet, or null when it can (legacy rows without a source never block). */
export async function approvalBlockedReason(manager: EntityManager, dispatchId: string): Promise<string | null> {
  const link = await loadDispatchSource(manager, dispatchId);
  if (!link?.sourceId) return null;
  const source = await loadSourceRow(manager, link.dispatchType, link.sourceId);
  const label = `${SOURCE_SHORT_LABEL[link.dispatchType]} ${source?.no ?? ''}`.replace(/\s+/g, ' ').trim();
  if (!source || source.deleted) return `${label} was deleted, so this dispatch cannot be approved`;
  const document = await new DispatchSourceResolver(manager).sourceDocument(link.dispatchType, link.sourceId);
  if (document?.status === DocumentStatus.COMPLETE) return null;
  // D-4: a purchase dispatch can be approved once the GRN's approvers have approved it.
  if (link.dispatchType === DispatchType.PURCHASE && isGrnReceivableStatus(document?.status)) return null;
  if (document?.status === DocumentStatus.REJECT) return `${label} was rejected, so this dispatch cannot be approved`;
  return `${label} must complete its approval before this dispatch can be approved`;
}

/**
 * Called by the single-level approval just before a dispatch becomes COMPLETE:
 * refuses while the source is not COMPLETE, then re-copies the product lines and
 * totals from the final source so the approved dispatch matches it.
 */
export async function prepareDispatchApproval(manager: EntityManager, dispatchId: string): Promise<void> {
  const reason = await approvalBlockedReason(manager, dispatchId);
  if (reason) throw new AppError(400, reason);

  const link = await loadDispatchSource(manager, dispatchId);
  if (!link?.sourceId) return;
  const existing = await manager.query(`SELECT COUNT(*)::int AS n FROM dispatch_product WHERE dispatch_id = $1`, [dispatchId]);
  if (!existing[0]?.n) return; // legacy dispatch without lines: nothing to refresh

  await manager.transaction(async (m) => {
    const source = await new DispatchSourceResolver(m).resolve(link.dispatchType, link.sourceId!);
    const dispatch = await m.getRepository(VehicleDispatch).findOneOrFail({ where: { id: dispatchId } });
    await m.query(`DELETE FROM dispatch_product WHERE dispatch_id = $1`, [dispatchId]);
    const lines = buildDispatchProducts(m, source.products).map((line) => Object.assign(line, { dispatch: { id: dispatchId } }));
    await m.getRepository(DispatchProduct).save(lines);
    dispatch.totalQuantity = decimalOrNull(source.totals.quantity) as string;
    dispatch.totalGrossWeight = decimalOrNull(source.totals.grossWeight) as string;
    dispatch.totalNetWeight = decimalOrNull(source.totals.netWeight) as string;
    dispatch.totalAmount = decimalOrNull(source.totals.amount) as string;
    await m.getRepository(VehicleDispatch).save(dispatch);
  });
}

// ─── Refresh from an edited GRN ───────────────────────────────────────────────

export interface RefreshedDispatch {
  dispatchId: string;
  documentId: string | null;
  vehicleDispatchNo: string | null;
  /** The dispatch's copy of the GRN changed, so its approval must start again. */
  changed: boolean;
}

const refId = (value: any): string | null => (value && typeof value === 'object' ? value.id ?? null : value ?? null);
const decimalText = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
};

/** What a purchase dispatch copies from its GRN, normalised for comparison. */
function purchaseCopySnapshot(header: {
  company: string | null;
  source: string | null;
  vendor: string | null;
  farmer: string | null;
  fromLocation: string | null;
  fromText: string | null;
  toLocation: string | null;
  batchNo: string | null;
  totals: Array<string | null>;
}, lines: DispatchProduct[]): string {
  const lineState = lines
    .map((l) => [
      refId(l.productName), refId(l.variant), refId(l.uom), refId(l.packagingMaterial),
      decimalText(l.quantity), decimalText(l.unitPrice), decimalText(l.amount),
      decimalText(l.packingMaterialWeight), decimalText(l.grossWeight), decimalText(l.netWeight),
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ header, lineState });
}

/**
 * GRN edit rule D1-D3 (docs/grn-edit-rules-plan.md): a pending purchase dispatch keeps its copy of
 * the GRN in step with it. Rebuilds the lines, totals, company, party, from / to location and batch no
 * from the GRN; the destination follows the delivery mode (a direct-to-customer GRN has no CC / DC
 * destination; a CC / DC GRN has no customer). Transport details (transporter, vehicle, driver,
 * times, remarks) are the dispatch's own and stay. Approved dispatches are left alone (they block the
 * GRN edit); legacy dispatches without lines are skipped. Runs inside the GRN edit's transaction.
 */
export async function refreshPendingPurchaseDispatch(m: EntityManager, grnId: string): Promise<RefreshedDispatch | null> {
  const resolver = new DispatchSourceResolver(m);
  const live = await resolver.liveDispatch(DispatchType.PURCHASE, grnId);
  if (!live || live.status === DocumentStatus.COMPLETE) return null;

  const repo = m.getRepository(VehicleDispatch);
  const d = await repo.findOne({
    where: { id: live.id },
    relations: [
      'companyName', 'vendor', 'farmer', 'fromLocation', 'toLocation', 'customer', 'toAddress',
      'products', 'products.productName', 'products.variant', 'products.uom', 'products.packagingMaterial',
    ],
  });
  if (!d || !d.products?.length) return null;

  const source = await resolver.resolve(DispatchType.PURCHASE, grnId);
  const direct = source.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER;
  const party = source.party;
  const next = {
    company: source.company?.id ?? null,
    source: party?.type ?? null,
    vendor: party?.type === Source.VENDOR ? party.id : null,
    farmer: party?.type === Source.FARMER ? party.id : null,
    fromLocation: source.fromLocation?.id ?? null,
    fromText: source.fromText ?? null,
    toLocation: direct ? null : source.toLocation?.id ?? null,
    batchNo: source.batchNo ?? null,
    totals: [source.totals.quantity, source.totals.grossWeight, source.totals.netWeight, source.totals.amount].map(decimalText),
  };
  const nextLines = buildDispatchProducts(m, source.products);

  const before = purchaseCopySnapshot(
    {
      company: refId(d.companyName),
      source: d.source ?? null,
      vendor: refId(d.vendor),
      farmer: refId(d.farmer),
      fromLocation: refId(d.fromLocation),
      fromText: d.fromText ?? null,
      toLocation: refId(d.toLocation),
      batchNo: d.batchNo ?? null,
      totals: [d.totalQuantity, d.totalGrossWeight, d.totalNetWeight, d.totalAmount].map(decimalText),
    },
    d.products,
  );
  // A CC / DC dispatch that still has a customer (or a direct one without a destination change) also counts.
  const customerMismatch = !direct && (!!d.customer || !!d.toAddress);
  const changed = customerMismatch || before !== purchaseCopySnapshot(next, nextLines);
  const result = { dispatchId: d.id, documentId: live.documentId, vehicleDispatchNo: d.vehicleDispatchNo ?? null, changed };
  if (!changed) return result;

  d.companyName = (next.company ? { id: next.company } : null) as any;
  d.source = next.source as any;
  d.vendor = (next.vendor ? { id: next.vendor } : null) as any;
  d.farmer = (next.farmer ? { id: next.farmer } : null) as any;
  d.fromLocation = (next.fromLocation ? { id: next.fromLocation } : null) as any;
  d.fromText = next.fromText as any;
  d.toLocation = (next.toLocation ? { id: next.toLocation } : null) as any;
  d.batchNo = next.batchNo as any;
  if (!direct) {
    // To a CC / DC: no customer. (A direct dispatch keeps any customer already picked on its form.)
    d.customer = null as any;
    d.toAddress = null as any;
    d.clientName = null as any;
    d.usesCurrentShippingAddress = false;
  }
  d.totalQuantity = next.totals[0] as string;
  d.totalGrossWeight = next.totals[1] as string;
  d.totalNetWeight = next.totals[2] as string;
  d.totalAmount = next.totals[3] as string;

  await m.query(`DELETE FROM dispatch_product WHERE dispatch_id = $1`, [d.id]);
  d.products = undefined as any;
  await repo.save(d);
  await m.getRepository(DispatchProduct).save(nextLines.map((line) => Object.assign(line, { dispatch: { id: d.id } })));
  return result;
}

// ─── Cascade ──────────────────────────────────────────────────────────────────

export interface AutoRejectedDispatch {
  dispatchId: string;
  documentId: string;
  vehicleDispatchNo: string | null;
  creatorId: string | null;
}

/**
 * Rejects the pending dispatches of sources that were rejected or deleted. Only
 * dispatches whose approval is still open are touched (an approved dispatch belongs
 * to a source that was already COMPLETE). Returns what was rejected so the caller can
 * notify the creators and clear caches. No-op for document types that are not sources.
 */
export async function rejectDispatchesOfSources(
  manager: EntityManager,
  sourceDocumentType: string,
  sourceIds: string[],
  reason: string,
): Promise<AutoRejectedDispatch[]> {
  const dispatchType = DISPATCH_TYPE_OF_SOURCE_DOC[sourceDocumentType];
  const ids = sourceIds.filter(Boolean);
  if (!dispatchType || !ids.length) return [];

  const fk = SOURCE_FK_COLUMN[dispatchType];
  const rows: Array<{ dispatch_id: string; document_id: string; no: string | null; creator_id: string | null; source_id: string }> = await manager.query(
    `SELECT d.id::text AS dispatch_id, doc.id::text AS document_id, d."vehicleDispatchNo" AS no,
            doc.last_action_by::text AS creator_id, d."${fk}"::text AS source_id
       FROM dispatch d
       JOIN LATERAL (SELECT id, status, last_action_by FROM documents WHERE document_type_id = d.id::text AND type::text = $3 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1) doc ON true
      WHERE d."${fk}" = ANY($1::uuid[]) AND d."dispatchType"::text = $2 AND d."deletedAt" IS NULL AND d."isDeleted" = false
        AND doc.status::text NOT IN ($4, $5)`,
    [ids, dispatchType, DISPATCH_DOCUMENT_TYPE, DocumentStatus.REJECT, DocumentStatus.COMPLETE],
  );
  if (!rows.length) return [];

  await manager.query(
    `UPDATE documents SET status = $1, remarks = $2 WHERE id = ANY($3::uuid[])`,
    [DocumentStatus.REJECT, `${AUTO_REJECT_PREFIX}${reason}`, rows.map((r) => r.document_id)],
  );
  if (dispatchType === DispatchType.PURCHASE) {
    for (const sourceId of new Set(rows.map((r) => r.source_id))) await syncGrnVehicleDispatchFlag(manager, sourceId);
  }
  return rows.map((r) => ({ dispatchId: r.dispatch_id, documentId: r.document_id, vehicleDispatchNo: r.no, creatorId: r.creator_id }));
}

/** Notifies the creators of auto-rejected dispatches (best effort, never throws). */
export async function notifyAutoRejected(
  rejected: AutoRejectedDispatch[],
  reason: string,
  notify: (message: string, userId: string) => Promise<unknown>,
): Promise<void> {
  for (const r of rejected) {
    if (!r.creatorId) continue;
    try {
      await notify(`Vehicle dispatch ${r.vehicleDispatchNo ?? ''} was rejected automatically: ${reason}`.replace(/\s+/g, ' '), r.creatorId);
    } catch {
      // ignore
    }
  }
}

// ─── Status lists ─────────────────────────────────────────────────────────────

export type SourceDispatchStatus = 'None' | 'Pending' | 'Approved' | 'Not Required';

export interface SourceDispatchInfo {
  status: SourceDispatchStatus;
  vehicleDispatchNo: string | null;
  documentId: string | null;
}

/** Dispatch status of many sources of one register (list chips). */
export async function sourceDispatchStatuses(
  manager: EntityManager,
  dispatchType: DispatchType,
  sourceIds: string[],
): Promise<Record<string, SourceDispatchInfo>> {
  const ids = Array.from(new Set(sourceIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 500);
  const result: Record<string, SourceDispatchInfo> = {};
  if (!ids.length) return result;

  const { table } = SOURCE_TABLE[dispatchType];
  const fk = SOURCE_FK_COLUMN[dispatchType];
  const directSale = dispatchType === DispatchType.SALES ? directSaleDcSql('s.id') : 'false';
  const rows: Array<{ id: string; required: boolean; direct_sale: boolean; dispatch_no: string | null; document_id: string | null; status: string | null }> =
    await manager.query(
      `SELECT s.id::text AS id, ${dispatchRequiredSql('s."createdAt"')} AS required, ${directSale} AS direct_sale,
              lv.no AS dispatch_no, lv.document_id, lv.status
         FROM "${table}" s
         LEFT JOIN LATERAL (
           SELECT d."vehicleDispatchNo" AS no, doc.id::text AS document_id, doc.status::text AS status
             FROM dispatch d
             LEFT JOIN LATERAL (SELECT id, status FROM documents WHERE document_type_id = d.id::text AND type::text = $3 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1) doc ON true
            WHERE d."${fk}" = s.id AND d."dispatchType"::text = $2 AND d."deletedAt" IS NULL AND d."isDeleted" = false
              AND (doc.status IS NULL OR doc.status::text <> $4)
            ORDER BY d."createdAt" DESC LIMIT 1) lv ON true
        WHERE s.id = ANY($1::uuid[])`,
      [ids, dispatchType, DISPATCH_DOCUMENT_TYPE, DocumentStatus.REJECT],
    );
  for (const row of rows) {
    const status: SourceDispatchStatus = row.dispatch_no || row.document_id
      ? row.status === DocumentStatus.COMPLETE ? 'Approved' : 'Pending'
      : !row.required || row.direct_sale ? 'Not Required' : 'None';
    result[row.id] = { status, vehicleDispatchNo: row.dispatch_no ?? null, documentId: row.document_id ?? null };
  }
  return result;
}

/** Per register: sources since go-live, not rejected / deleted, that still have no live dispatch. */
export async function pendingDispatchCounts(manager: EntityManager): Promise<Record<DispatchType, number>> {
  const count = async (dispatchType: DispatchType, table: string, discriminator: string | null): Promise<number> => {
    const extra = [
      discriminator ? `s.type = '${discriminator}'` : 'true',
      dispatchType === DispatchType.SALES ? `NOT ${directSaleDcSql('s.id')}` : 'true',
    ].join(' AND ');
    const rows = await manager.query(
      `SELECT COUNT(*)::int AS n FROM "${table}" s
        WHERE s."isDeleted" = false AND s."deletedAt" IS NULL AND ${extra}
          AND ${dispatchRequiredSql('s."createdAt"')} AND ${liveSourceSql('s.id', dispatchType)}
          AND NOT ${liveDispatchExistsSql('s.id', dispatchType)}`,
    );
    return rows[0]?.n ?? 0;
  };
  return {
    [DispatchType.PURCHASE]: await count(DispatchType.PURCHASE, 'grns', null),
    [DispatchType.STOCK_TRANSFER]: await count(DispatchType.STOCK_TRANSFER, 'delivery_challan_purchase', 'stock-transfer-delivery-challan'),
    [DispatchType.SALES]: await count(DispatchType.SALES, 'delivery_challan_purchase', 'customer_delivery_challan'),
  };
}
