import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import {
  completeDoc,
  dateTimeLabel,
  fromSqlText,
  grnDueSql,
  nowIst,
  num,
  round2,
  sqlTs,
  tsText,
} from '../../adminControlCenter/service/accShared.util';
import { MyFinalization, MyPayments, PaymentDueRow } from '../myDashboard.types';

/** Longest due lists sent; the oldest come first. */
const DUE_LIMIT = 200;
const RECENT_LIMIT = 10;

const DAYS = (col: string) => `GREATEST(FLOOR(EXTRACT(EPOCH FROM (LOCALTIMESTAMP - ${col})) / 86400)::int, 0)`;

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  cheque: 'Cheque',
  'demand draft': 'Demand Draft',
  neft: 'NEFT',
  rtgs: 'RTGS',
  other: 'Other',
};

/** Finalizer and Payment Manager workspaces. */
@injectable()
export class MyPaymentsService {
  constructor(@inject(TYPES.DataSource) private readonly dataSource: DataSource) {}

  /** Payment status of the GRNs this finalizer finalized (either stage) this month. */
  async getFinalization(userId: string): Promise<MyFinalization> {
    const rows: any[] = await this.dataSource.query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS amount
         FROM (SELECT DISTINCT g.id, COALESCE(g."ammountStatus"::text, 'Unpaid') AS status,
                      COALESCE(g."totalAmt", 0) AS amount
                 FROM documents d
                 JOIN documents_approve_by_whom w ON w.id = d.approval_info_id
                 JOIN approval_stage_info s ON s.id IN (w.first_finalized_id, w.second_finalized_id)
                 JOIN grns g ON g.id::text = d.document_type_id AND g."isDeleted" = false
                WHERE d.type = 'grn' AND d."isDeleted" = false
                  AND s."userId" = $1 AND s.status::text = 'Approved' AND s."statusChangedAt" >= $2::timestamp) x
        GROUP BY status`,
      [userId, sqlTs(nowIst().startOf('month'))],
    );
    return {
      paymentOfFinalized: ['Paid', 'Partial', 'Unpaid'].map((status) => {
        const r = rows.find((x) => x.status === status) ?? {};
        return { status, count: r.count ?? 0, amount: round2(num(r.amount)) };
      }),
    };
  }

  /** How many GRNs / invoices wait for a payment, for the My Work tile. Same rules as getPayments. */
  async queueSummary(): Promise<{ count: number; oldestDays: number }> {
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count, COALESCE(MAX(days), 0)::int AS "oldestDays" FROM (
         SELECT ${DAYS('g."createdAt"')} AS days FROM grns g
          WHERE g."isDeleted" = false AND ${completeDoc('g', 'grn')}
            AND COALESCE(g."ammountStatus"::text, 'Unpaid') <> 'Paid' AND ${grnDueSql('g')} > 0
         UNION ALL
         SELECT ${DAYS('COALESCE(i."invoiceDate"::timestamp, i."createdAt")')} FROM invoices i
          WHERE i."isDeleted" = false AND ${completeDoc('i', 'final-invoice')}
            AND COALESCE(i."ammountStatus"::text, 'Unpaid') <> 'Paid'
            AND COALESCE(i."totalAmount", 0) - COALESCE(i.paid_amount, 0) > 0
       ) x`,
    );
    return { count: row?.count ?? 0, oldestDays: row?.oldestDays ?? 0 };
  }

  /** Company-wide GRNs to pay and invoices to collect, plus what this Payment Manager recorded. */
  async getPayments(userId: string): Promise<MyPayments> {
    const monthStart = sqlTs(nowIst().startOf('month'));

    const [grns, invoices, [recorded], recent] = await Promise.all([
      this.dataSource.query(
        `SELECT g.id::text AS id, g."grnNo" AS "docNo", ${tsText('g."createdAt"')} AS ts,
                COALESCE(g."totalAmt", 0) AS amount, ${grnDueSql('g')} AS due, ${DAYS('g."createdAt"')} AS days,
                CASE WHEN g.source::text = 'farmer' OR (g.source IS NULL AND g.farmer_id IS NOT NULL) THEN 'Farmer' ELSE 'Vendor' END AS "partyType",
                COALESCE(NULLIF(concat_ws(' ', f."farmerfName", f."farmerlName"), ''), v.company_name, '') AS party
           FROM grns g
           LEFT JOIN farmer f ON f.id = g.farmer_id
           LEFT JOIN vendor v ON v.id = g.vendor_id
          WHERE g."isDeleted" = false AND ${completeDoc('g', 'grn')}
            AND COALESCE(g."ammountStatus"::text, 'Unpaid') <> 'Paid' AND ${grnDueSql('g')} > 0
          ORDER BY g."createdAt" ASC
          LIMIT ${DUE_LIMIT}`,
      ),
      this.dataSource.query(
        `SELECT i.id::text AS id, i."invoiceNo" AS "docNo",
                ${tsText('COALESCE(i."invoiceDate"::timestamp, i."createdAt")')} AS ts,
                COALESCE(i."totalAmount", 0) AS amount,
                GREATEST(COALESCE(i."totalAmount", 0) - COALESCE(i.paid_amount, 0), 0) AS due,
                ${DAYS('COALESCE(i."invoiceDate"::timestamp, i."createdAt")')} AS days,
                COALESCE(cc.name, 'Customer') AS "partyType", COALESCE(c.organisation_name, '') AS party
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id
           LEFT JOIN customer_category cc ON cc.id = c."customerCategoryId"
          WHERE i."isDeleted" = false AND ${completeDoc('i', 'final-invoice')}
            AND COALESCE(i."ammountStatus"::text, 'Unpaid') <> 'Paid'
            AND COALESCE(i."totalAmount", 0) - COALESCE(i.paid_amount, 0) > 0
          ORDER BY COALESCE(i."invoiceDate"::timestamp, i."createdAt") ASC
          LIMIT ${DUE_LIMIT}`,
      ),
      this.dataSource.query(
        `SELECT (SELECT COUNT(*) FROM grn_payments p WHERE p.recorded_by_id = $1 AND p.voided_at IS NULL
                   AND p."isDeleted" = false AND p."createdAt" >= $2::timestamp)::int AS "paidCount",
                (SELECT COALESCE(SUM(p.amount), 0) FROM grn_payments p WHERE p.recorded_by_id = $1 AND p.voided_at IS NULL
                   AND p."isDeleted" = false AND p."createdAt" >= $2::timestamp) AS "paidAmount",
                (SELECT COUNT(*) FROM invoice_payments p WHERE p.recorded_by_id = $1 AND p.voided_at IS NULL
                   AND p."isDeleted" = false AND p."createdAt" >= $2::timestamp)::int AS "receivedCount",
                (SELECT COALESCE(SUM(p.amount), 0) FROM invoice_payments p WHERE p.recorded_by_id = $1 AND p.voided_at IS NULL
                   AND p."isDeleted" = false AND p."createdAt" >= $2::timestamp) AS "receivedAmount"`,
        [userId, monthStart],
      ),
      this.dataSource.query(
        `SELECT * FROM (
           SELECT p.id::text AS id, ${tsText('p."createdAt"')} AS ts, g."grnNo" AS "docNo", 'Paid' AS direction,
                  COALESCE(NULLIF(concat_ws(' ', f."farmerfName", f."farmerlName"), ''), v.company_name, '') AS party,
                  p.payment_mode AS mode, p.amount, (p.voided_at IS NOT NULL) AS voided
             FROM grn_payments p
             JOIN grns g ON g.id = p.grn_id
             LEFT JOIN farmer f ON f.id = g.farmer_id
             LEFT JOIN vendor v ON v.id = g.vendor_id
            WHERE p.recorded_by_id = $1 AND p."isDeleted" = false
           UNION ALL
           SELECT p.id::text, ${tsText('p."createdAt"')}, i."invoiceNo", 'Received',
                  COALESCE(c.organisation_name, ''), p.payment_mode, p.amount, (p.voided_at IS NOT NULL)
             FROM invoice_payments p
             JOIN invoices i ON i.id = p.invoice_id
             LEFT JOIN customers c ON c.id = i.customer_id
            WHERE p.recorded_by_id = $1 AND p."isDeleted" = false
         ) x
         ORDER BY ts DESC
         LIMIT ${RECENT_LIMIT}`,
        [userId],
      ),
    ]);

    const dueRow = (r: any): PaymentDueRow => {
      const amount = round2(num(r.amount));
      return {
        id: r.id,
        docNo: r.docNo || '',
        party: r.party,
        partyType: r.partyType,
        docDate: fromSqlText(r.ts).format('DD MMM YYYY'),
        amount,
        paid: round2(amount - num(r.due)),
        days: num(r.days),
      };
    };

    return {
      recorded: {
        paidCount: recorded?.paidCount ?? 0,
        paidAmount: round2(num(recorded?.paidAmount)),
        receivedCount: recorded?.receivedCount ?? 0,
        receivedAmount: round2(num(recorded?.receivedAmount)),
      },
      grnsDue: grns.map(dueRow),
      invoicesDue: invoices.map(dueRow),
      recentPayments: recent.map((r: any) => ({
        id: r.id,
        time: dateTimeLabel(fromSqlText(r.ts)),
        docNo: r.docNo || '',
        party: r.party,
        direction: r.direction,
        mode: MODE_LABELS[(r.mode || '').toLowerCase()] ?? r.mode ?? '',
        amount: round2(num(r.amount)),
        voided: !!r.voided,
      })),
    };
  }
}
