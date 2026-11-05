import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, num, query, round } from '../common';
import {
  P_AS_ON,
  P_COMPANIES,
  P_CUSTOMERS,
  P_DOC_STATUS,
  P_EMPLOYEES,
  P_LOCATIONS,
  Sql,
  dayOf,
  docLateral,
  invoicePaidSql,
  statusCondition,
} from './salesSql';

export const RECEIVABLE_BUCKETS = [
  { key: 'd0to7', label: '0-7 days', min: -Infinity, max: 7 },
  { key: 'd8to15', label: '8-15 days', min: 8, max: 15 },
  { key: 'd16to30', label: '16-30 days', min: 16, max: 30 },
  { key: 'd31to60', label: '31-60 days', min: 31, max: 60 },
  { key: 'd60plus', label: 'Over 60 days', min: 61, max: Infinity },
] as const;

/** S4 - who owes us, how much, for how long, and who is over their credit exposure limit. */
export const receivablesAgeing: ReportDefinition = {
  key: 'receivables-ageing',
  code: 'S4',
  title: 'Receivables & Ageing',
  description: 'Who owes us, and for how long? Unpaid and part-paid Final Invoices as on a date, aged from the invoice date, with each customer\'s exposure limit and a link to their statement.',
  permKey: 'sales-report',
  params: [P_AS_ON, P_COMPANIES, P_LOCATIONS, P_CUSTOMERS, P_EMPLOYEES, P_DOC_STATUS],
  groupings: [
    { key: 'customerKey', label: 'Customer', labelField: 'customerName' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['customerKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'docNo', label: 'Invoice No', type: 'text', width: 16 },
    { key: 'dayLabel', label: 'Invoice date', type: 'date', width: 11 },
    { key: 'daysOld', label: 'Days', type: 'days', width: 7, aggregate: { kind: 'max' } },
    { key: 'total', label: 'Invoice total', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'paid', label: 'Received', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'balance', label: 'Balance', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    ...RECEIVABLE_BUCKETS.map((b) => ({ key: b.key, label: b.label, type: 'inr' as const, width: 11, aggregate: { kind: 'sum' as const } })),
    { key: 'exposureLimit', label: 'Exposure limit', type: 'inr', width: 12, aggregate: { kind: 'max' }, groupOnly: true },
    { key: 'customerName', label: 'Customer', type: 'text', width: 22, excelOnly: true },
    { key: 'locationName', label: 'Location', type: 'text', width: 14, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const paid = invoicePaidSql(sql, p.asOn);
    const invDate = `COALESCE(i."invoiceDate", i."createdAt"::date)`;
    const w = [`i."isDeleted" = false`, statusCondition('d', p.extra.docStatus || 'complete'), `${invDate} <= ${sql.add(p.asOn)}::date`];
    if (p.companyIds.length) w.push(`i.company_id = ANY(${sql.add(p.companyIds)}::uuid[])`);
    if (p.locationIds.length) w.push(`i.branch_id = ANY(${sql.add(p.locationIds)}::uuid[])`);
    if (p.customerIds.length) w.push(`i.customer_id = ANY(${sql.add(p.customerIds)}::uuid[])`);
    if (p.employeeIds.length) w.push(`i.created_by = ANY(${sql.add(p.employeeIds)}::uuid[])`);
    if (scope.creatorIds) w.push(`i.created_by = ANY(${sql.add(scope.creatorIds)}::uuid[])`);

    const rows = await query(
      `SELECT * FROM (
         SELECT i.id AS "docId", d.id AS "documentId", i."invoiceNo" AS "docNo", ${dayOf(invDate)} AS day,
                'customer:' || i.customer_id::text AS "customerKey", i.customer_id AS "customerId",
                COALESCE(NULLIF(cu.organisation_name, ''), '(no customer)') AS "customerName",
                i.branch_id AS "locationId", COALESCE(b.name, '') AS "locationName",
                COALESCE(i."totalAmount", 0)::float AS total, ${paid}::float AS paid,
                GREATEST(COALESCE(i."totalAmount", 0) - ${paid}, 0)::float AS balance,
                COALESCE(NULLIF(pt."Revision_exposure_limit_amount", 0), NULLIF(pt."initial_exposure_limit_Amount", 0))::float AS "exposureLimit"
           FROM invoices i
           ${docLateral('i', 'final-invoice')}
           LEFT JOIN customers cu ON cu.id = i.customer_id
           LEFT JOIN customer_payment_terms pt ON pt.id = cu."paymentTermsId"
           LEFT JOIN branches b ON b.id = i.branch_id
          WHERE ${w.join(' AND ')}
       ) x WHERE x.balance > 0.005 ORDER BY x.day, x."docNo"`,
      sql.values,
    );

    const asOnMs = Date.parse(p.asOn);
    const out = rows.map((r: any) => {
      const daysOld = Math.max(Math.round((asOnMs - Date.parse(r.day)) / 86400000), 0);
      const row: any = { ...r, dayLabel: dayLabel(r.day), daysOld };
      for (const b of RECEIVABLE_BUCKETS) row[b.key] = daysOld >= b.min && daysOld <= b.max ? num(r.balance) : 0;
      return row;
    });

    const byCustomer = new Map<string, { balance: number; limit: number | null; name: string }>();
    for (const r of out) {
      const c = byCustomer.get(r.customerKey) ?? { balance: 0, limit: r.exposureLimit, name: r.customerName };
      c.balance += num(r.balance);
      byCustomer.set(r.customerKey, c);
    }
    const overLimit = [...byCustomer.values()].filter((c) => c.limit && c.balance > c.limit);
    const sum = (k: string) => round(out.reduce((s: number, r: any) => s + num(r[k]), 0));

    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'final-invoice', documentId: r.documentId } : undefined),
      groupLink: (groupingKey, r) =>
        groupingKey === 'customerKey' && r.customerId
          ? { kind: 'report', report: 'customer-statement', params: { customer: r.customerId, to: p.asOn }, label: 'Statement' }
          : undefined,
      kpis: [
        { label: 'Total receivable', value: sum('balance'), type: 'inr' },
        { label: 'Older than 30 days', value: sum('d31to60') + sum('d60plus'), type: 'inr', higherIsBetter: false },
        { label: 'Customers owing', value: byCustomer.size, type: 'count' },
        { label: 'Over exposure limit', value: overLimit.length, type: 'count', higherIsBetter: false, hint: overLimit.map((c) => c.name).slice(0, 3).join(', ') },
        { label: 'Oldest invoice', value: out.reduce((m: number, r: any) => Math.max(m, r.daysOld), 0), type: 'days', higherIsBetter: false },
      ],
      chart: {
        type: 'bar',
        title: 'Receivable by age',
        categories: RECEIVABLE_BUCKETS.map((b) => b.label),
        series: [{ name: 'Balance', type: 'inr', values: RECEIVABLE_BUCKETS.map((b) => sum(b.key)) }],
      },
      notes: [
        'Balance = invoice total − payments recorded up to the as-on date (voided payments excluded). Aged from the invoice date: invoices carry no due date and customers no credit period yet (plan decision D5).',
        'Exposure limit = the customer\'s revised exposure limit, else the initial one (customer registration, payment terms). Shown on the customer\'s subtotal row.',
      ],
    };
  },
};
