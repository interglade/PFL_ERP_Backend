/**
 * Receiving links — live status of a source (GRN / Stock Transfer DC / RBC)
 * and the Arrivals worklist (docs/receiving-links-plan.md §2.2).
 *
 * Nothing here is cached: a slot can change at any moment (a document gets
 * rejected, a new Inward is created) and the guard relies on these loaders
 * inside the caller's transaction.
 */

import { inject, injectable } from 'inversify';
import { DataSource, EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { Documentb, DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { GRN, GrnDeliveryMode } from '../../grn/entity/grn.entity';
import { StockTransferDeliveryChallan } from '../../deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity';
import { PostReturnByCustomer } from '../../returnByCustomer/entity/postReturnByCustomer.entity';
import { Aqr } from '../../aqr/entity/aqr.entity';
import { InwardRegister } from '../../inwardRegister/entity/inwardRegister.entity';
import { DumpRegister } from '../../dumpRegister/entity/dumpRegister.entity';
import { ReturnToVendor } from '../../returnToVendor/entity/returnToVendor.entity';
import { Item } from '../../deliveryChallans/deliverychllan/entity/dItem.entity';
import { ReturnedProducts } from '../../returnByCustomer/entity/returnProduct.entity';
import { Source } from '../../utils/status.enum';
import {
  AggregatedDocLine,
  ArrivalRow,
  ArrivalsFilter,
  ArrivalsResult,
  DocLineInput,
  LegacyDocuments,
  ProcessingDocType,
  ProcessingSlots,
  ReceivingSourceInfo,
  ReceivingSourceStatus,
  ReceivingSourceType,
  Slot,
  SourceLineInput,
} from '../receiving.types';
import {
  aggregateDocLines,
  aggregateSourceLines,
  buildProductRows,
  deriveState,
  isCountingDocument,
  pickSlotAndLegacy,
  round3,
  slotState,
} from '../receiving.helpers';
import {
  anyCountingDocumentSql,
  completeDocumentExistsSql,
  isReceivingSourceType,
  PROCESSING_DOCUMENT_TYPE,
  processingTypesFor,
  SOURCE_DOCUMENT_TYPE,
} from '../receiving.sql';

/** A source as the status and the guard need it. */
export interface LoadedSource {
  info: ReceivingSourceInfo;
  lines: SourceLineInput[];
  isDeleted: boolean;
}

/** A processing document with the fields the counting rule and the slot need. */
export interface ProcessingDocument {
  docType: ProcessingDocType;
  id: string;
  docNo: string | null;
  documentId: string | null;
  status: string | null;
  createdAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  sourceId: string;
  lines: DocLineInput[];
}

interface DocumentRow {
  id: string;
  status: string | null;
  createdAt: Date | null;
}

interface ArrivalSqlRow {
  source_type: ReceivingSourceType;
  source_id: string;
  source_no: string | null;
  document_id: string | null;
  company_name: string | null;
  location_id: string | null;
  location_name: string | null;
  party_name: string | null;
  source_date: Date | string | null;
  product_count: string | number | null;
  received_kg: string | number | null;
}

const ARRIVAL_SORT_COLUMNS: Record<string, string> = {
  date: 'source_date',
  sourceNo: 'source_no',
  partyName: 'party_name',
  locationName: 'location_name',
  companyName: 'company_name',
  receivedKg: 'received_kg',
  productCount: 'product_count',
};

/** Hard cap for the Excel export and for status computation in one call. */
export const ARRIVALS_EXPORT_MAX_ROWS = 5000;
const STATUS_BATCH_SIZE = 100;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@injectable()
export class ReceivingStatusService {
  constructor(@inject(TYPES.DataSource) private readonly dataSource: DataSource) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  async getSourceStatus(type: ReceivingSourceType, id: string, manager?: EntityManager): Promise<ReceivingSourceStatus> {
    if (!isReceivingSourceType(type)) {
      throw new AppError(400, 'Source type must be one of grn, stock-transfer-dc, rbc');
    }
    if (!id) throw new AppError(400, 'Source id is required');

    const em = manager ?? this.dataSource.manager;
    const source = await this.loadSource(type, id, em);
    if (!source || source.isDeleted) {
      throw new AppError(404, `${this.sourceLabel(type)} not found`);
    }
    if (type === 'grn' && source.info.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER) {
      throw new AppError(400, 'This GRN is delivered directly to the customer');
    }
    const docs = await this.loadProcessingDocuments(type, [id], em);
    return this.computeStatus(source, docs.get(id) ?? []);
  }

  /**
   * COMPLETE sources only (GRN only with `deliveryMode = cc-dc`), paginated in
   * SQL, newest first by default. The `state` filter is exact for
   * `not-started` (no counting document — evaluated in SQL); for `open`,
   * `done` and `legacy` the SQL keeps sources that have at least one counting
   * document and the exact state is applied to the page after computation, so
   * `total` for those three is the count of started sources, not of the
   * requested state.
   */
  async listArrivals(filter: ArrivalsFilter): Promise<ArrivalsResult> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filter.limit) || 20));
    const { cteSql, whereSql, orderSql, params } = this.buildArrivalsQuery(filter);

    const countRows: { total: string }[] = await this.dataSource.query(
      `WITH src AS (${cteSql}) SELECT COUNT(*)::text AS total FROM src ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const pageParams = [...params, limit, (page - 1) * limit];
    const rows: ArrivalSqlRow[] = await this.dataSource.query(
      `WITH src AS (${cteSql}) SELECT * FROM src ${whereSql} ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    );

    let data = await this.toArrivalRows(rows);
    if (filter.state && filter.state !== 'not-started') {
      data = data.filter((row) => row.state === filter.state);
    }

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  /** Same filters as {@link listArrivals}, no pagination (capped at {@link ARRIVALS_EXPORT_MAX_ROWS}). */
  async listArrivalsForExport(filter: ArrivalsFilter): Promise<ArrivalRow[]> {
    const { cteSql, whereSql, orderSql, params } = this.buildArrivalsQuery(filter);
    const rows: ArrivalSqlRow[] = await this.dataSource.query(
      `WITH src AS (${cteSql}) SELECT * FROM src ${whereSql} ${orderSql} LIMIT $${params.length + 1}`,
      [...params, ARRIVALS_EXPORT_MAX_ROWS],
    );
    let data = await this.toArrivalRows(rows);
    if (filter.state && filter.state !== 'not-started') {
      data = data.filter((row) => row.state === filter.state);
    }
    return data;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Loaders (also used by ReceivingGuardService inside the caller's transaction)
  // ───────────────────────────────────────────────────────────────────────────

  async loadSource(type: ReceivingSourceType, id: string, manager?: EntityManager): Promise<LoadedSource | null> {
    const sources = await this.loadSources(type, [id], manager ?? this.dataSource.manager);
    return sources.get(id) ?? null;
  }

  async loadSources(type: ReceivingSourceType, ids: string[], manager: EntityManager): Promise<Map<string, LoadedSource>> {
    const result = new Map<string, LoadedSource>();
    if (!ids.length) return result;

    let loaded: LoadedSource[];
    switch (type) {
      case 'grn':
        loaded = await this.loadGrns(ids, manager);
        break;
      case 'stock-transfer-dc':
        loaded = await this.loadStockTransferDcs(ids, manager);
        break;
      case 'rbc':
        loaded = await this.loadRbcs(ids, manager);
        break;
      default:
        throw new AppError(400, 'Source type must be one of grn, stock-transfer-dc, rbc');
    }

    const documents = await this.loadLatestDocuments(SOURCE_DOCUMENT_TYPE[type], loaded.map((s) => s.info.id), manager);
    for (const source of loaded) {
      const doc = documents.get(source.info.id);
      source.info.documentId = doc?.id ?? null;
      source.info.approvalStatus = doc?.status ?? null;
      source.info.isComplete = doc?.status === DocumentStatus.COMPLETE;
      result.set(source.info.id, source);
    }
    return result;
  }

  /** Number of a source without loading its lines (used for messages). */
  async loadSourceNo(type: ReceivingSourceType, id: string, manager?: EntityManager): Promise<string | null> {
    const em = manager ?? this.dataSource.manager;
    switch (type) {
      case 'grn': {
        const row = await em.getRepository(GRN).createQueryBuilder('grn').withDeleted().select(['grn.id', 'grn.grnNo']).where('grn.id = :id', { id }).getOne();
        return row?.grnNo ?? null;
      }
      case 'stock-transfer-dc': {
        const row = await em.getRepository(StockTransferDeliveryChallan).createQueryBuilder('dc').withDeleted().select(['dc.id', 'dc.challanNo']).where('dc.id = :id', { id }).getOne();
        return row?.challanNo ?? null;
      }
      case 'rbc': {
        const row = await em.getRepository(PostReturnByCustomer).createQueryBuilder('rbc').withDeleted().select(['rbc.id', 'rbc.rbcNo']).where('rbc.id = :id', { id }).getOne();
        return row?.rbcNo ?? null;
      }
      default:
        return null;
    }
  }

  /**
   * Every processing document (AQR, Inward, Dump, RTV) that references one of
   * the sources, with its lines and its `documents` status. Deleted and
   * rejected documents are included; callers apply {@link isCountingDocument}.
   */
  async loadProcessingDocuments(
    type: ReceivingSourceType,
    ids: string[],
    manager?: EntityManager,
  ): Promise<Map<string, ProcessingDocument[]>> {
    const result = new Map<string, ProcessingDocument[]>();
    if (!ids.length) return result;
    const em = manager ?? this.dataSource.manager;

    const docs: ProcessingDocument[] = [];
    for (const docType of processingTypesFor(type)) {
      switch (docType) {
        case 'aqr':
          docs.push(...(await this.loadAqrs(type, ids, em)));
          break;
        case 'inward':
          docs.push(...(await this.loadInwards(type, ids, em)));
          break;
        case 'dump':
          docs.push(...(await this.loadDumps(type, ids, em)));
          break;
        case 'rtv':
          docs.push(...(await this.loadRtvs(type, ids, em)));
          break;
      }
    }

    // Attach the approval status of each document.
    for (const docType of processingTypesFor(type)) {
      const ofType = docs.filter((d) => d.docType === docType);
      if (!ofType.length) continue;
      const statuses = await this.loadLatestDocuments(PROCESSING_DOCUMENT_TYPE[docType], ofType.map((d) => d.id), em);
      for (const doc of ofType) {
        const row = statuses.get(doc.id);
        doc.documentId = row?.id ?? null;
        doc.status = row?.status ?? null;
      }
    }

    for (const doc of docs) {
      if (!doc.sourceId) continue;
      const bucket = result.get(doc.sourceId);
      if (bucket) bucket.push(doc);
      else result.set(doc.sourceId, [doc]);
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Computation
  // ───────────────────────────────────────────────────────────────────────────

  computeStatus(source: LoadedSource, docs: ProcessingDocument[]): ReceivingSourceStatus {
    const type = source.info.type;
    const rtvApplicable = type === 'grn';

    const pick = (docType: ProcessingDocType) => pickSlotAndLegacy(docs.filter((d) => d.docType === docType));
    const aqr = pick('aqr');
    const inward = pick('inward');
    const dump = pick('dump');
    const rtv = rtvApplicable ? pick('rtv') : { slot: null, legacy: [], counting: [] as ProcessingDocument[] };

    const linesOf = (list: ProcessingDocument[]): DocLineInput[] => list.flatMap((d) => d.lines);
    const sourceAgg = aggregateSourceLines(source.lines);
    const aqrAgg = aqr.counting.length ? aggregateDocLines(linesOf(aqr.counting)) : null;
    const inwardAgg = aggregateDocLines(linesOf(inward.counting));
    const dumpAgg = aggregateDocLines(linesOf(dump.counting));
    const rtvAgg = aggregateDocLines(linesOf(rtv.counting));

    const products = buildProductRows(sourceAgg, aqrAgg, inwardAgg, dumpAgg, rtvAgg);
    const hasLegacyDumpLine = Array.from(dumpAgg.values()).some((line: AggregatedDocLine) => line.legacy);
    const hasCountingDocument = aqr.counting.length + inward.counting.length + dump.counting.length + rtv.counting.length > 0;

    const state = deriveState({
      isComplete: source.info.isComplete,
      hasCountingDocument,
      hasInward: inward.counting.length > 0,
      hasLegacyDumpLine,
      products,
    });

    const slots: ProcessingSlots = {
      aqr: this.toSlot(aqr.slot),
      inward: this.toSlot(inward.slot),
      dump: this.toSlot(dump.slot),
      rtv: rtvApplicable ? this.toSlot(rtv.slot) : null,
    };
    const legacyDocuments: LegacyDocuments = {
      aqr: aqr.legacy.map((d) => this.toSlot(d)!),
      inward: inward.legacy.map((d) => this.toSlot(d)!),
      dump: dump.legacy.map((d) => this.toSlot(d)!),
      rtv: rtv.legacy.map((d) => this.toSlot(d)!),
    };

    return { source: source.info, state, rtvApplicable, slots, legacyDocuments, products };
  }

  /** Statuses for many sources of one type in one go (used by the Arrivals list and export). */
  async computeStatuses(type: ReceivingSourceType, ids: string[], manager?: EntityManager): Promise<Map<string, ReceivingSourceStatus>> {
    const result = new Map<string, ReceivingSourceStatus>();
    if (!ids.length) return result;
    const em = manager ?? this.dataSource.manager;
    for (let start = 0; start < ids.length; start += STATUS_BATCH_SIZE) {
      const batch = ids.slice(start, start + STATUS_BATCH_SIZE);
      const sources = await this.loadSources(type, batch, em);
      const docs = await this.loadProcessingDocuments(type, batch, em);
      sources.forEach((source, id) => {
        result.set(id, this.computeStatus(source, docs.get(id) ?? []));
      });
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Source loaders
  // ───────────────────────────────────────────────────────────────────────────

  private sourceLabel(type: ReceivingSourceType): string {
    return type === 'grn' ? 'GRN' : type === 'stock-transfer-dc' ? 'Stock Transfer DC' : 'Return By Customer';
  }

  private async loadGrns(ids: string[], manager: EntityManager): Promise<LoadedSource[]> {
    const rows = await manager
      .getRepository(GRN)
      .createQueryBuilder('grn')
      .withDeleted()
      .leftJoinAndSelect('grn.companyName', 'company')
      .leftJoinAndSelect('grn.purchaseForSalesLocation', 'location')
      .leftJoinAndSelect('grn.selectedVendor', 'vendor')
      .leftJoinAndSelect('grn.selectedFarmer', 'farmer')
      .leftJoinAndSelect('grn.grnProducts', 'line')
      .leftJoinAndSelect('line.productName', 'product')
      .leftJoinAndSelect('line.variant', 'variant')
      .leftJoinAndSelect('line.uom', 'uom')
      .where('grn.id IN (:...ids)', { ids })
      .getMany();

    return rows.map((grn): LoadedSource => {
      const vendor = grn.selectedVendor ?? null;
      const farmer = grn.selectedFarmer ?? null;
      const partyType = grn.source === Source.FARMER || (!vendor && farmer) ? 'farmer' : vendor ? 'vendor' : farmer ? 'farmer' : null;
      const farmerName = farmer
        ? [farmer.farmerfName, farmer.farmermName, farmer.farmerlName].filter((p) => p && String(p).trim()).join(' ').trim() || null
        : null;
      return {
        isDeleted: Boolean(grn.isDeleted) || Boolean(grn.deletedAt),
        info: {
          type: 'grn',
          id: grn.id,
          no: grn.grnNo ?? null,
          documentId: null,
          approvalStatus: null,
          isComplete: false,
          deliveryMode: grn.deliveryMode ?? GrnDeliveryMode.CC_DC,
          companyId: grn.companyName?.id ?? null,
          companyName: grn.companyName?.name ?? null,
          locationId: grn.purchaseForSalesLocation?.id ?? null,
          locationName: grn.purchaseForSalesLocation?.name ?? null,
          fromLocationId: null,
          fromLocationName: null,
          partyType,
          partyId: partyType === 'farmer' ? farmer?.id ?? null : partyType === 'vendor' ? vendor?.id ?? null : null,
          partyName: partyType === 'farmer' ? farmerName : partyType === 'vendor' ? vendor?.companyName ?? null : null,
          date: grn.createdAt ?? null,
        },
        lines: (grn.grnProducts ?? []).map((line): SourceLineInput => ({
          productId: line.productName?.id ?? null,
          productName: line.productName?.name ?? null,
          variantId: line.variant?.id ?? null,
          variantName: line.variant?.variantName ?? null,
          uomId: line.uom?.id ?? null,
          uomName: line.uom?.unit ?? null,
          unitPrice: line.unitPrice ?? null,
          kg: line.netWeight,
        })),
      };
    });
  }

  private async loadStockTransferDcs(ids: string[], manager: EntityManager): Promise<LoadedSource[]> {
    const rows = await manager
      .getRepository(StockTransferDeliveryChallan)
      .createQueryBuilder('dc')
      .withDeleted()
      .leftJoinAndSelect('dc.companyName', 'company')
      .leftJoinAndSelect('dc.toLocation', 'toLocation')
      .leftJoinAndSelect('dc.fromLocation', 'fromLocation')
      .leftJoinAndSelect('dc.deliveryChallanProducts', 'line')
      .leftJoinAndSelect('line.productName', 'product')
      .leftJoinAndSelect('line.variant', 'variant')
      .leftJoinAndSelect('line.uom', 'uom')
      .leftJoinAndSelect('line.saleUoM', 'saleUom')
      .where('dc.id IN (:...ids)', { ids })
      .getMany();

    return rows.map((dc): LoadedSource => ({
      isDeleted: Boolean(dc.isDeleted) || Boolean(dc.deletedAt),
      info: {
        type: 'stock-transfer-dc',
        id: dc.id,
        no: dc.challanNo ?? null,
        documentId: null,
        approvalStatus: null,
        isComplete: false,
        deliveryMode: null,
        companyId: dc.companyName?.id ?? null,
        companyName: dc.companyName?.name ?? null,
        locationId: dc.toLocation?.id ?? null,
        locationName: dc.toLocation?.name ?? null,
        fromLocationId: dc.fromLocation?.id ?? null,
        fromLocationName: dc.fromLocation?.name ?? null,
        partyType: dc.fromLocation ? 'branch' : null,
        partyId: dc.fromLocation?.id ?? null,
        partyName: dc.fromLocation?.name ?? null,
        date: dc.createdAt ?? null,
      },
      lines: (dc.deliveryChallanProducts ?? []).map((line): SourceLineInput => ({
        productId: line.productName?.id ?? null,
        productName: line.productName?.name ?? null,
        variantId: line.variant?.id ?? null,
        variantName: line.variant?.variantName ?? null,
        uomId: line.saleUoM?.id ?? line.uom?.id ?? null,
        uomName: line.saleUoM?.unit ?? line.uom?.unit ?? null,
        unitPrice: line.unitPrice ?? null,
        kg: line.netWeight,
      })),
    }));
  }

  private async loadRbcs(ids: string[], manager: EntityManager): Promise<LoadedSource[]> {
    const rows = await manager
      .getRepository(PostReturnByCustomer)
      .createQueryBuilder('rbc')
      .withDeleted()
      .leftJoinAndSelect('rbc.companyName', 'company')
      .leftJoinAndSelect('rbc.location', 'location')
      .leftJoinAndSelect('rbc.customerName', 'customer')
      .leftJoinAndSelect('rbc.returnedProducts', 'line')
      .leftJoinAndSelect('line.productName', 'product')
      .leftJoinAndSelect('line.variant', 'variant')
      .leftJoinAndSelect('line.saleUoM', 'uom')
      .where('rbc.id IN (:...ids)', { ids })
      .getMany();

    return rows.map((rbc): LoadedSource => ({
      isDeleted: Boolean(rbc.isDeleted) || Boolean(rbc.deletedAt),
      info: {
        type: 'rbc',
        id: rbc.id,
        no: rbc.rbcNo ?? null,
        documentId: null,
        approvalStatus: null,
        isComplete: false,
        deliveryMode: null,
        companyId: rbc.companyName?.id ?? null,
        companyName: rbc.companyName?.name ?? null,
        locationId: rbc.location?.id ?? null,
        locationName: rbc.location?.name ?? null,
        fromLocationId: null,
        fromLocationName: null,
        partyType: rbc.customerName ? 'customer' : null,
        partyId: rbc.customerName?.id ?? null,
        partyName: rbc.customerName?.organisationName ?? null,
        // `date` carries a display transformer; fall back to createdAt.
        date: (rbc.date as unknown as string | Date | null) ?? rbc.createdAt ?? null,
      },
      // Only returned (accepted back) kg count as received; rejected kg do not.
      lines: (rbc.returnedProducts ?? []).map((line): SourceLineInput => ({
        productId: line.productName?.id ?? null,
        productName: line.productName?.name ?? null,
        variantId: line.variant?.id ?? null,
        variantName: line.variant?.variantName ?? null,
        uomId: line.saleUoM?.id ?? null,
        uomName: line.saleUoM?.unit ?? null,
        unitPrice: line.unitPrice ?? null,
        kg: line.returnedNetWt,
      })),
    }));
  }

  /** Newest `documents` row per business id for one document type. */
  private async loadLatestDocuments(type: DocumentTypeEnum, ids: string[], manager: EntityManager): Promise<Map<string, DocumentRow>> {
    const result = new Map<string, DocumentRow>();
    if (!ids.length) return result;
    const rows = await manager
      .getRepository(Documentb)
      .createQueryBuilder('d')
      .select(['d.id', 'd.status', 'd.document_type_id', 'd.createdAt'])
      .where('d.type = :type', { type })
      .andWhere('d.document_type_id IN (:...ids)', { ids })
      .orderBy('d.createdAt', 'DESC')
      .getMany();
    for (const row of rows) {
      if (!row.document_type_id || result.has(row.document_type_id)) continue;
      result.set(row.document_type_id, { id: row.id, status: row.status ?? null, createdAt: row.createdAt ?? null });
    }
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Processing document loaders
  // ───────────────────────────────────────────────────────────────────────────

  private async loadAqrs(sourceType: ReceivingSourceType, ids: string[], manager: EntityManager): Promise<ProcessingDocument[]> {
    const fkProp: Record<ReceivingSourceType, string> = { grn: 'grn', 'stock-transfer-dc': 'deliveryChallanNo', rbc: 'rbc' };
    const prop = fkProp[sourceType];
    const rows = await manager
      .getRepository(Aqr)
      .createQueryBuilder('aqr')
      .withDeleted()
      .leftJoin(`aqr.${prop}`, 'src')
      .addSelect(['src.id'])
      .leftJoinAndSelect('aqr.products', 'line')
      .leftJoinAndSelect('line.productName', 'lineProduct')
      .leftJoinAndSelect('line.variant', 'lineVariant')
      .leftJoinAndSelect('aqr.product', 'legacyProduct')
      .leftJoinAndSelect('aqr.variant', 'legacyVariant')
      .where('src.id IN (:...ids)', { ids })
      .getMany();

    return rows.map((aqr): ProcessingDocument => {
      const lines: DocLineInput[] = (aqr.products ?? []).length
        ? aqr.products.map((line) => ({
            productId: line.productName?.id ?? null,
            productName: line.productName?.name ?? null,
            variantId: line.variant?.id ?? null,
            variantName: line.variant?.variantName ?? null,
            kg: line.arrivedQty,
            sampleKg: line.samplingQty,
          }))
        : aqr.product
          ? [
              {
                // Legacy AQR: the single product lives on the header (varchar quantities).
                productId: aqr.product.id,
                productName: aqr.product.name ?? null,
                variantId: aqr.variant?.id ?? null,
                variantName: aqr.variant?.variantName ?? null,
                kg: aqr.arrivedQty,
                sampleKg: aqr.samplingQty,
              },
            ]
          : [];
      return {
        docType: 'aqr',
        id: aqr.id,
        docNo: aqr.aqrNo ?? null,
        documentId: null,
        status: null,
        createdAt: aqr.createdAt ?? null,
        isDeleted: Boolean(aqr.isDeleted),
        deletedAt: aqr.deletedAt ?? null,
        sourceId: ((aqr as unknown as Record<string, { id?: string } | null>)[prop]?.id) ?? '',
        lines,
      };
    });
  }

  private async loadInwards(sourceType: ReceivingSourceType, ids: string[], manager: EntityManager): Promise<ProcessingDocument[]> {
    const fkProp: Record<ReceivingSourceType, string> = { grn: 'grnNo', 'stock-transfer-dc': 'deliveryChallanNo', rbc: 'rbcNo' };
    const prop = fkProp[sourceType];
    const rows = await manager
      .getRepository(InwardRegister)
      .createQueryBuilder('ir')
      .withDeleted()
      .leftJoin(`ir.${prop}`, 'src')
      .addSelect(['src.id'])
      .leftJoinAndSelect('ir.inwardProducts', 'line')
      .leftJoinAndSelect('line.productName', 'product')
      .leftJoinAndSelect('line.variant', 'variant')
      .where('src.id IN (:...ids)', { ids })
      .getMany();

    return rows.map((ir): ProcessingDocument => ({
      docType: 'inward',
      id: ir.id,
      docNo: ir.inwardNo ?? null,
      documentId: null,
      status: null,
      createdAt: ir.createdAt ?? null,
      isDeleted: Boolean(ir.isDeleted),
      deletedAt: ir.deletedAt ?? null,
      sourceId: ((ir as unknown as Record<string, { id?: string } | null>)[prop]?.id) ?? '',
      lines: (ir.inwardProducts ?? []).map((line) => ({
        productId: line.productName?.id ?? null,
        productName: line.productName?.name ?? null,
        variantId: line.variant?.id ?? null,
        variantName: line.variant?.variantName ?? null,
        kg: line.netWeight,
      })),
    }));
  }

  private async loadDumps(sourceType: ReceivingSourceType, ids: string[], manager: EntityManager): Promise<ProcessingDocument[]> {
    const fkProp: Record<ReceivingSourceType, string> = { grn: 'grn', 'stock-transfer-dc': 'deliveryChallanNo', rbc: 'rbcNo' };
    const prop = fkProp[sourceType];
    const rows = await manager
      .getRepository(DumpRegister)
      .createQueryBuilder('dr')
      .withDeleted()
      .leftJoin(`dr.${prop}`, 'src')
      .addSelect(['src.id'])
      .leftJoinAndSelect('dr.dumpProducts', 'line')
      .leftJoinAndSelect('line.productName', 'product')
      .leftJoinAndSelect('line.variant', 'variant')
      .where('src.id IN (:...ids)', { ids })
      .getMany();

    return rows.map((dr): ProcessingDocument => ({
      docType: 'dump',
      id: dr.id,
      docNo: dr.dumpNo ?? null,
      documentId: null,
      status: null,
      createdAt: dr.createdAt ?? null,
      isDeleted: Boolean(dr.isDeleted),
      deletedAt: dr.deletedAt ?? null,
      sourceId: ((dr as unknown as Record<string, { id?: string } | null>)[prop]?.id) ?? '',
      lines: (dr.dumpProducts ?? []).map((line) => {
        // Pre-change dump rows carry only `quantity` (a count). They cannot be
        // matched in kg, so they contribute 0 kg and flag the source `legacy`.
        const hasNetWeight = line.netWeight !== null && line.netWeight !== undefined;
        return {
          productId: line.productName?.id ?? null,
          productName: line.productName?.name ?? null,
          variantId: line.variant?.id ?? null,
          variantName: line.variant?.variantName ?? null,
          kg: hasNetWeight ? line.netWeight : 0,
          legacy: !hasNetWeight,
        };
      }),
    }));
  }

  private async loadRtvs(sourceType: ReceivingSourceType, ids: string[], manager: EntityManager): Promise<ProcessingDocument[]> {
    if (sourceType !== 'grn') return [];
    const rows = await manager
      .getRepository(ReturnToVendor)
      .createQueryBuilder('rtv')
      .withDeleted()
      .leftJoin('rtv.grnNo', 'src')
      .addSelect(['src.id'])
      .leftJoinAndSelect('rtv.rtvProducts', 'line')
      .leftJoinAndSelect('line.productName', 'product')
      .leftJoinAndSelect('line.variant', 'variant')
      .where('src.id IN (:...ids)', { ids })
      .getMany();

    return rows.map((rtv): ProcessingDocument => ({
      docType: 'rtv',
      id: rtv.id,
      docNo: rtv.rtvNo ?? null,
      documentId: null,
      status: null,
      createdAt: rtv.createdAt ?? null,
      // RTV has a second delete-date column (`deleted_at_new`) set by its soft delete.
      isDeleted: Boolean(rtv.isDeleted) || Boolean(rtv.deletedAtNew),
      deletedAt: rtv.deletedAt ?? null,
      sourceId: rtv.grnNo?.id ?? '',
      lines: (rtv.rtvProducts ?? []).map((line) => ({
        productId: line.productName?.id ?? null,
        productName: line.productName?.name ?? null,
        variantId: line.variant?.id ?? null,
        variantName: line.variant?.variantName ?? null,
        kg: line.netWeight,
      })),
    }));
  }

  private toSlot(doc: ProcessingDocument | null): Slot | null {
    if (!doc) return null;
    return { id: doc.id, docNo: doc.docNo, documentId: doc.documentId, status: doc.status, createdAt: doc.createdAt };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Arrivals SQL
  // ───────────────────────────────────────────────────────────────────────────

  private requestedSourceTypes(filter: ArrivalsFilter): ReceivingSourceType[] {
    const raw = filter.sourceType;
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isReceivingSourceType);
    return list.length ? Array.from(new Set(list)) : ['grn', 'stock-transfer-dc', 'rbc'];
  }

  /**
   * One SELECT per source type, UNION ALL'ed into a CTE. Only constants from
   * `receiving.sql.ts` are interpolated; filters are bound parameters.
   */
  private buildArrivalsQuery(filter: ArrivalsFilter): { cteSql: string; whereSql: string; orderSql: string; params: unknown[] } {
    const withHasDoc = Boolean(filter.state);
    const branches = this.requestedSourceTypes(filter).map((type) => this.arrivalBranchSql(type, withHasDoc));
    const cteSql = branches.join('\nUNION ALL\n');

    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions: string[] = [];

    if (filter.locationId) conditions.push(`location_id = ${bind(String(filter.locationId))}`);
    if (filter.search && String(filter.search).trim()) {
      const term = `%${String(filter.search).trim()}%`;
      const p = bind(term);
      conditions.push(`(source_no ILIKE ${p} OR party_name ILIKE ${p})`);
    }
    if (filter.startDate) {
      if (!DATE_ONLY.test(filter.startDate)) throw new AppError(400, 'startDate must be yyyy-MM-dd');
      conditions.push(`source_date >= ${bind(filter.startDate)}::date`);
    }
    if (filter.endDate) {
      if (!DATE_ONLY.test(filter.endDate)) throw new AppError(400, 'endDate must be yyyy-MM-dd');
      conditions.push(`source_date < (${bind(filter.endDate)}::date + INTERVAL '1 day')`);
    }
    if (filter.state === 'not-received') {
      // The list only contains COMPLETE sources by definition.
      conditions.push('FALSE');
    } else if (filter.state === 'not-started') {
      conditions.push('has_doc = FALSE');
    } else if (filter.state) {
      conditions.push('has_doc = TRUE');
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    let column = 'source_date';
    let direction: 'ASC' | 'DESC' = 'DESC';
    if (filter.sort) {
      const [field, dir] = String(filter.sort).split(':');
      const mapped = ARRIVAL_SORT_COLUMNS[field];
      if (mapped) {
        column = mapped;
        direction = (dir ?? '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      }
    }
    const orderSql = `ORDER BY ${column} ${direction} NULLS LAST, source_id ASC`;

    return { cteSql, whereSql, orderSql, params };
  }

  private latestDocumentIdSql(sourceIdExpr: string, type: ReceivingSourceType): string {
    const docType = SOURCE_DOCUMENT_TYPE[type];
    return `(SELECT d.id::text FROM documents d WHERE d.document_type_id = (${sourceIdExpr})::text AND d.type::text = '${docType}' AND d."deletedAt" IS NULL ORDER BY d."createdAt" DESC LIMIT 1)`;
  }

  /**
   * Quoted database column of a relation's foreign key, read from TypeORM's
   * metadata at runtime. Raw SQL must never hard-code these: the three
   * delivery challan children share one table and all declare `fromLocation`
   * with different `@JoinColumn` names, so TypeORM keeps whichever one its
   * import order registers first (`branch_id` in the app, see
   * src/scripts/probeDeliveryChallanColumns.ts). The same applies to relations
   * without an explicit `@JoinColumn` (`item.deliveryChallanId`,
   * `returned_products_by_customer.postReturnId`).
   */
  private fkColumn(entity: EntityTarget<ObjectLiteral>, propertyPath: string): string {
    const relation = this.dataSource.getMetadata(entity).findRelationWithPropertyPath(propertyPath);
    const column = relation?.joinColumns[0]?.databaseName;
    if (!column) {
      throw new Error(`Receiving: relation ${String((entity as { name?: string }).name ?? entity)}.${propertyPath} has no join column`);
    }
    return `"${column.replace(/"/g, '""')}"`;
  }

  private arrivalColumns() {
    return {
      grnCompany: this.fkColumn(GRN, 'companyName'),
      grnReceivingLocation: this.fkColumn(GRN, 'purchaseForSalesLocation'),
      grnVendor: this.fkColumn(GRN, 'selectedVendor'),
      grnFarmer: this.fkColumn(GRN, 'selectedFarmer'),
      dcCompany: this.fkColumn(StockTransferDeliveryChallan, 'companyName'),
      dcToLocation: this.fkColumn(StockTransferDeliveryChallan, 'toLocation'),
      dcFromLocation: this.fkColumn(StockTransferDeliveryChallan, 'fromLocation'),
      itemChallan: this.fkColumn(Item, 'deliveryChallan'),
      rbcCompany: this.fkColumn(PostReturnByCustomer, 'companyName'),
      rbcLocation: this.fkColumn(PostReturnByCustomer, 'location'),
      rbcCustomer: this.fkColumn(PostReturnByCustomer, 'customerName'),
      returnedPostReturn: this.fkColumn(ReturnedProducts, 'postReturn'),
    };
  }

  private arrivalBranchSql(type: ReceivingSourceType, withHasDoc: boolean): string {
    const col = this.arrivalColumns();
    switch (type) {
      case 'grn': {
        const hasDoc = withHasDoc ? `, ${anyCountingDocumentSql('g.id', 'grn')} AS has_doc` : '';
        return (
          `SELECT 'grn'::text AS source_type, g.id::text AS source_id, g."grnNo" AS source_no, ` +
          `${this.latestDocumentIdSql('g.id', 'grn')} AS document_id, ` +
          `c.name AS company_name, g.${col.grnReceivingLocation}::text AS location_id, b.name AS location_name, ` +
          `COALESCE(v.company_name, NULLIF(TRIM(CONCAT_WS(' ', f."farmerfName", f."farmermName", f."farmerlName")), '')) AS party_name, ` +
          `g."createdAt" AS source_date, ` +
          `(SELECT COUNT(DISTINCT gp.product_id::text || ':' || COALESCE(gp.varient_id::text, 'null')) FROM grn_products gp WHERE gp.grn_id = g.id AND gp.product_id IS NOT NULL) AS product_count, ` +
          `(SELECT COALESCE(SUM(gp."netWeight"), 0) FROM grn_products gp WHERE gp.grn_id = g.id AND gp.product_id IS NOT NULL) AS received_kg` +
          hasDoc +
          ` FROM grns g ` +
          `LEFT JOIN company c ON c.id = g.${col.grnCompany} ` +
          `LEFT JOIN branches b ON b.id = g.${col.grnReceivingLocation} ` +
          `LEFT JOIN vendor v ON v.id = g.${col.grnVendor} ` +
          `LEFT JOIN farmer f ON f.id = g.${col.grnFarmer} ` +
          `WHERE g."isDeleted" = false AND g."deletedAt" IS NULL AND g."deliveryMode"::text = '${GrnDeliveryMode.CC_DC}' ` +
          `AND ${completeDocumentExistsSql('g.id', 'grn')}`
        );
      }
      case 'stock-transfer-dc': {
        const hasDoc = withHasDoc ? `, ${anyCountingDocumentSql('dc.id', 'stock-transfer-dc')} AS has_doc` : '';
        return (
          `SELECT 'stock-transfer-dc'::text AS source_type, dc.id::text AS source_id, dc."challanNo" AS source_no, ` +
          `${this.latestDocumentIdSql('dc.id', 'stock-transfer-dc')} AS document_id, ` +
          `c.name AS company_name, dc.${col.dcToLocation}::text AS location_id, tl.name AS location_name, ` +
          `fl.name AS party_name, ` +
          `dc."createdAt" AS source_date, ` +
          `(SELECT COUNT(DISTINCT i.product_id::text || ':' || COALESCE(i.varient_id::text, 'null')) FROM item i WHERE i.${col.itemChallan} = dc.id AND i.product_id IS NOT NULL) AS product_count, ` +
          `(SELECT COALESCE(SUM(i."netWeight"), 0) FROM item i WHERE i.${col.itemChallan} = dc.id AND i.product_id IS NOT NULL) AS received_kg` +
          hasDoc +
          ` FROM delivery_challan_purchase dc ` +
          `LEFT JOIN company c ON c.id = dc.${col.dcCompany} ` +
          `LEFT JOIN branches tl ON tl.id = dc.${col.dcToLocation} ` +
          `LEFT JOIN branches fl ON fl.id = dc.${col.dcFromLocation} ` +
          `WHERE dc.type = 'stock-transfer-delivery-challan' AND dc."isDeleted" = false AND dc."deletedAt" IS NULL ` +
          `AND ${completeDocumentExistsSql('dc.id', 'stock-transfer-dc')}`
        );
      }
      case 'rbc': {
        const hasDoc = withHasDoc ? `, ${anyCountingDocumentSql('r.id', 'rbc')} AS has_doc` : '';
        return (
          `SELECT 'rbc'::text AS source_type, r.id::text AS source_id, r."rbcNo" AS source_no, ` +
          `${this.latestDocumentIdSql('r.id', 'rbc')} AS document_id, ` +
          `c.name AS company_name, r.${col.rbcLocation}::text AS location_id, b.name AS location_name, ` +
          `cu.organisation_name AS party_name, ` +
          `COALESCE(r.date::timestamp, r."createdAt") AS source_date, ` +
          `(SELECT COUNT(DISTINCT rp.product_id::text || ':' || COALESCE(rp.varient_id::text, 'null')) FROM returned_products_by_customer rp WHERE rp.${col.returnedPostReturn} = r.id AND rp.product_id IS NOT NULL) AS product_count, ` +
          `(SELECT COALESCE(SUM(rp."returnedNetWt"), 0) FROM returned_products_by_customer rp WHERE rp.${col.returnedPostReturn} = r.id AND rp.product_id IS NOT NULL) AS received_kg` +
          hasDoc +
          ` FROM return_by_customer r ` +
          `LEFT JOIN company c ON c.id = r.${col.rbcCompany} ` +
          `LEFT JOIN branches b ON b.id = r.${col.rbcLocation} ` +
          `LEFT JOIN customers cu ON cu.id = r.${col.rbcCustomer} ` +
          `WHERE r."isDeleted" = false AND r."deletedAt" IS NULL ` +
          `AND ${completeDocumentExistsSql('r.id', 'rbc')}`
        );
      }
      default:
        throw new AppError(400, 'Source type must be one of grn, stock-transfer-dc, rbc');
    }
  }

  private async toArrivalRows(rows: ArrivalSqlRow[]): Promise<ArrivalRow[]> {
    const idsByType = new Map<ReceivingSourceType, string[]>();
    for (const row of rows) {
      const list = idsByType.get(row.source_type);
      if (list) list.push(row.source_id);
      else idsByType.set(row.source_type, [row.source_id]);
    }

    const statuses = new Map<string, ReceivingSourceStatus>();
    for (const [type, ids] of idsByType) {
      const computed = await this.computeStatuses(type, ids);
      computed.forEach((status, id) => statuses.set(`${type}:${id}`, status));
    }

    return rows.map((row): ArrivalRow => {
      const status = statuses.get(`${row.source_type}:${row.source_id}`) ?? null;
      const differenceKg = status ? round3(status.products.reduce((sum, p) => sum + p.differenceKg, 0)) : 0;
      return {
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceNo: row.source_no,
        documentId: row.document_id,
        companyName: row.company_name,
        locationId: row.location_id,
        locationName: row.location_name,
        partyName: row.party_name,
        date: row.source_date,
        productCount: Number(row.product_count ?? 0),
        receivedKg: round3(Number(row.received_kg ?? 0)),
        differenceKg,
        state: status ? status.state : 'not-started',
        slots: {
          aqr: slotState(status?.slots.aqr ?? null),
          inward: slotState(status?.slots.inward ?? null),
          dump: slotState(status?.slots.dump ?? null),
          rtv: row.source_type === 'grn' ? slotState(status?.slots.rtv ?? null) : null,
        },
      };
    });
  }
}
