/**
 * Receiving links — the rules that keep one source ⇄ one AQR / Inward / Dump /
 * RTV consistent (docs/receiving-links-plan.md §2.2, rules R1–R11).
 *
 * The services that create or edit processing documents call
 * {@link ReceivingGuardService.resolveAndAssert} before they save, inside their
 * own transaction, and the source services call
 * {@link ReceivingGuardService.assertSourceEditable} before they change or
 * delete a source that may already have been received.
 */

import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';

import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { DispatchType } from '../../vehicleDispatch/entity/vehicleDispatch.entity';
import { dispatchGate } from '../../vehicleDispatch/service/dispatchRules';
import { GRN, GrnDeliveryMode } from '../../grn/entity/grn.entity';
import { StockTransferDeliveryChallan } from '../../deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity';
import { PostReturnByCustomer } from '../../returnByCustomer/entity/postReturnByCustomer.entity';
import {
  DuplicateLineInput,
  ProcessingDocType,
  ReceivingSourceType,
  ResolveAndAssertInput,
  ResolvedSource,
} from '../receiving.types';
import {
  aggregateDocLines,
  aggregateSourceLines,
  findDuplicateLines,
  isCountingDocument,
  PROCESSING_DOC_LABEL,
  SOURCE_TYPE_LABEL,
  validateLinesAgainstSource,
} from '../receiving.helpers';
import { isReceivingSourceType } from '../receiving.sql';
import { ProcessingDocument, ReceivingStatusService } from './receivingStatus.service';

/** Inward / Dump type values → source type. */
const SOURCE_TYPE_BY_DOC_KIND: Record<string, ReceivingSourceType> = {
  purchase: 'grn',
  transferred: 'stock-transfer-dc',
  'returned-by-customer': 'rbc',
  transfer: 'stock-transfer-dc',
};

const DOC_LABEL_WITH_ARTICLE: Record<ProcessingDocType, string> = {
  aqr: 'An Arrival Quality Report',
  inward: 'An Inward Register',
  dump: 'A Dump Register',
  rtv: 'A Return To Vendor',
};

export interface SourceRefs {
  grnId?: string | null;
  deliveryChallanId?: string | null;
  rbcId?: string | null;
}

export interface SourceRef {
  sourceType: ReceivingSourceType;
  sourceId: string;
}

@injectable()
export class ReceivingGuardService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.ReceivingStatusService) private readonly receivingStatusService: ReceivingStatusService,
  ) {}

  /** `purchase` → grn, `transferred` → stock-transfer-dc, `returned-by-customer` → rbc; null otherwise. */
  static sourceTypeFromDocKind(value: string | null | undefined): ReceivingSourceType | null {
    if (!value) return null;
    return SOURCE_TYPE_BY_DOC_KIND[String(value)] ?? null;
  }

  /**
   * Picks the source a document points at. When the document declares its
   * kind (inwardType / dumpType / aqrFor) the matching reference must be
   * present — a Purchase inward with only a DC id is a form error, not a DC
   * inward. Without a declared kind the single populated reference is used.
   * Returns null when nothing usable is set.
   */
  static pickSourceRef(refs: SourceRefs, declaredType?: ReceivingSourceType | null): SourceRef | null {
    const byType: Record<ReceivingSourceType, string | null> = {
      grn: refs.grnId ? String(refs.grnId) : null,
      'stock-transfer-dc': refs.deliveryChallanId ? String(refs.deliveryChallanId) : null,
      rbc: refs.rbcId ? String(refs.rbcId) : null,
    };
    if (declaredType) {
      const declaredId = byType[declaredType];
      return declaredId ? { sourceType: declaredType, sourceId: declaredId } : null;
    }
    const populated = (Object.keys(byType) as ReceivingSourceType[]).filter((t) => byType[t]);
    if (populated.length === 1) {
      return { sourceType: populated[0], sourceId: byType[populated[0]]! };
    }
    return null;
  }

  /**
   * R1–R7 and R12. Locks the source row (`SELECT … FOR UPDATE`) through `manager` when
   * it is inside a transaction so concurrent creates for the same source
   * serialise, then validates the lines. Returns the resolved source so the
   * caller can default company / location / party from it.
   */
  async resolveAndAssert(input: ResolveAndAssertInput): Promise<ResolvedSource> {
    const { docType, sourceType, sourceId, excludeDocId } = input;
    const manager = input.manager ?? this.dataSource.manager;

    if (!sourceType || !sourceId || !isReceivingSourceType(sourceType)) {
      throw new AppError(400, 'Select the GRN / Transfer DC / RBC this document is for');
    }
    if (docType === 'rtv' && sourceType !== 'grn') {
      throw new AppError(400, 'Return To Vendor can only be raised against a GRN');
    }

    const label = SOURCE_TYPE_LABEL[sourceType];

    // R6 — serialise concurrent creates on the same source.
    const locked = await this.lockSourceRow(sourceType, sourceId, manager);
    if (!locked) throw new AppError(400, `Selected ${label} was not found`);
    if (locked.isDeleted || locked.deletedAt) throw new AppError(400, `Selected ${label} has been deleted`);

    // R1 / R2 / R3
    const source = await this.receivingStatusService.loadSource(sourceType, sourceId, manager);
    if (!source) throw new AppError(400, `Selected ${label} was not found`);
    if (!source.info.isComplete) throw new AppError(400, 'Source is not approved yet');
    if (sourceType === 'grn' && source.info.deliveryMode === GrnDeliveryMode.DIRECT_TO_CUSTOMER) {
      throw new AppError(400, 'This GRN is delivered directly to the customer');
    }

    // R12 — the vehicle dispatch of the GRN / Transfer DC must be approved before receiving
    // starts (docs/dispatch-enforcement-plan.md D3). Checked on create only, so documents
    // raised before the rule existed stay editable.
    if (!excludeDocId && (sourceType === 'grn' || sourceType === 'stock-transfer-dc')) {
      const gate = await dispatchGate(manager, sourceType === 'grn' ? DispatchType.PURCHASE : DispatchType.STOCK_TRANSFER, sourceId);
      if (!gate.ready) throw new AppError(400, `Receiving cannot start yet: ${gate.reasons.join('; ')}`);
    }

    const sourceNo = source.info.no ?? `${label} ${sourceId}`;

    // R6 — one counting document of this type per source.
    const allDocs = (await this.receivingStatusService.loadProcessingDocuments(sourceType, [sourceId], manager)).get(sourceId) ?? [];
    const counting = allDocs.filter((d) => isCountingDocument(d) && d.id !== excludeDocId);
    const sameType = counting.filter((d) => d.docType === docType);
    if (sameType.length > 0) {
      const existing = sameType[0];
      throw new AppError(409, `${DOC_LABEL_WITH_ARTICLE[docType]} already exists for ${sourceNo} (${existing.docNo ?? existing.id})`);
    }

    const sourceAgg = aggregateSourceLines(source.lines);

    // What arrived (the counting AQR): the basis for Inward / Dump / RTV.
    if (docType !== 'aqr') {
      const aqrDocs = counting.filter((d) => d.docType === 'aqr');
      if (aqrDocs.length > 0) {
        const arrived = aggregateDocLines(aqrDocs.flatMap((d) => d.lines), sourceAgg);
        sourceAgg.forEach((line, key) => {
          const a = arrived.get(key);
          line.arrivedKg = a ? a.kg : 0;
          line.arrivedQty = a ? a.qty : null;
        });
      }
    }

    // R5 — kg already claimed by the other counting documents (AQR never
    // consumes). For an AQR these are all of Inward / Dump / RTV: what arrived
    // cannot be less than what they already record.
    const consumedByOthers = new Map<string, number>();
    const others: ProcessingDocument[] = counting.filter((d) => d.docType !== 'aqr' && d.docType !== docType);
    aggregateDocLines(others.flatMap((d) => d.lines), sourceAgg).forEach((line, key) => consumedByOthers.set(key, line.kg));

    // R4 / R5 / R7
    const errors = validateLinesAgainstSource(docType, sourceAgg, input.lines ?? [], consumedByOthers, { sourceType, sourceNo });
    if (errors.length > 0) {
      throw new AppError(400, errors.join('; '));
    }

    return {
      sourceType,
      sourceId,
      sourceNo: source.info.no,
      companyId: source.info.companyId,
      companyName: source.info.companyName,
      locationId: source.info.locationId,
      locationName: source.info.locationName,
      fromLocationId: source.info.fromLocationId,
      fromLocationName: source.info.fromLocationName,
      partyType: source.info.partyType,
      partyId: source.info.partyId,
      partyName: source.info.partyName,
      batchNo: source.info.batchNo,
      products: Array.from(sourceAgg.values()),
    };
  }

  /**
   * R9 / R10 — a source with a counting processing document cannot be edited
   * or deleted; the documents must be rejected or deleted first.
   */
  async assertSourceEditable(sourceType: ReceivingSourceType, sourceId: string, manager?: EntityManager): Promise<void> {
    if (!sourceId || !isReceivingSourceType(sourceType)) return;
    const docs = (await this.receivingStatusService.loadProcessingDocuments(sourceType, [sourceId], manager)).get(sourceId) ?? [];
    const counting = docs.filter((d) => isCountingDocument(d));
    if (counting.length === 0) return;

    const sourceNo = (await this.receivingStatusService.loadSourceNo(sourceType, sourceId, manager)) ?? `${SOURCE_TYPE_LABEL[sourceType]} ${sourceId}`;
    const list = counting.map((d) => `${PROCESSING_DOC_LABEL[d.docType]} ${d.docNo ?? d.id}`).join(', ');
    const verb = counting.length === 1 ? 'has' : 'have';
    throw new AppError(409, `${sourceNo} cannot be changed: ${list} ${verb} already been raised against it. Reject or delete them first.`);
  }

  /** R11 — a source may list each product + variant once. */
  assertNoDuplicateLines(lines: DuplicateLineInput[]): void {
    const message = findDuplicateLines(lines);
    if (message) throw new AppError(400, message);
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async lockSourceRow(
    sourceType: ReceivingSourceType,
    sourceId: string,
    manager: EntityManager,
  ): Promise<{ id: string; isDeleted: boolean; deletedAt: Date | null } | null> {
    const entity = sourceType === 'grn' ? GRN : sourceType === 'stock-transfer-dc' ? StockTransferDeliveryChallan : PostReturnByCustomer;
    const qb = manager
      .getRepository(entity)
      .createQueryBuilder('s')
      .withDeleted()
      .select(['s.id', 's.isDeleted', 's.deletedAt'])
      .where('s.id = :id', { id: sourceId });

    // A pessimistic lock needs an open transaction; outside one TypeORM throws,
    // so only lock when the caller passed a transactional manager.
    if (manager.queryRunner?.isTransactionActive) {
      qb.setLock('pessimistic_write');
    }
    const row = (await qb.getOne()) as { id: string; isDeleted: boolean; deletedAt: Date | null } | null;
    return row ?? null;
  }
}
