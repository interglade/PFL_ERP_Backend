import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { CacheService } from '../../global/cache.service';
import { TYPES } from '../../types';
import { OverviewTab } from '../adminControlCenter.types';
import { docLabel, refKey, resolveDocRefs } from './accApprovalStage';
import { loadPeople } from './accPeople';
import {
  buildSeries,
  cacheKey,
  cachedTab,
  completeDoc,
  dcLineKg,
  earliestStart,
  fromSqlText,
  nowIst,
  num,
  pctChange,
  round2,
  sqlTs,
  timeLabel,
  tsText,
  unpaid,
} from './accShared.util';

const TREND_METRICS = ['purchaseQty', 'salesQty', 'purchaseAmount', 'salesAmount'] as const;
const ACTIVITY_LIMIT = 10;

/** Activity-log modules that belong in recent activity, with their labels. */
const LOG_MODULE_LABELS: Record<string, string> = {
  GRN: 'GRN',
  INVOICE: 'Final Invoice',
  RFPA: 'RFPA',
  DEAL_SLIP: 'Deal Slip',
  AQR: 'AQR',
  INWARD_REGISTER: 'Inward Register',
  DUMP_REGISTER: 'Dump Register',
  VEHICAL_DISPATCH: 'Vehicle Dispatch Register',
  SECOND_SALE: 'Second Sales Register',
  SECOND_SALES: 'Second Sales Register',
  RETURN_TO_VENDOR: 'RTV',
  RETURN_BY_CUSTOMER: 'RBC',
  CUSTOMER_DELIVERY_CHALLAN: 'DC for Customer',
  STOCK_TRANSFER_DELIVERY_CHALLAN: 'DC for Stock Transfer',
  OTHER_DELIVERY_CHALLAN: 'DC for Other',
  MULTI_CASH_VOUCHER: 'Multicash Voucher',
  LABOUR_PAYMENT: 'Labor Payment Voucher',
  TRANSPORT_PAYMENT: 'Transport Payment Voucher',
  PMP_VOUCHER: 'Packing Material Voucher',
  EOD_STOCK: 'EOD Report',
  CUSTOMER: 'Customer Registration',
  VENDOR: 'Vendor Registration',
};

/** Activity-log module → documents.type, to look the document number up by entityId. */
const LOG_MODULE_DOC_TYPE: Record<string, string> = {
  GRN: 'grn',
  INVOICE: 'final-invoice',
  RFPA: 'rfpa',
  DEAL_SLIP: 'deal-slip',
  AQR: 'aqr',
  INWARD_REGISTER: 'inward-register',
  DUMP_REGISTER: 'dump-register',
  VEHICAL_DISPATCH: 'vehicle-dispatch-register',
  SECOND_SALE: 'second-sale',
  SECOND_SALES: 'second-sale',
  RETURN_TO_VENDOR: 'return-to-vendor',
  RETURN_BY_CUSTOMER: 'return-by-customer',
  CUSTOMER_DELIVERY_CHALLAN: 'DC_TYPE_CUSTOMER',
  STOCK_TRANSFER_DELIVERY_CHALLAN: 'DC_TYPE_STOCK_TRANSFER',
  OTHER_DELIVERY_CHALLAN: 'DC_TYPE_OTHER',
  MULTI_CASH_VOUCHER: 'multi-cash-voucher',
  LABOUR_PAYMENT: 'labor-payment-voucher',
  TRANSPORT_PAYMENT: 'transport-payment-voucher',
  PMP_VOUCHER: 'packaging-material-voucher',
};

/** Registration code lookups for customer / vendor / farmer log rows. */
const REGISTRATION_REF_SQL: Record<string, string> = {
  CUSTOMER: `SELECT id::text AS id, COALESCE(NULLIF(customercode, ''), organisation_name) AS ref FROM customers WHERE id = ANY($1::uuid[])`,
  VENDOR: `SELECT id::text AS id, COALESCE(NULLIF(vendor_code, ''), company_name) AS ref FROM vendor WHERE id = ANY($1::uuid[])`,
  OTHER: `SELECT id::text AS id, COALESCE(NULLIF("farmerCode", ''), concat_ws(' ', "farmerfName", "farmerlName")) AS ref FROM farmer WHERE id = ANY($1::uuid[])`,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Activity {
  id: string;
  ts: string; // IST text, sortable
  user: string;
  action: string;
  reference: string;
}

/**
 * SQL for finished GRNs with their kg and amount. `extraWhere` narrows it
 * further (date range, location, company) and is shared with the Purchase tab.
 */
export function completedGrnsSql(extraWhere = ''): string {
  return `
    SELECT g.id, g."createdAt" AS ts, COALESCE(g."totalAmt", 0) AS amt, (${unpaid('g')}) AS unpaid,
           g.source::text AS source, g.farmer_id, g.vendor_id, g.company_id, g.branch_id,
           (SELECT COALESCE(SUM(gp."netWeight"), 0) FROM grn_products gp
             WHERE gp.grn_id = g.id AND gp."isDeleted" = false) AS qty
      FROM grns g
     WHERE g."isDeleted" = false AND ${completeDoc('g', 'grn')} ${extraWhere}`;
}

/**
 * SQL for approved final invoices with their amount and the ACCEPTED kg of
 * the delivery challan they were raised on. Dated by invoiceDate.
 */
export function completedInvoicesSql(extraWhere = ''): string {
  const kg = dcLineKg('it');
  return `
    SELECT i.id, COALESCE(i."invoiceDate"::timestamp, i."createdAt") AS ts, COALESCE(i."totalAmount", 0) AS amt,
           (${unpaid('i')}) AS unpaid, i.customer_id, i.company_id, i.branch_id, i.delivery_challan_id,
           (SELECT COALESCE(SUM(${kg.accepted}), 0) FROM item it
             WHERE it."deliveryChallanId" = i.delivery_challan_id AND it."isDeleted" = false) AS qty
      FROM invoices i
     WHERE i."isDeleted" = false AND ${completeDoc('i', 'final-invoice')} ${extraWhere}`;
}

@injectable()
export class AccOverviewService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {}

  getOverview(refresh: boolean) {
    return cachedTab(this.cacheService, cacheKey('overview'), refresh, () => this.compute());
  }

  private async compute(): Promise<OverviewTab> {
    const now = nowIst();
    const thisMonth = sqlTs(now.clone().startOf('month'));
    const lastMonth = sqlTs(now.clone().subtract(1, 'month').startOf('month'));
    const trendStart = sqlTs(earliestStart(['this-month', 'last-month', 'this-year'], now));

    const [purchase, sales, stockWaste, purchaseDaily, salesDaily, recentActivity] = await Promise.all([
      this.totals(completedGrnsSql(), thisMonth, lastMonth),
      this.totals(completedInvoicesSql(), thisMonth, lastMonth),
      this.stockAndWastage(thisMonth, lastMonth),
      this.daily(completedGrnsSql(`AND g."createdAt" >= $1::timestamp`), trendStart, 'purchase'),
      this.daily(
        completedInvoicesSql(`AND COALESCE(i."invoiceDate"::timestamp, i."createdAt") >= $1::timestamp`),
        trendStart,
        'sales',
      ),
      this.recentActivity(),
    ]);

    const dailyRows = [...purchaseDaily, ...salesDaily];
    const trend = (period: 'this-month' | 'last-month' | 'this-year') =>
      buildSeries(period, dailyRows, TREND_METRICS, now);

    return {
      totals: {
        purchaseQty: purchase.qty,
        purchaseAmount: purchase.amount,
        purchaseChange: pctChange(purchase.amountThisMonth, purchase.amountLastMonth),
        salesQty: sales.qty,
        salesAmount: sales.amount,
        salesChange: pctChange(sales.amountThisMonth, sales.amountLastMonth),
        stockQty: stockWaste.stockQty,
        wastageQty: stockWaste.wastageTotal,
        wastageChange: pctChange(stockWaste.wastageThisMonth, stockWaste.wastageLastMonth),
        payableAmount: purchase.unpaidAmount,
        payableCount: purchase.unpaidCount,
        receivableAmount: sales.unpaidAmount,
        receivableCount: sales.unpaidCount,
      },
      trends: {
        'this-month': trend('this-month'),
        'last-month': trend('last-month'),
        'this-year': trend('this-year'),
      },
      recentActivity,
    };
  }

  /**
   * Till-now totals plus this-month / last-month amounts and unpaid figures.
   * Qty and amounts count paid documents only.
   */
  private async totals(docsSql: string, thisMonth: string, lastMonth: string) {
    const [row] = await this.dataSource.query(
      `WITH docs AS (${docsSql})
       SELECT COALESCE(SUM(qty) FILTER (WHERE NOT unpaid), 0) AS qty,
              COALESCE(SUM(amt) FILTER (WHERE NOT unpaid), 0) AS amount,
              COALESCE(SUM(amt) FILTER (WHERE NOT unpaid AND ts >= $1::timestamp), 0) AS "amountThisMonth",
              COALESCE(SUM(amt) FILTER (WHERE NOT unpaid AND ts >= $2::timestamp AND ts < $1::timestamp), 0) AS "amountLastMonth",
              COALESCE(SUM(amt) FILTER (WHERE unpaid), 0) AS "unpaidAmount",
              COUNT(*) FILTER (WHERE unpaid)::int AS "unpaidCount"
         FROM docs`,
      [thisMonth, lastMonth],
    );
    return {
      qty: round2(num(row?.qty)),
      amount: round2(num(row?.amount)),
      amountThisMonth: num(row?.amountThisMonth),
      amountLastMonth: num(row?.amountLastMonth),
      unpaidAmount: round2(num(row?.unpaidAmount)),
      unpaidCount: row?.unpaidCount ?? 0,
    };
  }

  /** Daily trend points, counting paid documents only. */
  private async daily(docsSql: string, start: string, prefix: 'purchase' | 'sales') {
    const rows: any[] = await this.dataSource.query(
      `WITH docs AS (${docsSql})
       SELECT to_char(ts, 'YYYY-MM-DD') AS day, SUM(qty) AS qty, SUM(amt) AS amt
         FROM docs WHERE NOT unpaid GROUP BY 1`,
      [start],
    );
    return rows.map((r) => ({
      day: r.day,
      [`${prefix}Qty`]: num(r.qty),
      [`${prefix}Amount`]: num(r.amt),
    }));
  }

  /**
   * Current stock across every location and company, and approved dump
   * quantity: till-now total plus this-month / last-month for the change.
   */
  private async stockAndWastage(thisMonth: string, lastMonth: string) {
    const [row] = await this.dataSource.query(
      `WITH dumps AS (
         SELECT COALESCE(d.date::timestamp, d."createdAt") AS ts,
                (SELECT COALESCE(SUM(p.quantity), 0) FROM dump_product p
                  WHERE p.dump_register_id = d.id AND p."isDeleted" = false) AS qty
           FROM dump_register d
          WHERE d."isDeleted" = false AND ${completeDoc('d', 'dump-register')}
       )
       SELECT (SELECT COALESCE(SUM("inwardQty"), 0) FROM inventory_stock WHERE "isDeleted" = false) AS "stockQty",
              (SELECT COALESCE(SUM(qty), 0) FROM dumps) AS "wastageTotal",
              (SELECT COALESCE(SUM(qty), 0) FROM dumps WHERE ts >= $1::timestamp) AS "wastageThisMonth",
              (SELECT COALESCE(SUM(qty), 0) FROM dumps WHERE ts >= $2::timestamp AND ts < $1::timestamp) AS "wastageLastMonth"`,
      [thisMonth, lastMonth],
    );
    return {
      stockQty: round2(num(row?.stockQty)),
      wastageTotal: round2(num(row?.wastageTotal)),
      wastageThisMonth: round2(num(row?.wastageThisMonth)),
      wastageLastMonth: round2(num(row?.wastageLastMonth)),
    };
  }

  // ─── Recent activity ───────────────────────────────────────────────────────

  /**
   * Latest actions across the application, merged from three sources:
   * creations and payment updates (activity log), verify / approve / finalize /
   * reject decisions (approval slots), and registration approvals.
   */
  private async recentActivity(): Promise<OverviewTab['recentActivity']> {
    const [logs, decisions, registrations] = await Promise.all([
      this.logActivities(),
      this.approvalActivities(),
      this.registrationActivities(),
    ]);
    return [...logs, ...decisions, ...registrations]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, ACTIVITY_LIMIT)
      .map((a) => ({
        id: a.id,
        time: timeLabel(fromSqlText(a.ts)),
        user: a.user,
        action: a.action,
        reference: a.reference,
      }));
  }

  private async logActivities(): Promise<Activity[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT l.id::text AS id, ${tsText('l."createdAt"')} AS ts, l."userName", l.action::text AS action,
              l.module::text AS module, l."entityName", l."entityId", l.description,
              l.metadata->>'ammountStatus' AS "payStatus"
         FROM user_activity_logs l
        WHERE l."isError" = false
          AND (l.action::text = 'CREATE'
               OR (l.action::text = 'UPDATE' AND l.metadata->>'event' = 'amount-status'))
          AND (l.module::text = ANY($1) OR (l.module::text = 'OTHER' AND l."entityName" = 'Farmer'))
          -- Customer categories and types are logged under the CUSTOMER module too; they are master data.
          AND COALESCE(l."entityName", '') NOT IN ('CustomerCategory', 'CustomerType')
        ORDER BY l."createdAt" DESC
        LIMIT ${ACTIVITY_LIMIT}`,
      [Object.keys(LOG_MODULE_LABELS)],
    );

    // Document / registration numbers, looked up by the logged record id.
    const docRefs = await resolveDocRefs(
      this.dataSource,
      rows
        .filter((r) => LOG_MODULE_DOC_TYPE[r.module])
        .map((r) => ({ type: LOG_MODULE_DOC_TYPE[r.module], id: r.entityId })),
    );
    const regRefs = new Map<string, string>();
    await Promise.all(
      Object.entries(REGISTRATION_REF_SQL).map(async ([module, sql]) => {
        const ids = rows
          .filter((r) => r.module === module && UUID_RE.test(r.entityId || ''))
          .map((r) => r.entityId);
        if (ids.length === 0) return;
        const found: any[] = await this.dataSource.query(sql, [ids]);
        for (const f of found) regRefs.set(`${module}:${f.id}`, f.ref || '');
      }),
    );
    const referenceOf = (r: any) =>
      (LOG_MODULE_DOC_TYPE[r.module]
        ? docRefs.get(refKey(LOG_MODULE_DOC_TYPE[r.module], r.entityId))?.docNo
        : regRefs.get(`${r.module}:${r.entityId}`)) || referenceFromDescription(r.description);

    return rows.map((r) => {
      const label = r.module === 'OTHER' ? 'Farmer Registration' : LOG_MODULE_LABELS[r.module];
      const action =
        r.action === 'UPDATE'
          ? `marked ${label} as ${r.payStatus === 'paid' ? 'Paid' : 'Unpaid'}`
          : `created ${label}`;
      return {
        id: `log:${r.id}`,
        ts: r.ts,
        user: r.userName || '',
        action,
        reference: referenceOf(r),
      };
    });
  }

  private async approvalActivities(): Promise<Activity[]> {
    const rows: any[] = await this.dataSource.query(
      `WITH recent AS (
         SELECT s.id, s."userName", s.status::text AS status, s."statusChangedAt"
           FROM approval_stage_info s
          WHERE s."statusChangedAt" IS NOT NULL AND s.status::text NOT IN ('hold', 'unverified')
          ORDER BY s."statusChangedAt" DESC
          LIMIT ${ACTIVITY_LIMIT * 3}
       )
       SELECT r.id::text AS id, ${tsText('r."statusChangedAt"')} AS ts, r."userName", r.status,
              CASE WHEN r.id = w.verified_id THEN 'verified'
                   WHEN r.id IN (w.first_finalized_id, w.second_finalized_id) THEN 'finalized'
                   ELSE 'approved' END AS verb,
              d.type::text AS type, d.document_type_id AS "moduleId"
         FROM recent r
         JOIN documents_approve_by_whom w
           ON r.id IN (w.verified_id, w.first_approved_id, w.second_approved_id, w.third_approved_id,
                       w.first_finalized_id, w.second_finalized_id)
         JOIN documents d ON d.approval_info_id = w.id AND d."isDeleted" = false
        ORDER BY r."statusChangedAt" DESC
        LIMIT ${ACTIVITY_LIMIT}`,
    );
    const refs = await resolveDocRefs(
      this.dataSource,
      rows.map((r) => ({ type: r.type, id: r.moduleId })),
    );

    return rows.map((r) => ({
      id: `stage:${r.id}`,
      ts: r.ts,
      user: r.userName || '',
      action: `${r.status === 'reject' ? 'rejected' : r.verb} ${docLabel(r.type)}`,
      reference: refs.get(refKey(r.type, r.moduleId))?.docNo || '',
    }));
  }

  /**
   * Registrations carry no decision timestamp, so updatedAt of an approved or
   * rejected registration stands in for when the verifier acted.
   */
  private async registrationActivities(): Promise<Activity[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT * FROM (
         SELECT 'Farmer Registration' AS label, id::text AS id, ${tsText('"updatedAt"')} AS ts,
                status::text AS status, approved_by::text AS "userId",
                COALESCE(NULLIF("farmerCode", ''), concat_ws(' ', "farmerfName", "farmerlName")) AS reference
           FROM farmer WHERE "isDeleted" = false AND approved_by IS NOT NULL AND status::text IN ('approved', 'notapproved')
         UNION ALL
         SELECT 'Vendor Registration', id::text, ${tsText('"updatedAt"')}, status::text, approved_by::text,
                COALESCE(NULLIF(vendor_code, ''), company_name)
           FROM vendor WHERE "isDeleted" = false AND approved_by IS NOT NULL AND status::text IN ('approved', 'notapproved')
         UNION ALL
         SELECT 'Customer Registration', id::text, ${tsText('"updatedAt"')}, status::text, approved_by::text,
                COALESCE(NULLIF(customercode, ''), organisation_name)
           FROM customers WHERE "isDeleted" = false AND approved_by IS NOT NULL AND status::text IN ('approved', 'notapproved')
       ) x
       ORDER BY ts DESC
       LIMIT ${ACTIVITY_LIMIT}`,
    );
    const people = await loadPeople(this.dataSource, rows.map((r) => r.userId));

    return rows.map((r) => ({
      id: `reg:${r.id}`,
      ts: r.ts,
      user: people.get(r.userId)?.name || '',
      action: `${r.status === 'approved' ? 'approved' : 'rejected'} ${r.label}`,
      reference: r.reference || '',
    }));
  }
}

/**
 * Fallback when the logged record no longer exists: the number is only in the
 * description - "... has created GRN GRN-2026-0912", "... created farmer "X"
 * (FRM-001)" or "... created customer "FreshMart"".
 */
export function referenceFromDescription(description: string | null): string {
  if (!description) return '';
  const inBrackets = description.match(/\(([^()]+)\)\s*$/);
  if (inBrackets) return inBrackets[1].trim();
  const quoted = description.match(/"([^"]+)"\s*$/);
  if (quoted) return quoted[1].trim();
  const last = description.trim().split(/\s+/).pop() || '';
  return /\d/.test(last) ? last.replace(/^["']|["']$/g, '') : '';
}
