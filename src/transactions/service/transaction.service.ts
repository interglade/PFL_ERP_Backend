/**
 * Read side of transaction tracking (docs/transaction-tracking-plan.md §9.5):
 * list, dashboard summary, search, detail and stock ledger.
 *
 * Raw SQL only with constant identifiers (TXN_DOC_TYPES, fixed table names,
 * whitelisted sort columns); every value from the request is a bound
 * parameter. Foreign-key columns of relations without an explicit
 * `@JoinColumn` come from TypeORM metadata (`fkColumn`).
 */

import { inject, injectable } from 'inversify';
import { DataSource, EntityManager } from 'typeorm';
import { TYPES } from '../../types';
import AppError from '../../utils/appError';
import { DocumentStatus, DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { ReceivingStatusService } from '../../receiving/service/receivingStatus.service';
import { ReceivingProductRow, ReceivingSourceType } from '../../receiving/receiving.types';
import { Item } from '../../deliveryChallans/deliverychllan/entity/dItem.entity';
import { ReturnedProducts } from '../../returnByCustomer/entity/returnProduct.entity';
import { DocFact, fkColumn, ident, isLiveDoc, isUuid } from '../transaction.docs';
import { parseTxnNo } from '../transaction.number';
import { refreshTransaction } from '../transaction.core';
import { evaluateTransaction, pickDoc } from '../transaction.stage';
import {
  TXN_DOC_TYPES,
  TXN_STATUSES,
  TXN_TYPES,
  TxnDashboardSummary,
  TxnDetail,
  TxnDocType,
  TxnLedgerRow,
  TxnLinkRow,
  TxnListRow,
  TxnQuantityRow,
  TxnRelatedRow,
  TxnSearchHit,
  TxnStatus,
  TxnSummary,
  TxnType,
} from '../transaction.types';

export interface TxnListFilter {
  page: number;
  limit: number;
  search?: string;
  sort?: string;
  types?: TxnType[];
  statuses?: TxnStatus[];
  stages?: string[];
  companyId?: string;
  locationId?: string;
  startDate?: string;
  endDate?: string;
}

export interface TxnListResult {
  data: TxnListRow[];
  total: number;
}

export const TXN_EXPORT_MAX_ROWS = 5000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
/** `YYYY-MM-DD` of a date column (pg returns a string or a local-midnight Date). */
const dateOnly = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return null;
};
/** Escapes LIKE wildcards in user text (backslash is the default escape). */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Sort keys accepted from `?sort=key:ASC|DESC` → SQL expression (constants only). */
const SORT_COLUMNS: Record<string, string> = {
  openedAt: 't.opened_at',
  txnNo: 't.txn_no',
  type: 't.txn_type',
  status: 't.status',
  stage: 't.stage',
  partyName: 't.party_name',
  companyName: 'c.name',
  locationName: 'l.name',
  daysOpen: 'days_open',
  totalValue: "(t.summary->>'totalValue')::numeric",
  totalKg: "(t.summary->>'totalKg')::numeric",
  totalQty: "(t.summary->>'totalQty')::numeric",
  productCount: "(t.summary->>'productCount')::numeric",
  closedAt: 't.closed_at',
};

const DAYS_OPEN_SQL = `GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(t.closed_at, t.cancelled_at, now()) - t.opened_at)) / 86400))::int`;

const LIST_SELECT = `
  SELECT t.txn_no, t.txn_type, t.status, t.stage, t.stage_label, t.opened_at, t.closed_at, t.cancelled_at,
         ${DAYS_OPEN_SQL} AS days_open,
         c.name AS company_name, l.name AS location_name, tl.name AS to_location_name, t.party_name, t.summary,
         t.origin_doc_type, t.origin_doc_id::text AS origin_doc_id, od.doc_no AS origin_doc_no,
         od.approval_document_id::text AS origin_document_id
    FROM transactions t
    LEFT JOIN company c ON c.id = t.company_id
    LEFT JOIN branches l ON l.id = t.location_id
    LEFT JOIN branches tl ON tl.id = t.to_location_id
    LEFT JOIN transaction_documents od ON od.doc_type = t.origin_doc_type AND od.doc_id = t.origin_doc_id`;

interface ListSqlRow {
  txn_no: string;
  txn_type: TxnType;
  status: TxnStatus;
  stage: string;
  stage_label: string;
  opened_at: Date;
  closed_at: Date | null;
  cancelled_at: Date | null;
  days_open: number | string;
  company_name: string | null;
  location_name: string | null;
  to_location_name: string | null;
  party_name: string | null;
  summary: Partial<TxnSummary> | null;
  origin_doc_type: TxnDocType;
  origin_doc_id: string;
  origin_doc_no: string | null;
  origin_document_id: string | null;
}

function toListRow(r: ListSqlRow): TxnListRow {
  const s = r.summary ?? {};
  return {
    txnNo: r.txn_no,
    type: r.txn_type,
    status: r.status,
    stage: r.stage,
    stageLabel: r.stage_label,
    openedAt: iso(r.opened_at) ?? '',
    closedAt: iso(r.closed_at),
    cancelledAt: iso(r.cancelled_at),
    daysOpen: num(r.days_open),
    companyName: r.company_name,
    locationName: r.location_name,
    toLocationName: r.to_location_name,
    partyName: r.party_name,
    productCount: num(s.productCount),
    totalQty: num(s.totalQty),
    totalKg: num(s.totalKg),
    totalValue: num(s.totalValue),
    origin: { docType: r.origin_doc_type, id: r.origin_doc_id, docNo: r.origin_doc_no, documentId: r.origin_document_id },
  };
}

/** Voucher tables of a GRN (constants). */
const VOUCHERS: Array<{ table: string; amountColumn: string; type: DocumentTypeEnum; label: string }> = [
  { table: 'multiple_cash_voucher', amountColumn: 'totalAmt', type: DocumentTypeEnum.MULTI_CASH_VOUCHER, label: 'Multi Cash Voucher' },
  { table: 'labour_payment_voucher', amountColumn: 'totalAmt', type: DocumentTypeEnum.LABOR_PAYMENT_VOUCHER, label: 'Labour Payment Voucher' },
  { table: 'packing_material_payment', amountColumn: 'totalAmt', type: DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER, label: 'Packing Material Voucher' },
  { table: 'transport_payment_voucher', amountColumn: 'totalPayableAmt', type: DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER, label: 'Transport Payment Voucher' },
];

const QUANTITY_COLUMNS: Record<TxnType, { key: string; label: string }[]> = {
  purchase: [
    { key: 'grn', label: 'GRN (kg)' },
    { key: 'dispatched', label: 'Dispatched (kg)' },
    { key: 'arrived', label: 'Arrived (kg)' },
    { key: 'inward', label: 'Inward (kg)' },
    { key: 'dump', label: 'Dump (kg)' },
    { key: 'rtv', label: 'Returned to vendor (kg)' },
    { key: 'loss', label: 'Transit loss (kg)' },
  ],
  transfer: [
    { key: 'sent', label: 'Sent (kg)' },
    { key: 'dispatched', label: 'Dispatched (kg)' },
    { key: 'arrived', label: 'Arrived (kg)' },
    { key: 'inward', label: 'Inward (kg)' },
    { key: 'dump', label: 'Dump (kg)' },
    { key: 'loss', label: 'Transit loss (kg)' },
  ],
  sale: [
    { key: 'delivered', label: 'Delivered' },
    { key: 'returned', label: 'Returned' },
    { key: 'invoiced', label: 'Invoiced' },
  ],
  'other-sale': [{ key: 'sold', label: 'Sold' }],
  'second-sale': [{ key: 'sold', label: 'Sold' }],
};

/** Accumulates quantity rows per product / variant. */
class QuantityTable {
  private rows = new Map<string, TxnQuantityRow>();
  constructor(private readonly keys: string[]) {}

  add(line: { productId: string | null; productName: string | null; variantId?: string | null; variantName: string | null; uomName: string | null }, key: string, value: number | null): void {
    if (!line.productId) return;
    const id = `${line.productId}|${line.variantId ?? ''}`;
    let row = this.rows.get(id);
    if (!row) {
      row = { productId: line.productId, productName: line.productName, variantName: line.variantName, uomName: line.uomName, values: {} };
      for (const k of this.keys) row.values[k] = null;
      this.rows.set(id, row);
    }
    if (value === null || value === undefined) return;
    row.values[key] = round3((row.values[key] ?? 0) + value);
  }

  list(): TxnQuantityRow[] {
    return Array.from(this.rows.values()).sort((a, b) => `${a.productName ?? ''}${a.variantName ?? ''}`.localeCompare(`${b.productName ?? ''}${b.variantName ?? ''}`));
  }
}

interface LineSqlRow {
  product_id: string | null;
  product_name: string | null;
  variant_id: string | null;
  variant_name: string | null;
  uom_name: string | null;
  qty: string | null;
  kg: string | null;
}

@injectable()
export class TransactionService {
  constructor(@inject(TYPES.DataSource) private readonly dataSource: DataSource) {}

  private get manager(): EntityManager {
    return this.dataSource.manager;
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  private whereOf(filter: Omit<TxnListFilter, 'page' | 'limit' | 'sort'>): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (filter.types?.length) clauses.push(`t.txn_type = ANY(${bind(filter.types)}::varchar[])`);
    if (filter.statuses?.length) clauses.push(`t.status = ANY(${bind(filter.statuses)}::varchar[])`);
    if (filter.stages?.length) clauses.push(`t.stage = ANY(${bind(filter.stages)}::varchar[])`);
    if (filter.companyId) clauses.push(`t.company_id = ${bind(filter.companyId)}::uuid`);
    if (filter.locationId) {
      const p = bind(filter.locationId);
      clauses.push(`(t.location_id = ${p}::uuid OR t.to_location_id = ${p}::uuid)`);
    }
    if (filter.startDate) clauses.push(`t.business_date >= ${bind(filter.startDate)}::date`);
    if (filter.endDate) clauses.push(`t.business_date <= ${bind(filter.endDate)}::date`);
    if (filter.search) {
      const p = bind(`%${likeEscape(filter.search)}%`);
      clauses.push(
        `(t.txn_no ILIKE ${p} OR t.party_name ILIKE ${p}
          OR EXISTS (SELECT 1 FROM transaction_documents sd WHERE sd.txn_no = t.txn_no AND sd.doc_no ILIKE ${p}))`,
      );
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  private orderOf(sort: string | undefined): string {
    const [field, dir] = (sort ?? '').split(',')[0].split(':');
    const column = SORT_COLUMNS[(field ?? '').trim()];
    const direction = (dir ?? '').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    return column ? `${column} ${direction} NULLS LAST, t.txn_no DESC` : 't.opened_at DESC, t.txn_no DESC';
  }

  async list(filter: TxnListFilter): Promise<TxnListResult> {
    const where = this.whereOf(filter);
    const countRows: Array<{ n: string }> = await this.manager.query(`SELECT COUNT(*) AS n FROM transactions t ${where.sql}`, where.params);
    const limit = Math.min(Math.max(1, Math.floor(filter.limit) || 10), 200);
    const page = Math.max(1, Math.floor(filter.page) || 1);
    const params = [...where.params, limit, (page - 1) * limit];
    const rows: ListSqlRow[] = await this.manager.query(
      `${LIST_SELECT} ${where.sql} ORDER BY ${this.orderOf(filter.sort)} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: rows.map(toListRow), total: num(countRows[0]?.n) };
  }

  /** Rows for the list workbook (same filters, at most TXN_EXPORT_MAX_ROWS). */
  async exportRows(filter: Omit<TxnListFilter, 'page' | 'limit'>): Promise<{ rows: TxnListRow[]; total: number }> {
    const where = this.whereOf(filter);
    const countRows: Array<{ n: string }> = await this.manager.query(`SELECT COUNT(*) AS n FROM transactions t ${where.sql}`, where.params);
    const params = [...where.params, TXN_EXPORT_MAX_ROWS];
    const rows: ListSqlRow[] = await this.manager.query(
      `${LIST_SELECT} ${where.sql} ORDER BY ${this.orderOf(filter.sort)} LIMIT $${params.length}`,
      params,
    );
    return { rows: rows.map(toListRow), total: num(countRows[0]?.n) };
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  async summary(): Promise<TxnDashboardSummary> {
    const typeRows: Array<{ txn_type: TxnType; status: TxnStatus; n: string }> = await this.manager.query(
      `SELECT txn_type, status, COUNT(*) AS n FROM transactions GROUP BY txn_type, status`,
    );
    const stageRows: Array<{ txn_type: TxnType; stage: string; stage_label: string; n: string; old: string }> = await this.manager.query(
      `SELECT txn_type, stage, stage_label, COUNT(*) AS n,
              COUNT(*) FILTER (WHERE opened_at < now() - interval '7 days') AS old
         FROM transactions WHERE status = 'Open'
        GROUP BY txn_type, stage, stage_label
        ORDER BY txn_type, COUNT(*) DESC`,
    );
    const byType = TXN_TYPES.map((type) => {
      const count = (status: TxnStatus) => num(typeRows.find((r) => r.txn_type === type && r.status === status)?.n);
      return { type, open: count('Open'), closed: count('Closed'), cancelled: count('Cancelled') };
    });
    const byStage = stageRows.map((r) => ({ type: r.txn_type, stage: r.stage, stageLabel: r.stage_label, count: num(r.n), over7Days: num(r.old) }));
    return { byType, byStage };
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  /** A transaction, document or batch number → the transaction(s), exact matches first, at most 20. */
  async search(q: string): Promise<TxnSearchHit[]> {
    const text = q.trim().slice(0, 60);
    if (text.length < 2) return [];
    const like = `%${likeEscape(text)}%`;
    const hits: Array<TxnSearchHit & { exact: boolean }> = [];

    const txns: Array<{ txn_no: string; txn_type: TxnType; status: TxnStatus }> = await this.manager.query(
      `SELECT txn_no, txn_type, status FROM transactions WHERE txn_no ILIKE $1 ORDER BY opened_at DESC LIMIT 20`,
      [like],
    );
    for (const t of txns) hits.push({ txnNo: t.txn_no, type: t.txn_type, status: t.status, matchedBy: 'transaction', matchedNo: t.txn_no, exact: t.txn_no.toUpperCase() === text.toUpperCase() });

    // Every header table once (the three DC kinds share one table).
    const tables = new Map<string, string>();
    for (const info of Object.keys(TXN_DOC_TYPES).map((k) => TXN_DOC_TYPES[k as TxnDocType])) tables.set(info.table, info.numberColumn);
    for (const [table, column] of Array.from(tables.entries())) {
      const rows: Array<{ no: string; txn_no: string; txn_type: TxnType; status: TxnStatus }> = await this.manager.query(
        `SELECT h.${ident(column)}::text AS no, t.txn_no, t.txn_type, t.status
           FROM ${ident(table)} h JOIN transactions t ON t.txn_no = h.txn_no
          WHERE h.txn_no IS NOT NULL AND h.${ident(column)}::text ILIKE $1
          ORDER BY h."createdAt" DESC LIMIT 20`,
        [like],
      );
      for (const r of rows) hits.push({ txnNo: r.txn_no, type: r.txn_type, status: r.status, matchedBy: 'document', matchedNo: r.no, exact: r.no.toUpperCase() === text.toUpperCase() });
    }

    const batches: Array<{ batch_no: string; txn_no: string; txn_type: TxnType; status: TxnStatus }> = await this.manager.query(
      `SELECT DISTINCT b.batch_no, t.txn_no, t.txn_type, t.status
         FROM stock_batch b JOIN transactions t ON t.txn_no = b.origin_txn_no
        WHERE b.origin_txn_no IS NOT NULL AND b.batch_no ILIKE $1
        LIMIT 20`,
      [like],
    );
    for (const r of batches) hits.push({ txnNo: r.txn_no, type: r.txn_type, status: r.status, matchedBy: 'batch', matchedNo: r.batch_no, exact: r.batch_no.toUpperCase() === text.toUpperCase() });

    const seen = new Set<string>();
    return hits
      .sort((a, b) => Number(b.exact) - Number(a.exact))
      .filter((h) => {
        const key = `${h.txnNo}|${h.matchedBy}|${h.matchedNo}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20)
      .map(({ exact, ...hit }) => hit);
  }

  // ─── Detail ────────────────────────────────────────────────────────────────

  private normalise(txnNo: string): string {
    const parsed = parseTxnNo(txnNo);
    if (!parsed) throw new AppError(400, 'Not a transaction number');
    return txnNo.trim().toUpperCase();
  }

  private async listRowOf(txnNo: string): Promise<TxnListRow | null> {
    const rows: ListSqlRow[] = await this.manager.query(`${LIST_SELECT} WHERE t.txn_no = $1`, [txnNo]);
    return rows[0] ? toListRow(rows[0]) : null;
  }

  async detail(rawTxnNo: string): Promise<TxnDetail> {
    const txnNo = this.normalise(rawTxnNo);
    const m = this.manager;
    let evaluation = await evaluateTransaction(m, txnNo);
    if (!evaluation) throw new AppError(404, `Transaction ${txnNo} not found`);
    // Self-heal a stale cache (a refresh that was missed); refresh never throws.
    const { cached, result } = evaluation;
    if (cached.status !== result.status || cached.stage !== result.stage || cached.stageLabel !== result.stageLabel) {
      await refreshTransaction(m, txnNo);
    }
    const header = await this.listRowOf(txnNo);
    if (!header) throw new AppError(404, `Transaction ${txnNo} not found`);
    const { txn, docs, summary } = evaluation;

    const [quantities, money, related, links] = [
      await this.quantitiesOf(m, txn.txnType, txn.originDocId, docs),
      await this.moneyOf(m, txn.txnType, txn.originDocId, docs),
      await this.relatedOf(m, txn.txnType, txn.originDocId, docs),
      await this.linksOf(m, txnNo),
    ];

    return {
      ...header,
      status: result.status,
      stage: result.stage,
      stageLabel: result.stageLabel,
      productCount: summary.productCount,
      totalQty: summary.totalQty,
      totalKg: summary.totalKg,
      totalValue: summary.totalValue,
      steps: result.steps,
      documents: docs.map((d) => ({
        docType: d.docType,
        docTypeLabel: TXN_DOC_TYPES[d.docType].label,
        id: d.id,
        docNo: d.docNo,
        documentId: d.documentId,
        status: d.deleted ? 'Deleted' : d.status,
        step: d.step,
        createdAt: iso(d.createdAt) ?? '',
        createdBy: d.createdBy,
      })),
      related,
      quantityColumns: QUANTITY_COLUMNS[txn.txnType],
      quantities,
      money,
      links,
    };
  }

  private async receivingProducts(m: EntityManager, type: ReceivingSourceType, id: string): Promise<ReceivingProductRow[] | null> {
    try {
      return (await new ReceivingStatusService(m.connection).getSourceStatus(type, id, m)).products;
    } catch {
      return null;
    }
  }

  private async itemLines(m: EntityManager, dcId: string): Promise<LineSqlRow[]> {
    const itemDc = fkColumn(m, Item, 'deliveryChallan');
    return m.query(
      `SELECT it.product_id::text AS product_id, p.product_name, it.varient_id::text AS variant_id, v."variantName" AS variant_name,
              COALESCE(su.unit, u.unit) AS uom_name, it.quantity AS qty, it."netWeight" AS kg
         FROM item it
         LEFT JOIN product p ON p.id = it.product_id
         LEFT JOIN "productVarient" v ON v.id = it.varient_id
         LEFT JOIN uom su ON su.id = it.saleuom_id
         LEFT JOIN uom u ON u.id = it.uom_id
        WHERE it.${itemDc} = $1 AND it."deletedAt" IS NULL`,
      [dcId],
    );
  }

  private async quantitiesOf(m: EntityManager, type: TxnType, originId: string, docs: DocFact[]): Promise<TxnQuantityRow[]> {
    const table = new QuantityTable(QUANTITY_COLUMNS[type].map((c) => c.key));
    const fromReceiving = (rows: ReceivingProductRow[], firstKey: 'grn' | 'sent') => {
      for (const p of rows) {
        table.add(p, firstKey, p.receivedKg);
        table.add(p, 'dispatched', p.dispatchedKg ?? null);
        table.add(p, 'arrived', p.arrivedKg);
        table.add(p, 'inward', p.inwardKg);
        table.add(p, 'dump', p.dumpKg);
        if (firstKey === 'grn') table.add(p, 'rtv', p.rtvKg);
        table.add(p, 'loss', p.transitLossKg);
      }
    };

    if (type === 'purchase') {
      const grn = pickDoc(docs, 'grn');
      if (!grn) return [];
      const products = await this.receivingProducts(m, 'grn', grn.id);
      if (products) {
        fromReceiving(products, 'grn');
      } else {
        // Direct-to-customer GRN (no receiving): GRN lines only.
        const lines: LineSqlRow[] = await m.query(
          `SELECT gp.product_id::text AS product_id, p.product_name, gp.varient_id::text AS variant_id, v."variantName" AS variant_name,
                  u.unit AS uom_name, gp.quantity AS qty, gp."netWeight" AS kg
             FROM grn_products gp
             LEFT JOIN product p ON p.id = gp.product_id
             LEFT JOIN "productVarient" v ON v.id = gp.varient_id
             LEFT JOIN uom u ON u.id = gp.uom_id
            WHERE gp.grn_id = $1 AND gp."deletedAt" IS NULL`,
          [grn.id],
        );
        for (const l of lines) table.add(this.lineRef(l), 'grn', num(l.kg));
      }
    } else if (type === 'transfer') {
      const products = await this.receivingProducts(m, 'stock-transfer-dc', originId);
      if (products) fromReceiving(products, 'sent');
      else for (const l of await this.itemLines(m, originId)) table.add(this.lineRef(l), 'sent', num(l.kg));
    } else if (type === 'sale') {
      for (const l of await this.itemLines(m, originId)) table.add(this.lineRef(l), 'delivered', num(l.qty));
      const rbc = pickDoc(docs, 'return');
      if (rbc && isLiveDoc(rbc)) {
        const rbcFk = fkColumn(m, ReturnedProducts, 'postReturn');
        const lines: LineSqlRow[] = await m.query(
          `SELECT rp.product_id::text AS product_id, p.product_name, rp.varient_id::text AS variant_id, v."variantName" AS variant_name,
                  u.unit AS uom_name, rp."returnedQty" AS qty, rp."returnedNetWt" AS kg
             FROM returned_products_by_customer rp
             LEFT JOIN product p ON p.id = rp.product_id
             LEFT JOIN "productVarient" v ON v.id = rp.varient_id
             LEFT JOIN uom u ON u.id = rp.saleuom_id
            WHERE rp.${rbcFk} = $1 AND rp."deletedAt" IS NULL`,
          [rbc.id],
        );
        for (const l of lines) table.add(this.lineRef(l), 'returned', num(l.qty));
      }
      const invoice = pickDoc(docs, 'invoice');
      if (invoice && isLiveDoc(invoice)) {
        const lines: LineSqlRow[] = await m.query(
          `SELECT ip.product_id::text AS product_id, p.product_name, ip.varient_id::text AS variant_id, v."variantName" AS variant_name,
                  u.unit AS uom_name, ip.quantity AS qty, ip."netWeight" AS kg
             FROM invoice_products ip
             LEFT JOIN product p ON p.id = ip.product_id
             LEFT JOIN "productVarient" v ON v.id = ip.varient_id
             LEFT JOIN uom u ON u.id = ip.saleuom_id
            WHERE ip.invoice_id = $1 AND ip."deletedAt" IS NULL`,
          [invoice.id],
        );
        for (const l of lines) table.add(this.lineRef(l), 'invoiced', num(l.qty));
      }
    } else if (type === 'other-sale') {
      for (const l of await this.itemLines(m, originId)) table.add(this.lineRef(l), 'sold', num(l.qty));
    } else {
      const lines: LineSqlRow[] = await m.query(
        `SELECT sp.product_id::text AS product_id, p.product_name, sp.varient_id::text AS variant_id, v."variantName" AS variant_name,
                u.unit AS uom_name, sp.quantity AS qty, sp."netWeight" AS kg
           FROM second_sale_product sp
           LEFT JOIN product p ON p.id = sp.product_id
           LEFT JOIN "productVarient" v ON v.id = sp.varient_id
           LEFT JOIN uom u ON u.id = sp.saleuom_id
          WHERE sp.second_sale_register_id = $1 AND sp."deletedAt" IS NULL`,
        [originId],
      );
      for (const l of lines) table.add(this.lineRef(l), 'sold', num(l.qty));
    }
    return table.list();
  }

  private lineRef(l: LineSqlRow) {
    return { productId: l.product_id, productName: l.product_name, variantId: l.variant_id, variantName: l.variant_name, uomName: l.uom_name };
  }

  private async voucherRows(m: EntityManager, grnId: string): Promise<TxnRelatedRow[]> {
    const related: TxnRelatedRow[] = [];
    for (const v of VOUCHERS) {
      const rows: Array<{ no: string | null; amount: string | null; created_at: Date | null; status: string | null; document_id: string | null }> = await m.query(
        `SELECT h."voucherNo" AS no, h.${ident(v.amountColumn)} AS amount, h."createdAt" AS created_at,
                d.status::text AS status, d.id::text AS document_id
           FROM ${ident(v.table)} h
           LEFT JOIN LATERAL (SELECT dd.id, dd.status FROM documents dd
                               WHERE dd.document_type_id = h.id::text AND dd.type::text = $2 AND dd."deletedAt" IS NULL
                               ORDER BY dd."createdAt" DESC LIMIT 1) d ON true
          WHERE h.grn_id = $1 AND COALESCE(h."isDeleted", false) = false AND h."deletedAt" IS NULL
          ORDER BY h."createdAt"`,
        [grnId, v.type],
      );
      for (const r of rows) {
        related.push({ kind: 'voucher', label: v.label, no: r.no, amount: numOrNull(r.amount), date: iso(r.created_at), status: r.status, documentId: r.document_id });
      }
    }
    return related;
  }

  private async paymentRows(m: EntityManager, kind: 'grn-payment' | 'invoice-payment', parentId: string): Promise<TxnRelatedRow[]> {
    const table = kind === 'grn-payment' ? 'grn_payments' : 'invoice_payments';
    const fk = kind === 'grn-payment' ? 'grn_id' : 'invoice_id';
    const rows: Array<{ payment_no: number; payment_mode: string | null; reference_no: string | null; amount: string; payment_date: unknown; payment_type: string | null }> =
      await m.query(
        `SELECT payment_no, payment_mode, reference_no, amount, payment_date, payment_type
           FROM ${table} WHERE ${fk} = $1 AND voided_at IS NULL AND "deletedAt" IS NULL ORDER BY payment_no`,
        [parentId],
      );
    // Stored lower case ('neft', 'partial'); shown like everywhere else (NEFT, Partial)
    const title = (v: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);
    const modeLabel = (v: string) => (['neft', 'rtgs', 'upi'].includes(v.toLowerCase()) ? v.toUpperCase() : title(v));
    return rows.map((r) => ({
      kind,
      label: `Payment ${r.payment_no}${r.payment_mode ? ` (${modeLabel(r.payment_mode)})` : ''}`,
      no: r.reference_no,
      amount: num(r.amount),
      date: dateOnly(r.payment_date),
      status: title(r.payment_type),
      documentId: null,
    }));
  }

  private async relatedOf(m: EntityManager, type: TxnType, originId: string, docs: DocFact[]): Promise<TxnRelatedRow[]> {
    const related: TxnRelatedRow[] = [];
    if (type === 'purchase') {
      const grn = pickDoc(docs, 'grn');
      if (grn) {
        related.push(...(await this.voucherRows(m, grn.id)));
        related.push(...(await this.paymentRows(m, 'grn-payment', grn.id)));
      }
    }
    if (type === 'sale') {
      const confirmations: Array<{ outcome: string; rbc_no: string | null; confirmed_at: Date }> = await m.query(
        `SELECT outcome, rbc_no, confirmed_at FROM dc_delivery_confirmation WHERE dc_id = $1 AND undone_at IS NULL ORDER BY confirmed_at DESC LIMIT 1`,
        [originId],
      );
      for (const c of confirmations) {
        related.push({
          kind: 'delivery-confirmation',
          label: c.outcome === 'Delivered With Return' ? 'Delivered – with return' : 'Delivered – no return',
          no: c.rbc_no,
          amount: null,
          date: iso(c.confirmed_at),
          status: 'confirmed',
          documentId: null,
        });
      }
      const invoice = pickDoc(docs, 'invoice');
      if (invoice && isLiveDoc(invoice)) related.push(...(await this.paymentRows(m, 'invoice-payment', invoice.id)));
    }
    return related;
  }

  private async moneyOf(m: EntityManager, type: TxnType, originId: string, docs: DocFact[]): Promise<{ label: string; amount: number }[]> {
    if (type === 'purchase') {
      const grn = pickDoc(docs, 'grn');
      if (!grn) return [];
      const rows: Array<{ total: string | null; paid: string | null }> = await m.query(
        `SELECT "totalAmt" AS total, paid_amount AS paid FROM grns WHERE id = $1`,
        [grn.id],
      );
      const total = round2(num(rows[0]?.total));
      const paid = round2(num(rows[0]?.paid));
      const vouchers = (await this.voucherRows(m, grn.id))
        .filter((v) => v.status !== DocumentStatus.REJECT)
        .reduce((s, v) => s + num(v.amount), 0);
      return [
        { label: 'GRN amount', amount: total },
        { label: 'Vouchers', amount: round2(vouchers) },
        { label: 'Paid', amount: paid },
        { label: 'Pending', amount: round2(Math.max(total - paid, 0)) },
      ];
    }
    if (type === 'sale') {
      const invoice = pickDoc(docs, 'invoice');
      const dc: Array<{ total: string | null }> = await m.query(`SELECT "totalProductAmount" AS total FROM delivery_challan_purchase WHERE id = $1`, [originId]);
      const money = [{ label: 'DC amount', amount: round2(num(dc[0]?.total)) }];
      if (invoice && isLiveDoc(invoice)) {
        const rows: Array<{ total: string | null; paid: string | null }> = await m.query(
          `SELECT "totalAmount" AS total, paid_amount AS paid FROM invoices WHERE id = $1`,
          [invoice.id],
        );
        const total = round2(num(rows[0]?.total));
        const paid = round2(num(rows[0]?.paid));
        money.push({ label: 'Invoice amount', amount: total }, { label: 'Paid', amount: paid }, { label: 'Pending', amount: round2(Math.max(total - paid, 0)) });
      }
      return money;
    }
    if (type === 'second-sale') {
      const rows: Array<{ total: string | null; paid: string | null }> = await m.query(
        `SELECT "totalAmt" AS total, "paidAmount" AS paid FROM second_sale_document WHERE id = $1`,
        [originId],
      );
      const total = round2(num(rows[0]?.total));
      const paid = round2(num(rows[0]?.paid));
      return [
        { label: 'Second sale amount', amount: total },
        { label: 'Paid', amount: paid },
        { label: 'Pending', amount: round2(Math.max(total - paid, 0)) },
      ];
    }
    const rows: Array<{ total: string | null }> = await m.query(`SELECT "totalProductAmount" AS total FROM delivery_challan_purchase WHERE id = $1`, [originId]);
    return [{ label: type === 'transfer' ? 'Transfer value' : 'DC amount', amount: round2(num(rows[0]?.total)) }];
  }

  private async linksOf(m: EntityManager, txnNo: string): Promise<TxnLinkRow[]> {
    const rows: Array<{ direction: 'from' | 'to'; kind: string; other: string; txn_type: TxnType; batch_no: string; qty: string; net_kg: string }> = await m.query(
      `SELECT CASE WHEN l.to_txn = $1 THEN 'from' ELSE 'to' END AS direction, l.kind,
              CASE WHEN l.to_txn = $1 THEN l.from_txn ELSE l.to_txn END AS other,
              t.txn_type, l.batch_no, l.qty, l.net_kg
         FROM transaction_links l
         JOIN transactions t ON t.txn_no = CASE WHEN l.to_txn = $1 THEN l.from_txn ELSE l.to_txn END
        WHERE l.from_txn = $1 OR l.to_txn = $1
        ORDER BY direction, l.created_at`,
      [txnNo],
    );
    return rows.map((r) => ({
      direction: r.direction,
      kind: r.kind,
      txnNo: r.other,
      type: r.txn_type,
      batchNo: r.batch_no || null,
      qty: round3(num(r.qty)),
      netKg: round3(num(r.net_kg)),
    }));
  }

  // ─── Ledger ────────────────────────────────────────────────────────────────

  async ledger(rawTxnNo: string): Promise<TxnLedgerRow[]> {
    const txnNo = this.normalise(rawTxnNo);
    const exists: Array<{ n: string }> = await this.manager.query(`SELECT COUNT(*) AS n FROM transactions WHERE txn_no = $1`, [txnNo]);
    if (!num(exists[0]?.n)) throw new AppError(404, `Transaction ${txnNo} not found`);
    const rows: Array<{
      posted_at: Date; movement_type: string; doc_type: string; doc_no: string | null; batch_no: string; location_name: string | null;
      product_name: string | null; variant_name: string | null; uom_name: string | null;
      qty_in: string; qty_out: string; kg_in: string; kg_out: string; value_in: string; value_out: string;
    }> = await this.manager.query(
      `SELECT sl.posted_at, sl.movement_type, sl.doc_type, sl.doc_no, sl.batch_no, b.name AS location_name,
              p.product_name, v."variantName" AS variant_name, u.unit AS uom_name,
              sl.qty_in, sl.qty_out, sl.kg_in, sl.kg_out, sl.value_in, sl.value_out
         FROM stock_ledger sl
         LEFT JOIN branches b ON b.id = sl.location_id
         LEFT JOIN product p ON p.id = sl.product_id
         LEFT JOIN "productVarient" v ON v.id = sl.variant_id
         LEFT JOIN uom u ON u.id = sl.uom_id
        WHERE sl.txn_no = $1
        ORDER BY sl.posted_at, sl.id`,
      [txnNo],
    );
    return rows.map((r) => ({
      postedAt: iso(r.posted_at) ?? '',
      movementType: r.movement_type,
      docType: r.doc_type,
      docNo: r.doc_no,
      batchNo: r.batch_no,
      locationName: r.location_name,
      productName: r.product_name,
      variantName: r.variant_name,
      uomName: r.uom_name,
      qtyIn: num(r.qty_in),
      qtyOut: num(r.qty_out),
      netKgIn: num(r.kg_in),
      netKgOut: num(r.kg_out),
      // Signed: value in minus value out.
      value: round2(num(r.value_in) - num(r.value_out)),
    }));
  }

  // ─── Request parsing ───────────────────────────────────────────────────────

  /** Validated list filter from the query string (400 on a bad value). */
  static parseFilter(query: Record<string, unknown>): TxnListFilter {
    const first = (v: unknown): string | undefined => {
      const value = Array.isArray(v) ? v[0] : v;
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };
    const many = (v: unknown): string[] =>
      (Array.isArray(v) ? v : [v]).flatMap((x) => (typeof x === 'string' ? x.split(',') : [])).map((s) => s.trim()).filter(Boolean);

    const types = many(query.type);
    const badType = types.find((t) => !TXN_TYPES.includes(t as TxnType));
    if (badType) throw new AppError(400, `type must be one or more of ${TXN_TYPES.join(', ')}`);
    const statuses = many(query.status);
    const badStatus = statuses.find((s) => !TXN_STATUSES.includes(s as TxnStatus));
    if (badStatus) throw new AppError(400, `status must be one or more of ${TXN_STATUSES.join(', ')}`);
    const stages = many(query.stage).filter((s) => /^[a-z-]{1,40}$/.test(s));
    const companyId = first(query.companyId);
    const locationId = first(query.locationId);
    if (companyId && !isUuid(companyId)) throw new AppError(400, 'companyId must be a uuid');
    if (locationId && !isUuid(locationId)) throw new AppError(400, 'locationId must be a uuid');
    const startDate = first(query.startDate);
    const endDate = first(query.endDate);
    if (startDate && !DATE_ONLY.test(startDate)) throw new AppError(400, 'startDate must be YYYY-MM-DD');
    if (endDate && !DATE_ONLY.test(endDate)) throw new AppError(400, 'endDate must be YYYY-MM-DD');
    const page = Number(first(query.page) ?? 1);
    const limit = Number(first(query.limit) ?? 10);
    return {
      page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 10,
      search: first(query.search)?.slice(0, 100),
      sort: first(query.sort),
      types: types as TxnType[],
      statuses: statuses as TxnStatus[],
      stages,
      companyId,
      locationId,
      startDate,
      endDate,
    };
  }
}
