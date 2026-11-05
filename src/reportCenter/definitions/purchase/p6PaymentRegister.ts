import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, monthLabel, num, periodChart, query, round } from '../common';
import {
  P_COMPANIES,
  P_LOCATIONS,
  P_PERIOD,
  P_SUPPLIERS,
  Sql,
  docLateral,
  paymentModeSql,
  employeeName,
  grnWhere,
  supplierJoins,
  supplierKey,
  supplierName,
} from './purchaseSql';

/** P6 - what we paid suppliers: GRN advances and recorded payments, by payment date. */
export const purchasePaymentRegister: ReportDefinition = {
  key: 'purchase-payment-register',
  code: 'P6',
  title: 'Payment Register (Purchase)',
  description: 'What did we pay? Advances and GRN payments by payment date, mode and supplier, with voided payments and their reasons.',
  permKey: 'purchase-report',
  params: [
    P_PERIOD,
    P_COMPANIES,
    P_LOCATIONS,
    P_SUPPLIERS,
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
    { key: 'supplierKey', label: 'Supplier', labelField: 'supplierName' },
    { key: 'mode', label: 'Payment mode' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['day'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'paymentRef', label: 'Payment', type: 'text', width: 9 },
    { key: 'grnNo', label: 'GRN No', type: 'text', width: 16 },
    { key: 'supplierName', label: 'Supplier', type: 'text', width: 22 },
    { key: 'locationName', label: 'Location', type: 'text', width: 14 },
    { key: 'mode', label: 'Mode', type: 'text', width: 10 },
    { key: 'referenceNo', label: 'Reference', type: 'text', width: 14 },
    { key: 'paymentType', label: 'Type', type: 'text', width: 9 },
    { key: 'amount', label: 'Amount paid', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'voidedAmount', label: 'Voided amount', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'voidReason', label: 'Void reason', type: 'text', width: 18 },
    { key: 'recordedBy', label: 'Recorded by', type: 'text', width: 16 },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const where = grnWhere(sql, p, scope, { period: false, status: 'all' });
    const from = sql.add(p.from);
    const to = sql.add(p.to);
    const voidFilter = p.extra.voided === 'hide' ? 'AND gp.voided_at IS NULL' : '';
    const rows = await query(
      `WITH gs AS (
         SELECT g.id, g."grnNo", d.id AS "documentId", g.payment_info_id, g."createdAt",
                ${supplierKey('g')} AS "supplierKey", COALESCE(${supplierName('g')}, '(no supplier)') AS "supplierName",
                g.purchaselocation_id AS "locationId", COALESCE(b.name, '') AS "locationName"
           FROM grns g ${docLateral('g', 'grn')} ${supplierJoins('g')}
           LEFT JOIN branches b ON b.id = g.purchaselocation_id
          WHERE ${where})
       SELECT * FROM (
         SELECT gs."grnNo", gs."documentId", gs."supplierKey", gs."supplierName", gs."locationId", gs."locationName",
                to_char(COALESCE(pi.payment_date, gs."createdAt"::date), 'YYYY-MM-DD') AS day, 0 AS seq,
                'Advance' AS "paymentRef", COALESCE(${paymentModeSql('pi.payment_mode')}, '') AS mode, '' AS "referenceNo", 'Advance' AS "paymentType",
                pi.advance_paid_amount::float AS amount, false AS voided, '' AS "voidReason", '' AS "recordedBy"
           FROM gs JOIN payment_info_for_grn pi ON pi.id = gs.payment_info_id
          WHERE COALESCE(pi.advance_paid_amount, 0) > 0
            AND COALESCE(pi.payment_date, gs."createdAt"::date) BETWEEN ${from}::date AND ${to}::date
         UNION ALL
         SELECT gs."grnNo", gs."documentId", gs."supplierKey", gs."supplierName", gs."locationId", gs."locationName",
                to_char(gp.payment_date, 'YYYY-MM-DD'), gp.payment_no,
                '#' || gp.payment_no, COALESCE(${paymentModeSql('gp.payment_mode')}, ''), COALESCE(gp.reference_no, ''), initcap(COALESCE(gp.payment_type, '')),
                gp.amount::float, gp.voided_at IS NOT NULL, COALESCE(gp.void_reason, ''), COALESCE(${employeeName('e')}, '')
           FROM gs JOIN grn_payments gp ON gp.grn_id = gs.id AND gp."isDeleted" = false ${voidFilter}
           LEFT JOIN employees e ON e.id = gp.recorded_by_id
          WHERE gp.payment_date BETWEEN ${from}::date AND ${to}::date
       ) x ORDER BY x.day, x."grnNo", x.seq`,
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
    const sum = (k: string, f: (r: any) => boolean = () => true) => round(out.filter(f).reduce((s, r: any) => s + num(r[k]), 0));
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'grn', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'Total paid', value: sum('amount'), type: 'inr' },
        { label: 'Payments', value: out.filter((r) => !r.voided).length, type: 'count' },
        { label: 'Of which advances', value: sum('amount', (r) => r.paymentType === 'Advance'), type: 'inr' },
        { label: 'Voided', value: sum('voidedAmount'), type: 'inr', higherIsBetter: false, hint: `${out.filter((r) => r.voided).length} payment(s)` },
      ],
      chart: periodChart(p, out, 'Amount paid', [{ name: 'Paid', type: 'inr', value: (r) => r.amount }]),
      notes: ['Advances are dated by the advance payment date on the GRN (or the GRN date when blank). Payments on rejected GRNs are not listed.'],
    };
  },
};
