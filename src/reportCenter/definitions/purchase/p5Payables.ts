import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, num, query, round } from '../common';
import {
  P_AS_ON,
  P_COMPANIES,
  P_EMPLOYEES,
  P_GRN_STATUS,
  P_LOCATIONS,
  P_SUPPLIERS,
  Sql,
  dayOf,
  docLateral,
  grnBalanceSql,
  grnWhere,
  supplierJoins,
  supplierKey,
  supplierName,
  supplierType,
} from './purchaseSql';

export const AGEING_BUCKETS = [
  { key: 'notDue', label: 'Not due', min: -Infinity, max: 0 },
  { key: 'd1to7', label: '1-7 days', min: 1, max: 7 },
  { key: 'd8to15', label: '8-15 days', min: 8, max: 15 },
  { key: 'd16to30', label: '16-30 days', min: 16, max: 30 },
  { key: 'd31to60', label: '31-60 days', min: 31, max: 60 },
  { key: 'd60plus', label: 'Over 60 days', min: 61, max: Infinity },
] as const;

/** P5 - whom do we owe, how much, and for how long, as on a date. */
export const payablesAgeing: ReportDefinition = {
  key: 'payables-ageing',
  code: 'P5',
  title: 'Payables & Ageing',
  description: 'Whom do we owe, and for how long? Unpaid and part-paid GRNs as on a date, aged by days past the due date, with a link to each supplier\'s statement.',
  permKey: 'purchase-report',
  params: [P_AS_ON, P_COMPANIES, P_LOCATIONS, P_SUPPLIERS, P_EMPLOYEES, P_GRN_STATUS],
  groupings: [
    { key: 'supplierKey', label: 'Supplier', labelField: 'supplierName' },
    { key: 'supplierType', label: 'Supplier type' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['supplierKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'grnNo', label: 'GRN No', type: 'text', width: 16 },
    { key: 'dayLabel', label: 'GRN date', type: 'date', width: 11 },
    { key: 'dueLabel', label: 'Due date', type: 'date', width: 11 },
    { key: 'daysOverdue', label: 'Days overdue', type: 'days', width: 8, aggregate: { kind: 'max' } },
    { key: 'total', label: 'GRN total', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'paidTotal', label: 'Paid (incl. advance)', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'balance', label: 'Balance', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    ...AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, type: 'inr' as const, width: 11, aggregate: { kind: 'sum' as const } })),
    { key: 'supplierName', label: 'Supplier', type: 'text', width: 22, excelOnly: true },
    { key: 'locationName', label: 'Location', type: 'text', width: 16, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const bal = grnBalanceSql(sql, p.asOn);
    const rows = await query(
      `SELECT * FROM (
         SELECT g.id AS "grnId", d.id AS "documentId", g."grnNo" AS "grnNo", ${dayOf('g."createdAt"')} AS day,
                ${supplierKey('g')} AS "supplierKey", COALESCE(${supplierName('g')}, '(no supplier)') AS "supplierName",
                ${supplierType('g')} AS "supplierType",
                g.purchaselocation_id AS "locationId", COALESCE(b.name, '') AS "locationName",
                COALESCE(g."totalAmt", 0)::float AS total,
                (${bal.advance} + ${bal.paid})::float AS "paidTotal",
                GREATEST(COALESCE(g."totalAmt", 0) - ${bal.advance} - ${bal.paid}, 0)::float AS balance,
                to_char(COALESCE(pi.payment_dute_date,
                                 g."createdAt"::date + COALESCE(pi.credite_period, v.vendor_credit_terms, 0)), 'YYYY-MM-DD') AS due
           FROM grns g
           ${docLateral('g', 'grn')}
           ${supplierJoins('g')}
           LEFT JOIN payment_info_for_grn pi ON pi.id = g.payment_info_id
           LEFT JOIN branches b ON b.id = g.purchaselocation_id
          WHERE ${grnWhere(sql, p, scope, { period: false, asOn: true })}
       ) x
       WHERE x.balance > 0.005
       ORDER BY x.due, x."grnNo"`,
      sql.values,
    );

    const asOnMs = Date.parse(p.asOn);
    const out = rows.map((r: any) => {
      const daysOverdue = Math.round((asOnMs - Date.parse(r.due)) / 86400000);
      const balance = num(r.balance);
      const row: any = { ...r, dayLabel: dayLabel(r.day), dueLabel: dayLabel(r.due), daysOverdue: Math.max(daysOverdue, 0) };
      for (const b of AGEING_BUCKETS) row[b.key] = daysOverdue >= b.min && daysOverdue <= b.max ? balance : 0;
      return row;
    });

    const sum = (k: string) => round(out.reduce((s, r: any) => s + num(r[k]), 0));
    const overdue = sum('balance') - sum('notDue');
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'grn', documentId: r.documentId } : undefined),
      groupLink: (groupingKey, r) =>
        groupingKey === 'supplierKey'
          ? { kind: 'report', report: 'supplier-statement', params: { supplier: r.supplierKey, to: p.asOn }, label: 'Statement' }
          : undefined,
      kpis: [
        { label: 'Total payable', value: sum('balance'), type: 'inr', higherIsBetter: false },
        { label: 'Overdue', value: overdue, type: 'inr', higherIsBetter: false },
        { label: 'Overdue 30+ days', value: sum('d31to60') + sum('d60plus'), type: 'inr', higherIsBetter: false },
        { label: 'Suppliers owed', value: new Set(out.map((r: any) => r.supplierKey)).size, type: 'count' },
        { label: 'Oldest overdue', value: out.reduce((m: number, r: any) => Math.max(m, r.daysOverdue), 0), type: 'days', higherIsBetter: false },
      ],
      chart: {
        type: 'bar',
        title: 'Payable by age',
        categories: AGEING_BUCKETS.map((b) => b.label),
        series: [{ name: 'Balance', type: 'inr', values: AGEING_BUCKETS.map((b) => sum(b.key)) }],
      },
      notes: [
        'Balance = GRN total − advance − payments recorded up to the as-on date (voided payments excluded).',
        'Due date = the GRN\'s payment due date; if blank, GRN date + credit period (GRN, else the vendor\'s credit terms); if none, the GRN date.',
      ],
    };
  },
};
