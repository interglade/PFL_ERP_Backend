/**
 * Receiving links — live status of a source (GRN / Stock Transfer DC / RBC)
 * and the Arrivals worklist (docs/receiving-links-plan.md §2.2).
 *
 * Nothing here is cached: a slot can change at any moment (a document gets
 * rejected, a new Inward is created) and the guard relies on these loaders
 * inside the caller's transaction.
 */

import { isGrnReceivableStatus } from '../../grn/grnApproval';
import { inject, injectable } from 'inversify';
import { DataSource, EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
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
  ReceivingState,
  SkipFlags,
  SkippableDocType,
  Slot,
  SourceLineInput,
} from '../receiving.types';
import { chunk, NO_SKIPS, planStateFilter, slotWithSkip, StateFilterPlan, stateConditionSql } from '../receiving.arrivals';
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
import { attachDispatch, dispatchReadySql, dispatchStateSql, loadDispatches } from '../receiving.dispatch';
import {
  completeDocumentExistsSql,
  isReceivingSourceType,
  PROCESSING_DOCUMENT_TYPE,
  processingTypesFor,
  SOURCE_DOCUMENT_TYPE,
  sqlStateExpr,
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

/** Detail columns of one source (phase 2 of the Arrivals list). */
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
  dispatch_state: string | null;
  dispatch_ready: boolean | null;
}

/** A source matched by phase 1 of the Arrivals list (cheap columns only). */
export interface ArrivalKey {
  source_type: ReceivingSourceType;
  source_id: string;
  /** Exact state when SQL can tell it, NULL when a counting Inward exists (see `sqlStateExpr`). */
  sql_state: ReceivingState | null;
}

/** Which expensive columns a branch of the Arrivals CTE selects. */
interface BranchOptions {
  /** document_id, product_count, received_kg, dispatch_state, dispatch_ready (phase 2). */
  detail?: boolean;
  /** product_count / received_kg (sorting on them in phase 1). */
  kg?: boolean;
  dispatchState?: boolean;
  dispatchReady?: boolean;
  /** sql_state (state filter). */
  state?: boolean;
  /** Bound `uuid[]` parameter restricting the branch to these ids (phase 2). */
  idsParam?: string;
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

/** Hard cap for the Excel export. */
export const ARRIVALS_EXPORT_MAX_ROWS = 5000;
/** Sources per status computation round (loaders run in parallel inside a round). */
const STATUS_BATCH_SIZE = 100;
/** Sources per round when only the state is needed (state filter classification). */
const STATE_BATCH_SIZE = 250;
/** Rows per round of the streamed Excel export. */
export const ARRIVALS_EXPORT_BATCH_SIZE = 200;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ArrivalsExportPlan {
  /** Ordered keys to export (at most {@link ARRIVALS_EXPORT_MAX_ROWS}). */
  keys: ArrivalKey[];
  /** Rows matching the filter. */
  total: number;
  /** `total` exceeds the cap; only the first {@link ARRIVALS_EXPORT_MAX_ROWS} are exported. */
  truncated: boolean;
}

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
    const [sources, docs, dispatches, skips] = await Promise.all([
      this.loadSources(type, [id], em),
      this.loadProcessingDocuments(type, [id], em),
      loadDispatches(em, type, [id]),
      this.loadSkips(type, [id], em),
    ]);
    const source = sources.get(id) ?? null;
    if (!source || source.isDeleted) {
      throw new AppError(404, `${this.sourceLabel(type)} not found`);
    }
    if (type === 'grn' && source.info.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER) {
      throw new AppError(400, 'This GRN is delivered directly to the customer');
    }
    const status = attachDispatch(this.computeStatus(source, docs.get(id) ?? []), dispatches.get(id));
    status.skipped = skips.get(id) ?? { ...NO_SKIPS };
    return status;
  }

  /**
   * COMPLETE sources only (GRN only with `deliveryMode = cc-dc`), newest first
   * by default, in two phases: phase 1 filters, sorts, counts and pages on
   * cheap columns in SQL; phase 2 computes the status (slots, kg, dispatch)
   * of the page only.
   *
   * State filter (one or more states): `not-started`, and `open` / `legacy`
   * of a source without a counting Inward, are exact in SQL. A source with a
   * counting Inward can be done / open / legacy depending on the per-product
   * kg matching, so when the filter needs to tell those apart (e.g. `done`, or
   * `not-started,open,legacy` = "not done"), the matching sources with an
   * Inward are classified by the status service (state only, in rounds,
   * loaders in parallel) *before* paging. Page sizes and `total` are exact.
   */
  async listArrivals(filter: ArrivalsFilter): Promise<ArrivalsResult> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filter.limit) || 20));
    const { keys, total } = await this.matchArrivalKeys(filter, { limit, offset: (page - 1) * limit });
    const data = await this.arrivalRowsFor(keys);
    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  /** Number of sources matching the Arrivals filter (sidebar badge: `readiness=ready&state=not-started`). */
  async countArrivals(filter: ArrivalsFilter): Promise<number> {
    const plan = planStateFilter(filter.state);
    if (plan.none) return 0;
    if (!plan.needsCompute) return this.countArrivalKeys(filter, plan);
    return (await this.resolveArrivalKeys(filter, plan)).length;
  }

  /**
   * Keys to export for the Arrivals filter, capped at {@link ARRIVALS_EXPORT_MAX_ROWS}.
   * The rows themselves are built in batches with {@link arrivalRowsFor} while
   * the workbook streams.
   */
  async planArrivalsExport(filter: ArrivalsFilter): Promise<ArrivalsExportPlan> {
    const { keys, total } = await this.matchArrivalKeys(filter, { limit: ARRIVALS_EXPORT_MAX_ROWS, offset: 0 });
    return { keys, total, truncated: total > keys.length };
  }

  /** Arrivals rows (phase 2) for keys from phase 1, in the same order. */
  async arrivalRowsFor(keys: ArrivalKey[]): Promise<ArrivalRow[]> {
    if (!keys.length) return [];
    const idsByType = new Map<ReceivingSourceType, string[]>();
    for (const key of keys) {
      const list = idsByType.get(key.source_type);
      if (list) list.push(key.source_id);
      else idsByType.set(key.source_type, [key.source_id]);
    }

    const details = new Map<string, ArrivalSqlRow>();
    const statuses = new Map<string, ReceivingSourceStatus>();
    await Promise.all(
      Array.from(idsByType.entries()).map(async ([type, ids]) => {
        const [rows, computed] = await Promise.all([this.loadArrivalDetails(type, ids), this.computeStatuses(type, ids)]);
        rows.forEach((row) => details.set(`${type}:${row.source_id}`, row));
        computed.forEach((status, id) => statuses.set(`${type}:${id}`, status));
      }),
    );

    return keys
      .map((key) => {
        const ref = `${key.source_type}:${key.source_id}`;
        const row = details.get(ref);
        return row ? this.toArrivalRow(row, statuses.get(ref) ?? null) : null;
      })
      .filter((row): row is ArrivalRow => row !== null);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // "Not needed" marks (Dump / RTV skipped)
  // ───────────────────────────────────────────────────────────────────────────

  /** Skip flags per source id. */
  async loadSkips(type: ReceivingSourceType, ids: string[], manager?: EntityManager): Promise<Map<string, SkipFlags>> {
    const result = new Map<string, SkipFlags>();
    if (!ids.length) return result;
    const em = manager ?? this.dataSource.manager;
    const rows: Array<{ source_id: string; doc_type: string }> = await em.query(
      `SELECT source_id::text AS source_id, doc_type FROM receiving_skip WHERE source_type = $1 AND source_id = ANY($2::uuid[])`,
      [type, ids],
    );
    for (const row of rows) {
      const flags = result.get(row.source_id) ?? { ...NO_SKIPS };
      if (row.doc_type === 'dump') flags.dump = true;
      if (row.doc_type === 'rtv') flags.rtv = true;
      result.set(row.source_id, flags);
    }
    return result;
  }

  /**
   * Marks (or un-marks) the Dump / RTV step of a source as not needed. RTV only
   * applies to GRNs; a step that already has a counting document cannot be
   * skipped. Returns the source's skip flags after the change.
   */
  async setSkip(
    input: { sourceType: ReceivingSourceType; sourceId: string; docType: SkippableDocType },
    skip: boolean,
    userId: string | null,
  ): Promise<SkipFlags> {
    const { sourceType, sourceId, docType } = input;
    if (docType === 'rtv' && sourceType !== 'grn') {
      throw new AppError(400, 'Return To Vendor applies to GRNs only');
    }
    const em = this.dataSource.manager;
    const source = await this.loadSource(sourceType, sourceId, em);
    if (!source || source.isDeleted) throw new AppError(404, `${this.sourceLabel(sourceType)} not found`);

    if (skip) {
      const docs = (await this.loadProcessingDocuments(sourceType, [sourceId], em)).get(sourceId) ?? [];
      const existing = docs.find((d) => d.docType === docType && isCountingDocument(d));
      if (existing) {
        const label = docType === 'dump' ? 'A Dump Register' : 'A Return To Vendor';
        throw new AppError(409, `${label} already exists for ${source.info.no ?? 'this source'} (${existing.docNo ?? existing.id})`);
      }
      await em.query(
        `INSERT INTO receiving_skip (source_type, source_id, doc_type, skipped_by) VALUES ($1, $2::uuid, $3, $4)
         ON CONFLICT (source_type, source_id, doc_type) DO NOTHING`,
        [sourceType, sourceId, docType, userId],
      );
    } else {
      await em.query(`DELETE FROM receiving_skip WHERE source_type = $1 AND source_id = $2::uuid AND doc_type = $3`, [
        sourceType,
        sourceId,
        docType,
      ]);
    }
    return (await this.loadSkips(sourceType, [sourceId], em)).get(sourceId) ?? { ...NO_SKIPS };
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

    const loadRows = (): Promise<LoadedSource[]> => {
      switch (type) {
        case 'grn':
          return this.loadGrns(ids, manager);
        case 'stock-transfer-dc':
          return this.loadStockTransferDcs(ids, manager);
        case 'rbc':
          return this.loadRbcs(ids, manager);
        default:
          throw new AppError(400, 'Source type must be one of grn, stock-transfer-dc, rbc');
      }
    };

    // The source rows and their approval documents are independent: load both at once.
    const [loaded, documents] = await Promise.all([loadRows(), this.loadLatestDocuments(SOURCE_DOCUMENT_TYPE[type], ids, manager)]);
    for (const source of loaded) {
      const doc = documents.get(source.info.id);
      source.info.documentId = doc?.id ?? null;
      source.info.approvalStatus = doc?.status ?? null;
      // D-4: a GRN is receivable once fully approved (finance finalisation may be pending).
      source.info.isComplete = type === 'grn' ? isGrnReceivableStatus(doc?.status) : doc?.status === DocumentStatus.COMPLETE;
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

    const loaders: Record<ProcessingDocType, () => Promise<ProcessingDocument[]>> = {
      aqr: () => this.loadAqrs(type, ids, em),
      inward: () => this.loadInwards(type, ids, em),
      dump: () => this.loadDumps(type, ids, em),
      rtv: () => this.loadRtvs(type, ids, em),
    };

    // Each document type: its rows, then the approval status of those rows. The
    // types are independent of each other and load in parallel.
    const perType = await Promise.all(
      processingTypesFor(type).map(async (docType) => {
        const ofType = await loaders[docType]();
        if (!ofType.length) return ofType;
        const statuses = await this.loadLatestDocuments(PROCESSING_DOCUMENT_TYPE[docType], ofType.map((d) => d.id), em);
        for (const doc of ofType) {
          const row = statuses.get(doc.id);
          doc.documentId = row?.id ?? null;
          doc.status = row?.status ?? null;
        }
        return ofType;
      }),
    );
    const docs = perType.flat();

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
    const aqrAgg = aqr.counting.length ? aggregateDocLines(linesOf(aqr.counting), sourceAgg) : null;
    const inwardAgg = aggregateDocLines(linesOf(inward.counting), sourceAgg);
    const dumpAgg = aggregateDocLines(linesOf(dump.counting), sourceAgg);
    const rtvAgg = aggregateDocLines(linesOf(rtv.counting), sourceAgg);

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

    return {
      source: source.info, state, rtvApplicable, slots, legacyDocuments, products,
      // Filled in by `attachDispatch`.
      dispatch: null, dispatchState: 'none', dispatchRequired: false, canReceive: source.info.isComplete, blockers: [],
      // Filled in by the callers that load the skip marks.
      skipped: { ...NO_SKIPS },
    };
  }

  /** Statuses for many sources of one type in one go (used by the Arrivals list and export). */
  async computeStatuses(type: ReceivingSourceType, ids: string[], manager?: EntityManager): Promise<Map<string, ReceivingSourceStatus>> {
    const result = new Map<string, ReceivingSourceStatus>();
    if (!ids.length) return result;
    const em = manager ?? this.dataSource.manager;
    for (const batch of chunk(ids, STATUS_BATCH_SIZE)) {
      const [sources, docs, dispatches, skips] = await Promise.all([
        this.loadSources(type, batch, em),
        this.loadProcessingDocuments(type, batch, em),
        loadDispatches(em, type, batch),
        this.loadSkips(type, batch, em),
      ]);
      sources.forEach((source, id) => {
        const status = attachDispatch(this.computeStatus(source, docs.get(id) ?? []), dispatches.get(id));
        status.skipped = skips.get(id) ?? { ...NO_SKIPS };
        result.set(id, status);
      });
    }
    return result;
  }

  /**
   * Receiving state only (no dispatch, no skip marks) for many sources of one
   * type — the state filter of the Arrivals list. Same computation as the
   * status, so the filter always agrees with the state shown on the row.
   */
  async computeStates(type: ReceivingSourceType, ids: string[], manager?: EntityManager): Promise<Map<string, ReceivingState>> {
    const result = new Map<string, ReceivingState>();
    const em = manager ?? this.dataSource.manager;
    for (const batch of chunk(ids, STATE_BATCH_SIZE)) {
      const [sources, docs] = await Promise.all([this.loadSources(type, batch, em), this.loadProcessingDocuments(type, batch, em)]);
      sources.forEach((source, id) => result.set(id, this.computeStatus(source, docs.get(id) ?? []).state));
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
          batchNo: grn.batchNo ?? null,
        },
        lines: (grn.grnProducts ?? []).map((line): SourceLineInput => ({
          productId: line.productName?.id ?? null,
          productName: line.productName?.name ?? null,
          variantId: line.variant?.id ?? null,
          variantName: line.variant?.variantName ?? null,
          uomId: line.uom?.id ?? null,
          uomName: line.uom?.unit ?? null,
          unitPrice: line.unitPrice ?? null,
          qty: line.quantity,
          grossKg: line.grossWeight,
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

    // Batches each line took (C5): the destination receives per batch, at the batch cost.
    const allocations: Array<{ line_id: string | null; batch_no: string; qty: string; net_kg: string; unit_cost: string | null }> = ids.length
      ? await manager.query(
          `SELECT line_id::text AS line_id, batch_no, qty, net_kg, unit_cost FROM stock_allocation
            WHERE doc_type = $1 AND doc_id = ANY($2::uuid[]) AND status IN ('CONSUMED', 'RESERVED')
            ORDER BY created_at, id`,
          [DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER, ids],
        )
      : [];

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
        batchNo: null,
      },
      lines: (dc.deliveryChallanProducts ?? []).flatMap((line): SourceLineInput[] => {
        const base = {
          productId: line.productName?.id ?? null,
          productName: line.productName?.name ?? null,
          variantId: line.variant?.id ?? null,
          variantName: line.variant?.variantName ?? null,
          uomId: line.saleUoM?.id ?? line.uom?.id ?? null,
          uomName: line.saleUoM?.unit ?? line.uom?.unit ?? null,
        };
        const taken = allocations.filter((a) => a.line_id === line.id);
        if (!taken.length) {
          // DC without batch allocations: one line, no batch.
          return [{ ...base, unitPrice: line.unitPrice ?? null, qty: line.quantity, grossKg: line.grossWeight, kg: line.netWeight }];
        }
        const lineQty = Number(line.quantity) || 0;
        // One source line per batch: quantity and kg of the allocation, gross in
        // proportion, price = the batch cost (the value that left the from-location).
        return taken.map((a) => ({
          ...base,
          batchNo: a.batch_no,
          unitPrice: a.unit_cost ?? line.unitPrice ?? null,
          qty: a.qty,
          grossKg: lineQty > 0 ? (Number(line.grossWeight) || 0) * (Number(a.qty) / lineQty) : null,
          kg: a.net_kg,
        }));
      }),
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
        // Returned goods become their own batch, numbered after the RBC (C6).
        batchNo: rbc.rbcNo ?? null,
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
        qty: line.returnedQty,
        grossKg: line.returnedGrossWt,
        kg: line.returnedNetWt,
      })),
    }));
  }

  /** Newest `documents` row per business id for one document type. */
  private async loadLatestDocuments(type: DocumentTypeEnum, ids: string[], manager: EntityManager): Promise<Map<string, DocumentRow>> {
    const result = new Map<string, DocumentRow>();
    if (!ids.length) return result;
    // One row per business id (DISTINCT ON), newest first; soft-deleted rows excluded
    // as the repository query did. Uses the (document_type_id, type) index.
    const rows: Array<{ id: string; status: string | null; document_type_id: string | null; created_at: Date | null }> = await manager.query(
      `SELECT DISTINCT ON (d.document_type_id) d.id::text AS id, d.status::text AS status, d.document_type_id, d."createdAt" AS created_at
         FROM documents d
        WHERE d.document_type_id = ANY($1::varchar[]) AND d.type::text = $2 AND d."deletedAt" IS NULL
        ORDER BY d.document_type_id, d."createdAt" DESC`,
      [ids, type],
    );
    for (const row of rows) {
      if (!row.document_type_id) continue;
      result.set(row.document_type_id, { id: row.id, status: row.status ?? null, createdAt: row.created_at ?? null });
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
      .leftJoinAndSelect('line.uom', 'lineUom')
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
            uomId: line.uom?.id ?? null,
            batchNo: line.batchNo ?? null,
            qty: line.arrivedUnits,
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
      .leftJoinAndSelect('line.uom', 'uom')
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
        uomId: line.uom?.id ?? null,
        batchNo: (line as { batchNo?: string | null }).batchNo ?? null,
        qty: line.quantity,
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
      .leftJoinAndSelect('line.uom', 'uom')
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
          uomId: line.uom?.id ?? null,
          batchNo: line.batchNo ?? null,
          qty: line.quantity,
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
      .leftJoinAndSelect('line.uom', 'uom')
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
        uomId: line.uom?.id ?? null,
        batchNo: (line as { batchNo?: string | null }).batchNo ?? null,
        qty: line.quantity,
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
   * Phase 1 SQL: one SELECT per source type, UNION ALL'ed into a CTE, with only
   * the columns the filter and the sort need (the correlated subqueries for kg,
   * dispatch and state are left out unless used). Only constants from
   * `receiving.sql.ts` are interpolated; filters are bound parameters.
   */
  private buildArrivalKeysQuery(
    filter: ArrivalsFilter,
    plan: StateFilterPlan,
  ): { cteSql: string; whereSql: string; orderSql: string; params: unknown[] } {
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

    const options: BranchOptions = {
      kg: column === 'received_kg' || column === 'product_count',
      dispatchState: Boolean(filter.dispatchState),
      dispatchReady: Boolean(filter.readiness),
      state: !plan.any,
    };
    const cteSql = this.requestedSourceTypes(filter)
      .map((type) => this.arrivalBranchSql(type, options))
      .join('\nUNION ALL\n');

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
    if (filter.dispatchState) {
      conditions.push(`COALESCE(dispatch_state, 'none') = ${bind(filter.dispatchState)}`);
    }
    if (filter.readiness === 'ready') conditions.push('dispatch_ready = TRUE');
    if (filter.readiness === 'blocked') conditions.push('dispatch_ready = FALSE');
    if (!plan.any) {
      const condition = plan.none ? 'FALSE' : stateConditionSql(plan, bind(plan.states));
      if (condition) conditions.push(condition);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return { cteSql, whereSql, orderSql, params };
  }

  private async countArrivalKeys(filter: ArrivalsFilter, plan: StateFilterPlan): Promise<number> {
    const { cteSql, whereSql, params } = this.buildArrivalKeysQuery(filter, plan);
    const rows: { total: string }[] = await this.dataSource.query(
      `WITH src AS (${cteSql}) SELECT COUNT(*)::text AS total FROM src ${whereSql}`,
      params,
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Ordered phase-1 keys; all of them without a window. */
  private async selectArrivalKeys(
    filter: ArrivalsFilter,
    plan: StateFilterPlan,
    window?: { limit: number; offset: number },
  ): Promise<ArrivalKey[]> {
    const { cteSql, whereSql, orderSql, params } = this.buildArrivalKeysQuery(filter, plan);
    const all = [...params];
    let paging = '';
    if (window) {
      all.push(window.limit, window.offset);
      paging = ` LIMIT $${all.length - 1} OFFSET $${all.length}`;
    }
    return this.dataSource.query(
      `WITH src AS (${cteSql}) SELECT source_type, source_id, ${plan.any ? 'NULL::text' : 'sql_state'} AS sql_state FROM src ${whereSql} ${orderSql}${paging}`,
      all,
    );
  }

  /**
   * Every key matching a state filter that SQL cannot answer alone: the keys
   * SQL keeps (exact ones and the unresolved ones holding an Inward), with the
   * unresolved ones classified by {@link computeStates}. Order is preserved.
   */
  private async resolveArrivalKeys(filter: ArrivalsFilter, plan: StateFilterPlan): Promise<ArrivalKey[]> {
    const all = await this.selectArrivalKeys(filter, plan);
    const unresolved = new Map<ReceivingSourceType, string[]>();
    for (const key of all) {
      if (key.sql_state !== null) continue;
      const list = unresolved.get(key.source_type);
      if (list) list.push(key.source_id);
      else unresolved.set(key.source_type, [key.source_id]);
    }
    const computed = new Map<string, ReceivingState>();
    // One source type at a time keeps the connection pool free for other requests.
    for (const [type, ids] of unresolved) {
      (await this.computeStates(type, ids)).forEach((state, id) => computed.set(`${type}:${id}`, state));
    }
    const wanted = new Set(plan.states);
    return all
      .map((key) => (key.sql_state !== null ? key : { ...key, sql_state: computed.get(`${key.source_type}:${key.source_id}`) ?? null }))
      .filter((key) => key.sql_state !== null && wanted.has(key.sql_state));
  }

  /** Phase 1: the keys of one window and the exact total. */
  private async matchArrivalKeys(
    filter: ArrivalsFilter,
    window: { limit: number; offset: number },
  ): Promise<{ keys: ArrivalKey[]; total: number }> {
    const plan = planStateFilter(filter.state);
    if (plan.none) return { keys: [], total: 0 };
    if (!plan.needsCompute) {
      const [total, keys] = await Promise.all([this.countArrivalKeys(filter, plan), this.selectArrivalKeys(filter, plan, window)]);
      return { keys, total };
    }
    const all = await this.resolveArrivalKeys(filter, plan);
    return { keys: all.slice(window.offset, window.offset + window.limit), total: all.length };
  }

  /** Phase 2: detail columns of the given sources of one type. */
  private async loadArrivalDetails(type: ReceivingSourceType, ids: string[]): Promise<ArrivalSqlRow[]> {
    if (!ids.length) return [];
    return this.dataSource.query(this.arrivalBranchSql(type, { detail: true, idsParam: '$1' }), [ids]);
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

  /**
   * Expensive columns of a branch, always in the same order so the branches
   * of the UNION ALL line up. `id` is the source id expression.
   */
  private arrivalExtraColumns(
    o: BranchOptions,
    cols: { documentId: string; productCount: string; receivedKg: string; dispatchState: string; dispatchReady: string; state: string },
  ): string {
    const extra: string[] = [];
    if (o.detail) extra.push(`${cols.documentId} AS document_id`);
    if (o.detail || o.kg) extra.push(`${cols.productCount} AS product_count`, `${cols.receivedKg} AS received_kg`);
    if (o.detail || o.dispatchState) extra.push(`${cols.dispatchState} AS dispatch_state`);
    if (o.detail || o.dispatchReady) extra.push(`${cols.dispatchReady} AS dispatch_ready`);
    if (o.state) extra.push(`${cols.state} AS sql_state`);
    return extra.length ? `, ${extra.join(', ')}` : '';
  }

  private arrivalBranchSql(type: ReceivingSourceType, o: BranchOptions): string {
    const col = this.arrivalColumns();
    switch (type) {
      case 'grn': {
        const extra = this.arrivalExtraColumns(o, {
          documentId: this.latestDocumentIdSql('g.id', 'grn'),
          productCount: `(SELECT COUNT(DISTINCT gp.product_id::text || ':' || COALESCE(gp.varient_id::text, 'null')) FROM grn_products gp WHERE gp.grn_id = g.id AND gp.product_id IS NOT NULL)`,
          receivedKg: `(SELECT COALESCE(SUM(gp."netWeight"), 0) FROM grn_products gp WHERE gp.grn_id = g.id AND gp.product_id IS NOT NULL)`,
          dispatchState: dispatchStateSql('g.id', 'grn'),
          dispatchReady: dispatchReadySql('g.id', 'g."createdAt"', 'grn'),
          state: sqlStateExpr('g.id', 'grn'),
        });
        return (
          `SELECT 'grn'::text AS source_type, g.id::text AS source_id, g."grnNo" AS source_no, ` +
          `c.name AS company_name, g.${col.grnReceivingLocation}::text AS location_id, b.name AS location_name, ` +
          `COALESCE(v.company_name, NULLIF(TRIM(CONCAT_WS(' ', f."farmerfName", f."farmermName", f."farmerlName")), '')) AS party_name, ` +
          `g."createdAt" AS source_date` +
          extra +
          ` FROM grns g ` +
          `LEFT JOIN company c ON c.id = g.${col.grnCompany} ` +
          `LEFT JOIN branches b ON b.id = g.${col.grnReceivingLocation} ` +
          `LEFT JOIN vendor v ON v.id = g.${col.grnVendor} ` +
          `LEFT JOIN farmer f ON f.id = g.${col.grnFarmer} ` +
          `WHERE g."isDeleted" = false AND g."deletedAt" IS NULL AND g."deliveryMode"::text = '${GrnDeliveryMode.CC_DC}' ` +
          (o.idsParam ? `AND g.id = ANY(${o.idsParam}::uuid[]) ` : '') +
          `AND ${completeDocumentExistsSql('g.id', 'grn')}`
        );
      }
      case 'stock-transfer-dc': {
        const extra = this.arrivalExtraColumns(o, {
          documentId: this.latestDocumentIdSql('dc.id', 'stock-transfer-dc'),
          productCount: `(SELECT COUNT(DISTINCT i.product_id::text || ':' || COALESCE(i.varient_id::text, 'null')) FROM item i WHERE i.${col.itemChallan} = dc.id AND i.product_id IS NOT NULL)`,
          receivedKg: `(SELECT COALESCE(SUM(i."netWeight"), 0) FROM item i WHERE i.${col.itemChallan} = dc.id AND i.product_id IS NOT NULL)`,
          dispatchState: dispatchStateSql('dc.id', 'stock-transfer-dc'),
          dispatchReady: dispatchReadySql('dc.id', 'dc."createdAt"', 'stock-transfer-dc'),
          state: sqlStateExpr('dc.id', 'stock-transfer-dc'),
        });
        return (
          `SELECT 'stock-transfer-dc'::text AS source_type, dc.id::text AS source_id, dc."challanNo" AS source_no, ` +
          `c.name AS company_name, dc.${col.dcToLocation}::text AS location_id, tl.name AS location_name, ` +
          `fl.name AS party_name, ` +
          `dc."createdAt" AS source_date` +
          extra +
          ` FROM delivery_challan_purchase dc ` +
          `LEFT JOIN company c ON c.id = dc.${col.dcCompany} ` +
          `LEFT JOIN branches tl ON tl.id = dc.${col.dcToLocation} ` +
          `LEFT JOIN branches fl ON fl.id = dc.${col.dcFromLocation} ` +
          `WHERE dc.type = 'stock-transfer-delivery-challan' AND dc."isDeleted" = false AND dc."deletedAt" IS NULL ` +
          (o.idsParam ? `AND dc.id = ANY(${o.idsParam}::uuid[]) ` : '') +
          `AND ${completeDocumentExistsSql('dc.id', 'stock-transfer-dc')}`
        );
      }
      case 'rbc': {
        const extra = this.arrivalExtraColumns(o, {
          documentId: this.latestDocumentIdSql('r.id', 'rbc'),
          productCount: `(SELECT COUNT(DISTINCT rp.product_id::text || ':' || COALESCE(rp.varient_id::text, 'null')) FROM returned_products_by_customer rp WHERE rp.${col.returnedPostReturn} = r.id AND rp.product_id IS NOT NULL)`,
          receivedKg: `(SELECT COALESCE(SUM(rp."returnedNetWt"), 0) FROM returned_products_by_customer rp WHERE rp.${col.returnedPostReturn} = r.id AND rp.product_id IS NOT NULL)`,
          dispatchState: 'NULL::text',
          dispatchReady: 'TRUE',
          state: sqlStateExpr('r.id', 'rbc'),
        });
        return (
          `SELECT 'rbc'::text AS source_type, r.id::text AS source_id, r."rbcNo" AS source_no, ` +
          `c.name AS company_name, r.${col.rbcLocation}::text AS location_id, b.name AS location_name, ` +
          `cu.organisation_name AS party_name, ` +
          `COALESCE(r.date::timestamp, r."createdAt") AS source_date` +
          extra +
          ` FROM return_by_customer r ` +
          `LEFT JOIN company c ON c.id = r.${col.rbcCompany} ` +
          `LEFT JOIN branches b ON b.id = r.${col.rbcLocation} ` +
          `LEFT JOIN customers cu ON cu.id = r.${col.rbcCustomer} ` +
          `WHERE r."isDeleted" = false AND r."deletedAt" IS NULL ` +
          (o.idsParam ? `AND r.id = ANY(${o.idsParam}::uuid[]) ` : '') +
          `AND ${completeDocumentExistsSql('r.id', 'rbc')}`
        );
      }
      default:
        throw new AppError(400, 'Source type must be one of grn, stock-transfer-dc, rbc');
    }
  }

  private toArrivalRow(row: ArrivalSqlRow, status: ReceivingSourceStatus | null): ArrivalRow {
    const differenceKg = status ? round3(status.products.reduce((sum, p) => sum + p.differenceKg, 0)) : 0;
    const lossRows = (status?.products ?? []).filter((p) => p.transitLossKg !== null);
    const valued = lossRows.filter((p) => p.transitLossValue !== null);
    const transitLossKg = lossRows.length ? round3(lossRows.reduce((sum, p) => sum + (p.transitLossKg ?? 0), 0)) : null;
    const transitLossValue = valued.length ? Math.round(valued.reduce((sum, p) => sum + (p.transitLossValue ?? 0), 0) * 100) / 100 : null;
    const skipped = status?.skipped ?? { ...NO_SKIPS };
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
      transitLossKg,
      transitLossValue,
      state: status ? status.state : 'not-started',
      slots: {
        aqr: slotState(status?.slots.aqr ?? null),
        inward: slotState(status?.slots.inward ?? null),
        dump: slotWithSkip(slotState(status?.slots.dump ?? null), skipped.dump),
        rtv: row.source_type === 'grn' ? slotWithSkip(slotState(status?.slots.rtv ?? null), skipped.rtv) : null,
      },
      dispatch: status?.dispatch ?? null,
      dispatchState: status?.dispatchState ?? 'none',
      dispatchRequired: status?.dispatchRequired ?? false,
      canReceive: status?.canReceive ?? false,
      blockers: status?.blockers ?? [],
      skipped,
    };
  }
}
