/**
 * All-vouchers Excel export: every voucher type the user can see, in one workbook.
 *
 * Sheets:
 *   Summary     report name, created on / by, applied filters, total amount per voucher type
 *   Details     one row per voucher of any type (the same rows the Details API returns)
 *   Approvals   one row per voucher with who acted at each approval stage
 *
 * Refs carry `kind` (see VOUCHER_KINDS) so each sheet only queries its own table.
 */

import { EntityManager, EntityTarget, In, ObjectLiteral } from 'typeorm';
import { ParsedQs } from 'qs';
import { CashVoucher } from '../multiCashV/entity/mCashVoucher.entity';
import { LPVoucher } from '../labourPaymentV/entity/labourPaymentVoucher.entity';
import { TPVoucher } from '../tranportPaymentV/entity/transportPaymentvoucher.entity';
import { PMPVoucher } from '../paymentMaterialV/entity/packingMaterialVoucher.entity';
import { Company } from '../../company/entity/company.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { ExportCellType, ExportDefinition, ExportLoadContext, ExportSheet, ExportSummarySheet, SummaryRow } from '../../excel/export/exportTypes';
import { chunk } from '../../excel/export/exportQuery';
import { DocumentRow, STAGES, documentHeaderSheet, withDocuments } from '../../excel/export/documentMeta';
import { personName } from '../../excel/export/exportValue';
import { VOUCHER_KINDS, VOUCHER_TYPE_LABELS, VoucherBase, joinVoucherCommon } from './voucherCommon.export';

interface VoucherSource {
  kind: string;
  entity: EntityTarget<ObjectLiteral>;
  /** Amount shown in the report; transport vouchers pay out `finalPayableAmt`. */
  amountColumn: string;
}

const SOURCES: VoucherSource[] = [
  { kind: VOUCHER_KINDS.MULTI_CASH, entity: CashVoucher, amountColumn: 'totalAmt' },
  { kind: VOUCHER_KINDS.LABOUR_PAYMENT, entity: LPVoucher, amountColumn: 'totalAmt' },
  { kind: VOUCHER_KINDS.TRANSPORT_PAYMENT, entity: TPVoucher, amountColumn: 'finalPayableAmt' },
  { kind: VOUCHER_KINDS.PACKING_MATERIAL, entity: PMPVoucher, amountColumn: 'totalAmt' },
];

export const REPORT_NAME = 'All Vouchers Summary Report';

type VoucherRecord = VoucherBase & { voucherType: string; amount: unknown };
export type VoucherDetailRow = DocumentRow<VoucherRecord>;

// ─── Details: one field list feeds both the sheet and the Details API ──────────

interface DetailField {
  /** Property name in the Details API response. */
  key: string;
  header: string;
  maps: string;
  type?: ExportCellType;
  get: (row: VoucherDetailRow) => unknown;
}

export const DETAIL_FIELDS: DetailField[] = [
  { key: 'voucherType', header: 'Voucher Type', maps: 'voucher table', get: (r) => r.record.voucherType },
  { key: 'voucherNo', header: 'Voucher No', maps: '<voucher table>.voucherNo', get: (r) => r.record.voucherNo },
  { key: 'approvalStatus', header: 'Approval Status', maps: 'documents.status', get: (r) => r.doc?.status },
  { key: 'createdBy', header: 'Created By', maps: '<voucher table>.requestedBy -> users', get: (r) => personName(r.record.requestedBy) },
  { key: 'paymentMode', header: 'Payment Mode', maps: '<voucher table>.paymentMode', get: (r) => r.record.paymentMode },
  { key: 'amount', header: 'Amount', maps: '<voucher table>.totalAmt / transport_payment_voucher.finalPayableAmt', type: 'amount', get: (r) => r.record.amount },
  { key: 'debitCreditTo', header: 'Debit / Credit To', maps: '<voucher table>.debitCreditTo', get: (r) => r.record.debitCreditTo },
  { key: 'payReceivedFrom', header: 'Pay / Received From', maps: '<voucher table>.payReceivedFrom', get: (r) => r.record.payReceivedFrom },
  { key: 'receiverName', header: 'Receiver Name', maps: '<voucher table>.receiverName', get: (r) => r.record.receiverName },
  { key: 'location', header: 'Location', maps: '<voucher table>.location -> branches.name', get: (r) => r.record.location?.name },
  { key: 'company', header: 'Company', maps: '<voucher table>.companyName -> company.name', get: (r) => r.record.companyName?.name },
  { key: 'documentCreatedDate', header: 'Document Created Date', maps: 'documents.createdAt', type: 'datetime', get: (r) => r.doc?.createdAt },
  { key: 'documentUpdatedDate', header: 'Document Updated Date', maps: 'documents.updatedAt', type: 'datetime', get: (r) => r.doc?.updatedAt },
];

/** A Details row as the API returns it (ids are included so the table can link to a voucher). */
export function toDetailRecord(row: VoucherDetailRow): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.record.id, documentId: row.doc?.id ?? null };
  for (const field of DETAIL_FIELDS) out[field.key] = field.get(row) ?? null;
  return out;
}

async function loadVoucherRecords(ctx: ExportLoadContext): Promise<VoucherRecord[]> {
  const records: VoucherRecord[] = [];
  for (const source of SOURCES) {
    const ids = ctx.refs.filter((ref) => ref.kind === source.kind).map((ref) => ref.id);
    if (!ids.length) continue;
    const qb = ctx.manager.getRepository(source.entity).createQueryBuilder('voucher');
    joinVoucherCommon(qb, 'voucher');
    const vouchers = (await qb.where('voucher.id IN (:...ids)', { ids }).getMany()) as (VoucherBase & ObjectLiteral)[];
    for (const voucher of vouchers) {
      records.push({
        ...voucher,
        voucherType: VOUCHER_TYPE_LABELS[source.kind],
        amount: voucher[source.amountColumn],
      });
    }
  }
  return records;
}

/** Details rows for a set of refs (any order); the caller orders them. */
export async function loadVoucherDetailRows(ctx: ExportLoadContext): Promise<VoucherDetailRow[]> {
  return withDocuments(ctx, await loadVoucherRecords(ctx));
}

const detailsSheet = documentHeaderSheet<VoucherRecord>({
  name: 'Details',
  loadRecords: loadVoucherRecords,
  columns: DETAIL_FIELDS.map(({ header, maps, type, get }) => ({ header, maps, type, get })),
});

// ─── Approvals: one row per voucher, one column per approval stage ─────────────

type StageRelation = (typeof STAGES)[number]['relation'];

function stageUser(row: VoucherDetailRow, relation: StageRelation): string | null {
  const label = STAGES.find((s) => s.relation === relation)?.label;
  return row.doc?.stages.find((s) => s.stage === label)?.userName ?? null;
}

const approvalsSheet = documentHeaderSheet<VoucherRecord>({
  name: 'Approvals',
  loadRecords: loadVoucherRecords,
  columns: [
    { header: 'Voucher Type', maps: 'voucher table', get: (r) => r.record.voucherType },
    { header: 'Voucher Number', maps: '<voucher table>.voucherNo', get: (r) => r.record.voucherNo },
    { header: 'Approval Status', maps: 'documents.status', get: (r) => r.doc?.status },
    { header: 'Created By', maps: '<voucher table>.requestedBy -> users', get: (r) => personName(r.record.requestedBy) },
    { header: 'Verified By', maps: 'approval_stage_info.verified.userName', get: (r) => stageUser(r, 'verified') },
    { header: 'First Approved By', maps: 'approval_stage_info.firstApproved.userName', get: (r) => stageUser(r, 'firstApproved') },
    { header: 'Second Approved By', maps: 'approval_stage_info.secondApproved.userName', get: (r) => stageUser(r, 'secondApproved') },
    { header: 'First Finalized By', maps: 'approval_stage_info.firstFinalized.userName', get: (r) => stageUser(r, 'firstFinalized') },
    { header: 'Second Finalized By', maps: 'approval_stage_info.secondFinalized.userName', get: (r) => stageUser(r, 'secondFinalized') },
  ],
});

// ─── Summary ───────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query parameters that shape the list but are not filters. */
const NON_FILTER_PARAMS = new Set(['sort', 'sortBy', 'sortOrder', 'page', 'limit']);

function queryText(query: ParsedQs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = query[key];
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  }
  return undefined;
}

/** Names for a comma separated list of ids; a value that is not an id list is shown as typed. */
async function namesFor(manager: EntityManager, entity: EntityTarget<ObjectLiteral>, value: string): Promise<string> {
  const ids = value.split(',').map((v) => v.trim()).filter(Boolean);
  if (!ids.length || !ids.every((id) => UUID.test(id))) return value;
  try {
    const rows = (await manager.getRepository(entity).find({ select: ['id', 'name'] as any, where: { id: In(ids) } as any, withDeleted: true })) as any[];
    const byId = new Map(rows.map((row) => [row.id, row.name]));
    return ids.map((id) => byId.get(id) ?? id).join(', ');
  } catch {
    return value;
  }
}

/** The filters the request applied, as label / value pairs for the Summary sheet. */
export async function describeFilters(manager: EntityManager, query: ParsedQs): Promise<[string, string][]> {
  const out: [string, string][] = [];
  const handled = new Set<string>();
  const add = async (label: string, keys: string[], format?: (value: string) => Promise<string> | string) => {
    keys.forEach((key) => handled.add(key));
    const value = queryText(query, ...keys);
    if (value !== undefined) out.push([label, format ? await format(value) : value]);
  };

  await add('Created From', ['startDate', 'dateFrom']);
  await add('Created To', ['endDate', 'dateTo']);
  await add('Voucher Type', ['voucherType'], (v) =>
    v.split(',').map((kind) => VOUCHER_TYPE_LABELS[kind.trim().toLowerCase()] ?? kind.trim()).join(', '),
  );
  await add('Payment Mode', ['paymentMode']);
  await add('Min Amount', ['minAmount']);
  await add('Max Amount', ['maxAmount']);
  await add('Approval Status', ['status', 'approvalStatus']);
  await add('Location', ['locationId', 'location', 'warehouseId', 'warehouse'], (v) => namesFor(manager, Branches, v));
  await add('Company', ['companyId', 'company'], (v) => namesFor(manager, Company, v));
  await add('Search', ['search']);

  for (const key of Object.keys(query)) {
    if (handled.has(key) || NON_FILTER_PARAMS.has(key)) continue;
    const value = queryText(query, key);
    if (value !== undefined) out.push([key, value]);
  }
  return out;
}

async function totalsPerKind(manager: EntityManager, refs: { id: string; kind?: string }[]): Promise<Map<string, { count: number; total: number }>> {
  const totals = new Map<string, { count: number; total: number }>();
  for (const source of SOURCES) {
    const ids = refs.filter((ref) => ref.kind === source.kind).map((ref) => ref.id);
    let count = 0;
    let total = 0;
    for (const part of chunk(ids, 1000)) {
      const row = await manager
        .getRepository(source.entity)
        .createQueryBuilder('voucher')
        .select('COUNT(voucher.id)', 'cnt')
        .addSelect(`COALESCE(SUM(voucher.${source.amountColumn}), 0)`, 'total')
        .where('voucher.id IN (:...ids)', { ids: part })
        .getRawOne();
      count += Number(row?.cnt) || 0;
      total += Number(row?.total) || 0;
    }
    totals.set(source.kind, { count, total });
  }
  return totals;
}

export interface AllVouchersReportContext {
  /** Name of the logged-in user who runs the report. */
  createdBy: string | null;
  generatedAt: Date;
  /** The request's query string, to list the applied filters. */
  query: ParsedQs;
}

function summarySheet(report: AllVouchersReportContext): ExportSummarySheet {
  return {
    name: 'Summary',
    widths: [30, 42, 20],
    build: async ({ manager, refs }) => {
      const filters = await describeFilters(manager, report.query);
      const totals = await totalsPerKind(manager, refs);

      const rows: SummaryRow[] = [
        { cells: ['Report Name', REPORT_NAME], style: 'title' },
        { cells: ['Created On', report.generatedAt], types: ['text', 'datetime'] },
        { cells: ['Created By', report.createdBy] },
        { cells: [] },
        { cells: ['Applied Filters', ''], style: 'header' },
        ...(filters.length ? filters.map(([label, value]): SummaryRow => ({ cells: [label, value] })) : [{ cells: ['Filters', 'None'] } as SummaryRow]),
        { cells: [] },
        { cells: ['Voucher Type', 'No. of Vouchers', 'Total Amount'], style: 'header' },
      ];

      let grandCount = 0;
      let grandTotal = 0;
      for (const source of SOURCES) {
        const { count, total } = totals.get(source.kind) ?? { count: 0, total: 0 };
        grandCount += count;
        grandTotal += total;
        rows.push({ cells: [VOUCHER_TYPE_LABELS[source.kind], count, total], types: ['text', 'integer', 'amount'] });
      }
      rows.push({ cells: ['Grand Total', grandCount, grandTotal], types: ['text', 'integer', 'amount'], style: 'total' });
      return rows;
    },
  };
}

export function buildAllVouchersExport(report: AllVouchersReportContext): ExportDefinition {
  return {
    fileStem: 'All_Vouchers',
    summarySheets: [summarySheet(report)],
    sheets: [detailsSheet as ExportSheet, approvalsSheet as ExportSheet],
  };
}

/** Context-free definition, for structural checks (the real export is built per request). */
export const ALL_VOUCHERS_EXPORT: ExportDefinition = buildAllVouchersExport({ createdBy: null, generatedAt: new Date(0), query: {} });
