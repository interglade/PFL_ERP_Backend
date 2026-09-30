/**
 * Approval-workflow data shared by every document export.
 *
 * Status and approval history do not live on the module tables (rfpa, grns, ...):
 * each record is tracked by a row in `documents`, whose `approvalInfo`
 * (`documents_approve_by_whom`) points at one `approval_stage_info` row per stage
 * that has been acted on. This file loads that once per chunk and exposes it as
 * header columns and as a separate Approvals sheet.
 */

import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { Documentb } from '../../approvalFlow/entity/docuemnt.entity';
import { ExportColumn, ExportLoadContext, ExportSheet } from './exportTypes';
import { USER_COLUMNS, chunk } from './exportQuery';
import { personName } from './exportValue';

/** Stage relations on `documents_approve_by_whom`, in workflow order. */
const STAGES = [
  { relation: 'verified', label: 'Verifier' },
  { relation: 'firstApproved', label: 'Approver Level 1' },
  { relation: 'secondApproved', label: 'Approver Level 2' },
  { relation: 'thirdApproved', label: 'Approver Level 3' },
  { relation: 'firstFinalized', label: 'Finalizer Level 1' },
  { relation: 'secondFinalized', label: 'Finalizer Level 2' },
] as const;

const STAGE_COLUMNS = ['id', 'userId', 'userName', 'status', 'reason', 'statusChangedAt'] as const;

export interface ApprovalStageRow {
  stage: string;
  stageOrder: number;
  userId: string | null;
  userName: string | null;
  status: string | null;
  reason: string | null;
  statusChangedAt: Date | null;
}

export interface DocumentMeta {
  id: string;
  type: string | null;
  status: string | null;
  remarks: string | null;
  totalAmt: number | string | null;
  inventoryProcessed: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  documentTypeId: string | null;
  creator: { id: string; firstName?: string; middleName?: string; lastName?: string; employeeId?: string } | null;
  /** Stages that have been acted on, in workflow order. */
  stages: ApprovalStageRow[];
}

/** A module record paired with its approval document. */
export interface DocumentRow<T> {
  record: T;
  doc: DocumentMeta | null;
}

/** Query-parameter chunk size for `IN (...)` lists; far below Postgres' 65535 limit. */
const META_CHUNK = 1000;

export async function loadDocumentMeta(
  manager: EntityManager,
  documentIds: readonly string[],
): Promise<Map<string, DocumentMeta>> {
  const result = new Map<string, DocumentMeta>();
  const unique = Array.from(new Set(documentIds.filter(Boolean)));

  for (const ids of chunk(unique, META_CHUNK)) {
    const qb = manager
      .getRepository(Documentb)
      .createQueryBuilder('doc')
      .select([
        'doc.id',
        'doc.type',
        'doc.status',
        'doc.remarks',
        'doc.totalAmt',
        'doc.inventoryProcessed',
        'doc.createdAt',
        'doc.updatedAt',
        'doc.document_type_id',
      ])
      .leftJoin('doc.lastActionBy', 'creator')
      .addSelect(USER_COLUMNS.map((c) => `creator.${c}`))
      .leftJoin('doc.approvalInfo', 'info')
      .addSelect('info.id');

    for (const stage of STAGES) {
      qb.leftJoin(`info.${stage.relation}`, stage.relation).addSelect(
        STAGE_COLUMNS.map((c) => `${stage.relation}.${c}`),
      );
    }

    const docs = await qb.where('doc.id IN (:...ids)', { ids }).withDeleted().getMany();

    for (const doc of docs as any[]) {
      const info = doc.approvalInfo;
      const stages: ApprovalStageRow[] = [];
      STAGES.forEach((stage, index) => {
        const s = info?.[stage.relation];
        if (!s) return;
        stages.push({
          stage: stage.label,
          stageOrder: index + 1,
          userId: s.userId ?? null,
          userName: s.userName ?? null,
          status: s.status ?? null,
          reason: s.reason ?? null,
          statusChangedAt: s.statusChangedAt ?? null,
        });
      });

      result.set(doc.id, {
        id: doc.id,
        type: doc.type ?? null,
        status: doc.status ?? null,
        remarks: doc.remarks ?? null,
        totalAmt: doc.totalAmt ?? null,
        inventoryProcessed: doc.inventoryProcessed ?? null,
        createdAt: doc.createdAt ?? null,
        updatedAt: doc.updatedAt ?? null,
        documentTypeId: doc.document_type_id ?? null,
        creator: doc.lastActionBy ?? null,
        stages,
      });
    }
  }

  return result;
}

/** Pairs loaded records with their approval documents, via the list's refs. */
export async function withDocuments<T extends { id: string }>(
  ctx: ExportLoadContext,
  records: T[],
): Promise<DocumentRow<T>[]> {
  const meta = await loadDocumentMeta(ctx.manager, ctx.documentIds);
  const documentIdByRecord = new Map(ctx.refs.map((ref) => [ref.id, ref.documentId]));
  return records.map((record) => {
    const documentId = documentIdByRecord.get(record.id);
    return { record, doc: documentId ? meta.get(documentId) ?? null : null };
  });
}

/**
 * A header sheet: one row per document, the module's record plus its approval
 * document. `loadRecords` loads the chunk's records; pairing is done here.
 */
export function documentHeaderSheet<T extends { id: string }>(options: {
  name: string;
  columns: ExportColumn<DocumentRow<T>>[];
  loadRecords: (ctx: ExportLoadContext) => Promise<T[]>;
}): ExportSheet<DocumentRow<T>> {
  return {
    name: options.name,
    columns: options.columns,
    refId: (row) => row.record.id,
    load: async (ctx) => withDocuments(ctx, await options.loadRecords(ctx)),
  };
}

/** Status/approval/audit columns appended to every document header sheet. */
export function documentColumns<T>(): ExportColumn<DocumentRow<T>>[] {
  return [
    { header: 'Overall Status', maps: 'documents.status', get: (r) => r.doc?.status },
    { header: 'Document Created By', maps: 'documents.lastActionBy -> users', get: (r) => personName(r.doc?.creator) },
    { header: 'Document Created Date', maps: 'documents.createdAt', type: 'datetime', get: (r) => r.doc?.createdAt },
    { header: 'Document Updated Date', maps: 'documents.updatedAt', type: 'datetime', get: (r) => r.doc?.updatedAt },
  ];
}

interface ApprovalRow extends ApprovalStageRow {
  recordId: string;
  recordType: string | null;
  documentNo: string | null;
  documentId: string;
  overallStatus: string | null;
}

export interface ApprovalSource {
  entity: EntityTarget<ObjectLiteral>;
  /** The module's document number column (`rfpaId`, `grnNo`, ...). */
  numberColumn: string;
  /** Only refs with this `ExportRef.kind` belong to this source. */
  kind?: string;
  /** Value of the type column, e.g. `Multi Cash Voucher`. */
  typeLabel?: string;
}

/**
 * Id and workflow-position columns of the Approvals sheet that modules leave out of
 * their workbook: `withoutColumns(approvalSheet(...), APPROVAL_ID_COLUMNS)`.
 */
export const APPROVAL_ID_COLUMNS = ['Record ID', 'Document ID', 'Stage Order', 'Action By User ID'] as const;

/** `APPROVAL_ID_COLUMNS` plus the stage name, for modules that also hide the stage. */
export const APPROVAL_ID_AND_STAGE_COLUMNS = [...APPROVAL_ID_COLUMNS, 'Stage'] as const;

/**
 * Approval history sheet: one row per stage acted on, per document.
 *
 * Each source's number column is read so every row can be traced by document
 * number without an id lookup. Pass `typeHeader` when several sources share the
 * sheet (all vouchers) to add a column naming the record type.
 */
export function approvalSheet(options: {
  numberHeader: string;
  sources: ApprovalSource[];
  typeHeader?: string;
  name?: string;
}): ExportSheet<ApprovalRow> {
  const columns: ExportColumn<ApprovalRow>[] = [];
  if (options.typeHeader) {
    columns.push({ header: options.typeHeader, maps: 'record type', get: (r) => r.recordType });
  }
  columns.push(
    { header: options.numberHeader, maps: `module.${options.sources.map((s) => s.numberColumn).join('/')}`, get: (r) => r.documentNo },
    { header: 'Record ID', maps: 'module.id', get: (r) => r.recordId },
    { header: 'Document ID', maps: 'documents.id', get: (r) => r.documentId },
    { header: 'Overall Status', maps: 'documents.status', get: (r) => r.overallStatus },
    { header: 'Stage', maps: 'documents_approve_by_whom.<stage>', get: (r) => r.stage },
    { header: 'Stage Order', maps: 'workflow order', type: 'integer', get: (r) => r.stageOrder },
    { header: 'Action', maps: 'approval_stage_info.status', get: (r) => r.status },
    { header: 'Action By', maps: 'approval_stage_info.userName', get: (r) => r.userName },
    { header: 'Action By User ID', maps: 'approval_stage_info.userId', get: (r) => r.userId },
    { header: 'Reason', maps: 'approval_stage_info.reason', get: (r) => r.reason },
    { header: 'Action Date', maps: 'approval_stage_info.statusChangedAt', type: 'datetime', get: (r) => r.statusChangedAt },
  );

  return {
    name: options.name ?? 'Approvals',
    refId: (row) => row.recordId,
    columns,
    load: async (ctx) => {
      const numberById = new Map<string, string | null>();
      const typeById = new Map<string, string | null>();

      for (const source of options.sources) {
        const ids = ctx.refs.filter((ref) => !source.kind || ref.kind === source.kind).map((ref) => ref.id);
        if (!ids.length) continue;
        const numbers = await ctx.manager
          .getRepository(source.entity)
          .createQueryBuilder('rec')
          .select(['rec.id', `rec.${source.numberColumn}`])
          .where('rec.id IN (:...ids)', { ids })
          .withDeleted()
          .getMany();
        for (const n of numbers as any[]) {
          numberById.set(n.id, n[source.numberColumn] ?? null);
          typeById.set(n.id, source.typeLabel ?? null);
        }
      }

      const meta = await loadDocumentMeta(ctx.manager, ctx.documentIds);
      const rows: ApprovalRow[] = [];
      for (const ref of ctx.refs) {
        if (!numberById.has(ref.id)) continue;
        const doc = ref.documentId ? meta.get(ref.documentId) : undefined;
        if (!doc) continue;
        for (const stage of doc.stages) {
          rows.push({
            ...stage,
            recordId: ref.id,
            recordType: typeById.get(ref.id) ?? null,
            documentNo: numberById.get(ref.id) ?? null,
            documentId: doc.id,
            overallStatus: doc.status,
          });
        }
      }
      return rows;
    },
  };
}
