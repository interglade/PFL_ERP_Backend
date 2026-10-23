import { EntityManager, SelectQueryBuilder } from 'typeorm';
import AppError from '../../utils/appError';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { GRN, GrnDeliveryMode } from '../../grn/entity/grn.entity';
import { GrnProduct } from '../../grn/entity/grnProduct.entity';
import { StockTransferDeliveryChallan } from '../../deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity';
import { CustomerDeliveryChallan } from '../../deliveryChallans/customerDeliveryChllan/entity/customerDeliveryChallan.entity';
import { Item } from '../../deliveryChallans/deliverychllan/entity/dItem.entity';
import { Source } from '../../utils/status.enum';
import { DispatchType } from '../entity/vehicleDispatch.entity';
import { formatAddress, mapAddress, AddressPayload } from '../../transport/transport.utils';

/**
 * Everything a dispatch needs from its source document (docs/vehicle-dispatch-plan.md
 * §3.1): purchase → GRN, stock transfer → Stock Transfer DC, sales → Customer DC.
 *
 * Relations are loaded through TypeORM metadata rather than hard-coded column
 * names: the three delivery challan children share one table and declare
 * `fromLocation` with different join columns (docs/receiving-links-plan.md §5).
 */

export interface SourceLine {
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantName: string | null;
  uomId: string | null;
  uomName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  packagingMaterialId: string | null;
  packagingMaterialName: string | null;
  /** grams per packaging unit */
  packingMaterialWeight: number | null;
  /** kg */
  grossWeight: number | null;
  /** kg */
  netWeight: number | null;
}

export interface SourceTotals {
  quantity: number;
  grossWeight: number;
  netWeight: number;
  amount: number;
}

export interface NamedRef {
  id: string;
  name: string | null;
}

export interface ResolvedSource {
  dispatchType: DispatchType;
  sourceId: string;
  sourceNo: string | null;
  sourceDocumentId: string | null;
  sourceStatus: string | null;
  company: NamedRef | null;
  deliveryMode: GrnDeliveryMode | null;
  source: Source | null;
  party: (NamedRef & { type: Source }) | null;
  fromLocation: NamedRef | null;
  fromText: string | null;
  toLocation: NamedRef | null;
  customer: NamedRef | null;
  currentShippingAddress: AddressPayload | null;
  /** Purchase only: the GRN's batch no, offered as the default for the dispatch's batch no. */
  batchNo?: string | null;
  /** Purchase only: the GRN's receiving person, offered as the default for the dispatch's receiving person. */
  receivingPerson?: string | null;
  products: SourceLine[];
  totals: SourceTotals;
}

export interface SourceOption {
  id: string;
  no: string | null;
  date: Date | string | null;
  companyName: string | null;
  partyName: string | null;
  fromName: string | null;
  toName: string | null;
  deliveryMode: GrnDeliveryMode | null;
  /** Approval status of the source (`documents.status`); any status except rejected can be dispatched. */
  status?: string | null;
}

/** `documents.type` of each source. */
export const SOURCE_DOCUMENT_TYPE: Record<DispatchType, DocumentTypeEnum> = {
  [DispatchType.PURCHASE]: DocumentTypeEnum.GRN,
  [DispatchType.STOCK_TRANSFER]: DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
  [DispatchType.SALES]: DocumentTypeEnum.DC_TYPE_CUSTOMER,
};

/** The `dispatch` column that points at each source. Sales and stock transfer share the delivery challan link. */
export const SOURCE_FK_COLUMN: Record<DispatchType, 'grn_id' | 'delivery_challan_id'> = {
  [DispatchType.PURCHASE]: 'grn_id',
  [DispatchType.STOCK_TRANSFER]: 'delivery_challan_id',
  [DispatchType.SALES]: 'delivery_challan_id',
};

/** Table holding each source, for the row lock. */
const SOURCE_TABLE: Record<DispatchType, string> = {
  [DispatchType.PURCHASE]: 'grns',
  [DispatchType.STOCK_TRANSFER]: 'delivery_challan_purchase',
  [DispatchType.SALES]: 'delivery_challan_purchase',
};

export const DISPATCH_DOCUMENT_TYPE = DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER;

export function isDispatchType(value: unknown): value is DispatchType {
  return Object.values(DispatchType).includes(value as DispatchType);
}

export function assertDispatchType(value: unknown): DispatchType {
  if (!isDispatchType(value)) {
    throw new AppError(400, `dispatchType must be one of ${Object.values(DispatchType).join(', ')}`);
  }
  return value;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (value: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

export function totalsOf(lines: Pick<SourceLine, 'quantity' | 'grossWeight' | 'netWeight' | 'amount'>[]): SourceTotals {
  const sum = (pick: (l: SourceLine) => number | null) =>
    lines.reduce((acc, line) => acc + (pick(line as SourceLine) ?? 0), 0);
  return {
    quantity: round(sum((l) => l.quantity), 3),
    grossWeight: round(sum((l) => l.grossWeight), 4),
    netWeight: round(sum((l) => l.netWeight), 4),
    amount: round(sum((l) => l.amount), 4),
  };
}

export function partyName(source: Source | null | undefined, vendor: any, farmer: any): string | null {
  if (source === Source.VENDOR && vendor) return vendor.companyName ?? null;
  if (source === Source.FARMER && farmer) {
    return [farmer.farmerfName, farmer.farmermName, farmer.farmerlName].filter(Boolean).join(' ') || null;
  }
  return null;
}

const named = (ref: any, field = 'name'): NamedRef | null => (ref?.id ? { id: ref.id, name: ref[field] ?? null } : null);

export function grnLine(p: GrnProduct): SourceLine {
  return {
    productId: p.productName?.id ?? null,
    productName: p.productName?.name ?? null,
    variantId: p.variant?.id ?? null,
    variantName: p.variant?.variantName ?? null,
    uomId: p.uom?.id ?? null,
    uomName: p.uom?.unit ?? null,
    // Revised values win when the GRN was revised at verification.
    quantity: num(p.revisedQuantity) ?? num(p.quantity),
    unitPrice: num(p.revisedRate) ?? num(p.unitPrice),
    amount: num(p.amount),
    packagingMaterialId: p.packagingMaterial?.id ?? null,
    packagingMaterialName: p.packagingMaterial?.packagingMaterialName ?? null,
    packingMaterialWeight: num(p.packingMaterialWeight),
    grossWeight: num(p.grossWeight),
    netWeight: num(p.netWeight),
  };
}

export function dcLine(i: Item): SourceLine {
  return {
    productId: i.productName?.id ?? null,
    productName: i.productName?.name ?? null,
    variantId: i.variant?.id ?? null,
    variantName: i.variant?.variantName ?? null,
    uomId: i.uom?.id ?? null,
    uomName: i.uom?.unit ?? null,
    quantity: num(i.quantity),
    unitPrice: num(i.unitPrice),
    amount: num(i.amount),
    packagingMaterialId: i.packagingMaterial?.id ?? null,
    packagingMaterialName: i.packagingMaterial?.packagingMaterialName ?? null,
    packingMaterialWeight: num(i.packingMaterialWeight),
    grossWeight: num(i.grossWeight),
    netWeight: num(i.netWeight),
  };
}

/** SQL: a live (not deleted, not rejected) dispatch of this type points at the source. */
export function liveDispatchExistsSql(sourceIdExpr: string, dispatchType: DispatchType): string {
  const fk = SOURCE_FK_COLUMN[dispatchType];
  return (
    `EXISTS (SELECT 1 FROM dispatch ld WHERE ld."${fk}" = ${sourceIdExpr} AND ld."dispatchType"::text = '${dispatchType}' ` +
    `AND ld."deletedAt" IS NULL AND ld."isDeleted" = false ` +
    `AND NOT EXISTS (SELECT 1 FROM documents ldd WHERE ldd.document_type_id = ld.id::text ` +
    `AND ldd.type::text = '${DISPATCH_DOCUMENT_TYPE}' AND ldd.status::text = '${DocumentStatus.REJECT}' AND ldd."deletedAt" IS NULL))`
  );
}

/**
 * Recomputes `grns.isVehicleDispatchCreated` from the dispatch table, so the flag can
 * never disagree with `liveDispatch`. Call after a purchase dispatch is created,
 * deleted or its approval is rejected.
 */
export async function syncGrnVehicleDispatchFlag(manager: EntityManager, grnId: string | null | undefined): Promise<void> {
  if (!grnId) return;
  await manager.query(
    `UPDATE grns SET "isVehicleDispatchCreated" = ${liveDispatchExistsSql('grns.id', DispatchType.PURCHASE)} WHERE grns.id = $1`,
    [grnId],
  );
}

/** Same as `syncGrnVehicleDispatchFlag`, starting from a dispatch id (no-op for non-purchase dispatches). */
export async function syncGrnVehicleDispatchFlagForDispatch(manager: EntityManager, dispatchId: string): Promise<void> {
  const rows: Array<{ grn_id: string | null }> = await manager.query(
    `SELECT grn_id::text AS grn_id FROM dispatch WHERE id = $1 AND "dispatchType"::text = $2`,
    [dispatchId, DispatchType.PURCHASE],
  );
  await syncGrnVehicleDispatchFlag(manager, rows[0]?.grn_id);
}

/**
 * SQL: the source has an approval document whose latest status is not REJECT - a
 * dispatch may be created as soon as the source exists (docs/dispatch-enforcement-plan.md D1).
 */
export function liveSourceSql(sourceIdExpr: string, dispatchType: DispatchType): string {
  return (
    `COALESCE((SELECT sd.status::text FROM documents sd WHERE sd.document_type_id = (${sourceIdExpr})::text ` +
    `AND sd.type::text = '${SOURCE_DOCUMENT_TYPE[dispatchType]}' AND sd."deletedAt" IS NULL ORDER BY sd."createdAt" DESC LIMIT 1), ` +
    `'${DocumentStatus.REJECT}') <> '${DocumentStatus.REJECT}'`
  );
}

/** Physical columns the delivery challan children may have stored their from-location in, most likely first. */
const DC_FROM_LOCATION_COLUMNS = ['branch_id', 'from_location_id', 'other_from_location_id_for_other'];

export class DispatchSourceResolver {
  constructor(private readonly manager: EntityManager) {}

  /**
   * From-location of a delivery challan, read through the column that physically
   * exists. TypeORM resolves the colliding `fromLocation` declarations differently in
   * the app and in a standalone script, so the relation cannot be trusted outside the
   * app (docs/receiving-links-plan.md §5).
   */
  private async dcFromLocation(dcId: string): Promise<NamedRef | null> {
    const present: Array<{ column_name: string }> = await this.manager.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'delivery_challan_purchase' AND column_name = ANY($1::text[])`,
      [DC_FROM_LOCATION_COLUMNS],
    );
    const names = new Set(present.map((r) => r.column_name));
    for (const column of DC_FROM_LOCATION_COLUMNS.filter((c) => names.has(c))) {
      const rows = await this.manager.query(
        `SELECT b.id::text AS id, b.name AS name FROM delivery_challan_purchase dc JOIN branches b ON b.id = dc."${column}" WHERE dc.id = $1`,
        [dcId],
      );
      if (rows[0]) return { id: rows[0].id, name: rows[0].name ?? null };
    }
    return null;
  }

  /** Locks the source row for the rest of the transaction (one dispatch per source). */
  async lockSource(dispatchType: DispatchType, sourceId: string): Promise<void> {
    const rows = await this.manager.query(`SELECT id FROM "${SOURCE_TABLE[dispatchType]}" WHERE id = $1 FOR UPDATE`, [sourceId]);
    if (!rows.length) throw new AppError(404, 'Source document not found');
  }

  /**
   * Loads a delivery challan with an explicit column list. Loading the whole entity
   * would also select the colliding `fromLocation` foreign key, which only resolves
   * correctly inside the app (see `dcFromLocation`).
   */
  private async loadChallan(
    entity: typeof StockTransferDeliveryChallan | typeof CustomerDeliveryChallan,
    id: string,
    extend: (qb: SelectQueryBuilder<any>) => SelectQueryBuilder<any>,
  ): Promise<StockTransferDeliveryChallan | CustomerDeliveryChallan | null> {
    const qb = (this.manager.getRepository(entity) as any)
      .createQueryBuilder('dc')
      .select(['dc.id', 'dc.challanNo', 'dc.isDeleted'])
      .leftJoin('dc.companyName', 'company')
      .addSelect(['company.id', 'company.name'])
      .leftJoin('dc.deliveryChallanProducts', 'item')
      .addSelect([
        'item.id', 'item.quantity', 'item.unitPrice', 'item.amount',
        'item.packingMaterialWeight', 'item.grossWeight', 'item.netWeight', 'item.deletedAt',
      ])
      .leftJoin('item.productName', 'product')
      .addSelect(['product.id', 'product.name'])
      .leftJoin('item.variant', 'variant')
      .addSelect(['variant.id', 'variant.variantName'])
      .leftJoin('item.uom', 'uom')
      .addSelect(['uom.id', 'uom.unit'])
      .leftJoin('item.packagingMaterial', 'packaging')
      .addSelect(['packaging.id', 'packaging.packagingMaterialName'])
      .where('dc.id = :id', { id })
      .orderBy('item.createdAt', 'ASC');
    return extend(qb).getOne();
  }

  /** The source's latest live `documents` row (status + id). */
  async sourceDocument(dispatchType: DispatchType, sourceId: string): Promise<{ id: string; status: string } | null> {
    const rows = await this.manager.query(
      `SELECT id::text AS id, status::text AS status FROM documents WHERE document_type_id = $1 AND type::text = $2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [sourceId, SOURCE_DOCUMENT_TYPE[dispatchType]],
    );
    return rows[0] ?? null;
  }

  /** The live dispatch already raised against the source, if any. */
  async liveDispatch(
    dispatchType: DispatchType,
    sourceId: string,
    excludeDispatchId?: string,
  ): Promise<{ id: string; vehicleDispatchNo: string | null; documentId: string | null; status: string | null } | null> {
    const fk = SOURCE_FK_COLUMN[dispatchType];
    const params: unknown[] = [sourceId, dispatchType, DISPATCH_DOCUMENT_TYPE, DocumentStatus.REJECT];
    let exclude = '';
    if (excludeDispatchId) {
      params.push(excludeDispatchId);
      exclude = `AND d.id <> $5`;
    }
    const rows = await this.manager.query(
      `SELECT d.id::text AS id, d."vehicleDispatchNo" AS "vehicleDispatchNo", doc.id::text AS "documentId", doc.status::text AS status
         FROM dispatch d
         LEFT JOIN LATERAL (SELECT id, status FROM documents WHERE document_type_id = d.id::text AND type::text = $3 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1) doc ON true
        WHERE d."${fk}" = $1 AND d."dispatchType"::text = $2 AND d."deletedAt" IS NULL AND d."isDeleted" = false
          AND (doc.status IS NULL OR doc.status::text <> $4) ${exclude}
        ORDER BY d."createdAt" DESC LIMIT 1`,
      params,
    );
    return rows[0] ?? null;
  }

  async resolve(dispatchType: DispatchType, sourceId: string): Promise<ResolvedSource> {
    const document = await this.sourceDocument(dispatchType, sourceId);
    const base = { dispatchType, sourceId, sourceDocumentId: document?.id ?? null, sourceStatus: document?.status ?? null };

    if (dispatchType === DispatchType.PURCHASE) {
      const grn = await this.manager.getRepository(GRN).findOne({
        where: { id: sourceId },
        relations: [
          'companyName', 'purchaseLocation', 'purchaseForSalesLocation',
          'selectedVendor', 'selectedVendor.officeAddress', 'selectedFarmer', 'selectedFarmer.farmAddress',
          'grnProducts', 'grnProducts.productName', 'grnProducts.variant', 'grnProducts.uom', 'grnProducts.packagingMaterial',
        ],
      });
      if (!grn || grn.isDeleted) throw new AppError(404, 'GRN not found');
      const products = (grn.grnProducts ?? []).filter((p) => !p.deletedAt).map(grnLine);
      const party = partyName(grn.source, grn.selectedVendor, grn.selectedFarmer);
      const partyRef = grn.source === Source.VENDOR ? grn.selectedVendor : grn.source === Source.FARMER ? grn.selectedFarmer : null;
      const partySite = grn.source === Source.VENDOR ? grn.selectedVendor?.officeAddress : grn.selectedFarmer?.farmAddress;
      const direct = grn.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER;
      return {
        ...base,
        sourceNo: grn.grnNo ?? null,
        company: named(grn.companyName),
        deliveryMode: grn.deliveryMode ?? GrnDeliveryMode.CC_DC,
        source: grn.source ?? null,
        party: partyRef?.id && grn.source ? { id: partyRef.id, name: party, type: grn.source } : null,
        fromLocation: named(grn.purchaseLocation),
        fromText: grn.purchaseLocation ? null : grn.otherPurchaseLoc || formatAddress(partySite) || null,
        toLocation: direct ? null : named(grn.purchaseForSalesLocation),
        customer: null,
        currentShippingAddress: null,
        batchNo: grn.batchNo ?? null,
        receivingPerson: grn.receivingPerson ?? null,
        products,
        totals: totalsOf(products),
      };
    }

    if (dispatchType === DispatchType.STOCK_TRANSFER) {
      const dc = (await this.loadChallan(StockTransferDeliveryChallan, sourceId, (qb) =>
        qb.leftJoin('dc.toLocation', 'toLoc').addSelect(['toLoc.id', 'toLoc.name']),
      )) as StockTransferDeliveryChallan | null;
      if (!dc || dc.isDeleted) throw new AppError(404, 'Stock transfer delivery challan not found');
      const products = (dc.deliveryChallanProducts ?? []).filter((i) => !i.deletedAt).map(dcLine);
      return {
        ...base,
        sourceNo: dc.challanNo ?? null,
        company: named(dc.companyName),
        deliveryMode: null,
        source: null,
        party: null,
        fromLocation: await this.dcFromLocation(dc.id),
        fromText: null,
        toLocation: named(dc.toLocation),
        customer: null,
        currentShippingAddress: null,
        products,
        totals: totalsOf(products),
      };
    }

    const dc = (await this.loadChallan(CustomerDeliveryChallan, sourceId, (qb) =>
      qb
        .leftJoin('dc.customerName', 'customer')
        .addSelect(['customer.id', 'customer.organisationName'])
        .leftJoin('dc.currentShippingAddress', 'shipping')
        .addSelect(['shipping.id', 'shipping.address1', 'shipping.address2', 'shipping.location', 'shipping.city', 'shipping.state', 'shipping.pincode']),
    )) as CustomerDeliveryChallan | null;
    if (!dc || dc.isDeleted) throw new AppError(404, 'Customer delivery challan not found');
    const products = (dc.deliveryChallanProducts ?? []).filter((i) => !i.deletedAt).map(dcLine);
    return {
      ...base,
      sourceNo: dc.challanNo ?? null,
      company: named(dc.companyName),
      deliveryMode: null,
      source: null,
      party: null,
      fromLocation: await this.dcFromLocation(dc.id),
      fromText: null,
      toLocation: null,
      customer: named(dc.customerName, 'organisationName'),
      currentShippingAddress: mapAddress(dc.currentShippingAddress),
      products,
      totals: totalsOf(products),
    };
  }

  /** Sources of this register that exist, are not rejected and do not have a live dispatch yet, with their status. */
  async dispatchableSources(dispatchType: DispatchType, search?: string, limit = 50): Promise<SourceOption[]> {
    const options = await this.loadDispatchableSources(dispatchType, search, limit);
    if (!options.length) return options;
    const rows: Array<{ id: string; status: string | null }> = await this.manager.query(
      `SELECT s.id, (SELECT d.status::text FROM documents d WHERE d.document_type_id = s.id::text AND d.type::text = $2 AND d."deletedAt" IS NULL ORDER BY d."createdAt" DESC LIMIT 1) AS status
         FROM unnest($1::text[]) AS s(id)`,
      [options.map((o) => o.id), SOURCE_DOCUMENT_TYPE[dispatchType]],
    );
    const statusById = new Map(rows.map((r) => [r.id, r.status]));
    return options.map((option) => ({ ...option, status: statusById.get(option.id) ?? null }));
  }

  private async loadDispatchableSources(dispatchType: DispatchType, search?: string, limit = 50): Promise<SourceOption[]> {
    const term = search?.trim() ? `%${search.trim()}%` : null;

    if (dispatchType === DispatchType.PURCHASE) {
      const qb = this.manager
        .getRepository(GRN)
        .createQueryBuilder('g')
        .leftJoin('g.companyName', 'company')
        .leftJoin('g.purchaseLocation', 'fromLoc')
        .leftJoin('g.purchaseForSalesLocation', 'toLoc')
        .leftJoin('g.selectedVendor', 'vendor')
        .leftJoin('g.selectedFarmer', 'farmer')
        .select([
          'g.id', 'g.grnNo', 'g.createdAt', 'g.source', 'g.deliveryMode', 'g.otherPurchaseLoc',
          'company.id', 'company.name', 'fromLoc.id', 'fromLoc.name', 'toLoc.id', 'toLoc.name',
          'vendor.id', 'vendor.companyName', 'farmer.id', 'farmer.farmerfName', 'farmer.farmermName', 'farmer.farmerlName',
        ])
        .where('g.isDeleted = false');
      this.restrictToDispatchable(qb, 'g', dispatchType);
      if (term) {
        qb.andWhere(
          '(g.grnNo ILIKE :term OR vendor.companyName ILIKE :term OR farmer.farmerfName ILIKE :term OR farmer.farmerlName ILIKE :term)',
          { term },
        );
      }
      const rows = await qb.orderBy('g.createdAt', 'DESC').take(limit).getMany();
      return rows.map((g) => {
        const direct = g.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER;
        return {
          id: g.id,
          no: g.grnNo ?? null,
          date: g.createdAt ?? null,
          companyName: g.companyName?.name ?? null,
          partyName: partyName(g.source, g.selectedVendor, g.selectedFarmer),
          fromName: g.purchaseLocation?.name ?? g.otherPurchaseLoc ?? null,
          toName: direct ? 'Direct to customer' : g.purchaseForSalesLocation?.name ?? null,
          deliveryMode: g.deliveryMode ?? GrnDeliveryMode.CC_DC,
        };
      });
    }

    if (dispatchType === DispatchType.STOCK_TRANSFER) {
      const qb = this.manager
        .getRepository(StockTransferDeliveryChallan)
        .createQueryBuilder('dc')
        .leftJoin('dc.companyName', 'company')
        .leftJoin('dc.fromLocation', 'fromLoc')
        .leftJoin('dc.toLocation', 'toLoc')
        .select(['dc.id', 'dc.challanNo', 'dc.createdAt', 'company.id', 'company.name', 'fromLoc.id', 'fromLoc.name', 'toLoc.id', 'toLoc.name'])
        .where('dc.isDeleted = false');
      this.restrictToDispatchable(qb, 'dc', dispatchType);
      if (term) qb.andWhere('(dc.challanNo ILIKE :term OR fromLoc.name ILIKE :term OR toLoc.name ILIKE :term)', { term });
      const rows = await qb.orderBy('dc.createdAt', 'DESC').take(limit).getMany();
      return rows.map((dc) => ({
        id: dc.id,
        no: dc.challanNo ?? null,
        date: dc.createdAt ?? null,
        companyName: dc.companyName?.name ?? null,
        partyName: null,
        fromName: dc.fromLocation?.name ?? null,
        toName: dc.toLocation?.name ?? null,
        deliveryMode: null,
      }));
    }

    const qb = this.manager
      .getRepository(CustomerDeliveryChallan)
      .createQueryBuilder('dc')
      .leftJoin('dc.companyName', 'company')
      .leftJoin('dc.fromLocation', 'fromLoc')
      .leftJoin('dc.customerName', 'customer')
      .select(['dc.id', 'dc.challanNo', 'dc.createdAt', 'company.id', 'company.name', 'fromLoc.id', 'fromLoc.name', 'customer.id', 'customer.organisationName'])
      .where('dc.isDeleted = false');
    this.restrictToDispatchable(qb, 'dc', dispatchType);
    if (term) qb.andWhere('(dc.challanNo ILIKE :term OR customer.organisationName ILIKE :term)', { term });
    const rows = await qb.orderBy('dc.createdAt', 'DESC').take(limit).getMany();
    return rows.map((dc) => ({
      id: dc.id,
      no: dc.challanNo ?? null,
      date: dc.createdAt ?? null,
      companyName: dc.companyName?.name ?? null,
      partyName: dc.customerName?.organisationName ?? null,
      fromName: dc.fromLocation?.name ?? null,
      toName: dc.customerName?.organisationName ?? null,
      deliveryMode: null,
    }));
  }

  private restrictToDispatchable(qb: SelectQueryBuilder<any>, alias: string, dispatchType: DispatchType): void {
    qb.andWhere(liveSourceSql(`${alias}.id`, dispatchType)).andWhere(`NOT ${liveDispatchExistsSql(`${alias}.id`, dispatchType)}`);
  }
}
