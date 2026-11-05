import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, monthLabel, num, periodChart, query, round } from '../common';
import { P_COMPANIES, P_CUSTOMERS, P_LOCATIONS, P_PERIOD, Sql, docLateral, employeeName, paymentModeSql, statusCondition } from './salesSql';

/** S5 - what customers paid us, by payment date. */
export const collectionRegister: ReportDefinition = {
  key: 'collection-register',
  code: 'S5',
  title: 'Collection Register',
  description: 'What did we collect? Final Invoice payments by payment date, mode and customer, with voided payments and their reasons.',
  permKey: 'sales-report',
  params: [
    P_PERIOD,
    P_COMPANIES,
    P_LOCATIONS,
    P_CUSTOMERS,
    {
      key: 'voided',
      label: 'Voided payments',
      kind: 'select',
      default: 'show',
      options: [
        { value: 'show', label: 'Show (not counted in totals)' },
        { value: 'hide', label: 'Hide' },
      ],
    },
  ],
  groupings: [
    { key: 'day', label: 'Date', labelField: 'dayLabel' },
    { key: 'month', label: 'Month', labelField: 'monthLabel' },
    { key: 'customerKey', label: 'Customer', labelField: 'customerName' },
    { key: 'mode', label: 'Payment mode' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['day'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'paymentRef', label: 'Payment', type: 'text', width: 8 },
    { key: 'docNo', label: 'Invoice No', type: 'text', width: 16 },
    { key: 'customerName', label: 'Customer', type: 'text', width: 22 },
    { key: 'locationName', label: 'Location', type: 'text', width: 14 },
    { key: 'mode', label: 'Mode', type: 'text', width: 10 },
    { key: 'referenceNo', label: 'Reference', type: 'text', width: 14 },
    { key: 'paymentType', label: 'Type', type: 'text', width: 9 },
    { key: 'amount', label: 'Amount received', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'voidedAmount', label: 'Voided amount', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'voidReason', label: 'Void reason', type: 'text', width: 18 },
    { key: 'recordedBy', label: 'Recorded by', type: 'text', width: 16 },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const w = [`i."isDeleted" = false`, statusCondition('d', 'all'), `pay."isDeleted" = false`,
      `pay.payment_date BETWEEN ${sql.add(p.from)}::date AND ${sql.add(p.to)}::date`];
    if (p.extra.voided === 'hide') w.push('pay.voided_at IS NULL');
    if (p.companyIds.length) w.push(`i.company_id = ANY(${sql.add(p.companyIds)}::uuid[])`);
    if (p.locationIds.length) w.push(`i.branch_id = ANY(${sql.add(p.locationIds)}::uuid[])`);
    if (p.customerIds.length) w.push(`i.customer_id = ANY(${sql.add(p.customerIds)}::uuid[])`);
    if (scope.creatorIds) w.push(`i.created_by = ANY(${sql.add(scope.creatorIds)}::uuid[])`);

    const rows = await query(
      `SELECT i."invoiceNo" AS "docNo", d.id AS "documentId", to_char(pay.payment_date, 'YYYY-MM-DD') AS day,
              '#' || pay.payment_no AS "paymentRef", COALESCE(${paymentModeSql('pay.payment_mode')}, '') AS mode, COALESCE(pay.reference_no, '') AS "referenceNo",
              initcap(COALESCE(pay.payment_type, '')) AS "paymentType", pay.amount::float AS amount,
              pay.voided_at IS NOT NULL AS voided, COALESCE(pay.void_reason, '') AS "voidReason",
              COALESCE(${employeeName('e')}, '') AS "recordedBy",
              'customer:' || i.customer_id::text AS "customerKey", COALESCE(NULLIF(cu.organisation_name, ''), '(no customer)') AS "customerName",
              i.branch_id AS "locationId", COALESCE(b.name, '') AS "locationName"
         FROM invoice_payments pay
         JOIN invoices i ON i.id = pay.invoice_id
         ${docLateral('i', 'final-invoice')}
         LEFT JOIN customers cu ON cu.id = i.customer_id
         LEFT JOIN branches b ON b.id = i.branch_id
         LEFT JOIN employees e ON e.id = pay.recorded_by_id
        WHERE ${w.join(' AND ')}
        ORDER BY pay.payment_date, i."invoiceNo", pay.payment_no`,
      sql.values,
    );

    const out = rows.map((r: any) => ({
      ...r,
      dayLabel: dayLabel(r.day),
      month: r.day.slice(0, 7),
      monthLabel: monthLabel(r.day.slice(0, 7)),
      amount: r.voided ? 0 : num(r.amount),
      voidedAmount: r.voided ? num(r.amount) : 0,
    }));
    const sum = (k: string) => round(out.reduce((s: number, r: any) => s + num(r[k]), 0));
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'final-invoice', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'Total received', value: sum('amount'), type: 'inr' },
        { label: 'Payments', value: out.filter((r) => !r.voided).length, type: 'count' },
        { label: 'Customers who paid', value: new Set(out.filter((r) => !r.voided).map((r) => r.customerKey)).size, type: 'count' },
        { label: 'Voided', value: sum('voidedAmount'), type: 'inr', higherIsBetter: false, hint: `${out.filter((r) => r.voided).length} payment(s)` },
      ],
      chart: periodChart(p, out, 'Amount received', [{ name: 'Received', type: 'inr', value: (r) => r.amount }]),
      notes: ['Payments recorded by the Payment Manager against Final Invoices. Payments on rejected invoices are not listed.'],
    };
  },
};
