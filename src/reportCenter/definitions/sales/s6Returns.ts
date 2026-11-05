import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, monthLabel, num, query, ratio, round, topChart } from '../common';
import {
  P_COMPANIES,
  P_CUSTOMERS,
  P_DOC_STATUS,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  Sql,
  docLateral,
  employeeName,
  productLabel,
  statusCondition,
} from './salesSql';

/** S6 - what customers send back, why it matters (kg and value), and what second sales recover. */
export const returnsRejections: ReportDefinition = {
  key: 'returns-rejections',
  code: 'S6',
  title: 'Returns & Rejections',
  description: 'What comes back from customers? Returned and rejected kg and value per Returned By Customer line, as a share of what was dispatched on that DC, by customer, product and location, with second-sale recovery.',
  permKey: 'sales-report',
  params: [P_PERIOD, P_COMPANIES, P_LOCATIONS, P_CUSTOMERS, P_PRODUCTS, P_DOC_STATUS],
  groupings: [
    { key: 'customerKey', label: 'Customer', labelField: 'customerName' },
    { key: 'productKey', label: 'Product', labelField: 'productName' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
    { key: 'month', label: 'Month', labelField: 'monthLabel' },
  ],
  defaultGroupBy: ['customerKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'rbcNo', label: 'RBC No', type: 'text', width: 16 },
    { key: 'dcNo', label: 'DC No', type: 'text', width: 16 },
    { key: 'customerName', label: 'Customer', type: 'text', width: 20 },
    { key: 'productName', label: 'Product', type: 'text', width: 18 },
    { key: 'dispatchedKg', label: 'Dispatched kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'returnedKg', label: 'Returned kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'returnedAmt', label: 'Returned value', type: 'inr', width: 11, aggregate: { kind: 'sum' } },
    { key: 'rejectedKg', label: 'Rejected kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'rejectedAmt', label: 'Rejected value', type: 'inr', width: 11, aggregate: { kind: 'sum' } },
    { key: 'backPct', label: 'Back %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'backKg', den: 'dispatchedKg', scale: 100 } },
    { key: 'locationName', label: 'Location', type: 'text', width: 14, excelOnly: true },
    { key: 'createdByName', label: 'Created by', type: 'text', width: 16, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const date = `COALESCE(r.date, r."createdAt"::date)`;
    const w = [`r."isDeleted" = false`, statusCondition('d', p.extra.docStatus || 'complete'),
      `${date} BETWEEN ${sql.add(p.from)}::date AND ${sql.add(p.to)}::date`];
    if (p.companyIds.length) w.push(`r.company_id = ANY(${sql.add(p.companyIds)}::uuid[])`);
    if (p.locationIds.length) w.push(`r.branch_id = ANY(${sql.add(p.locationIds)}::uuid[])`);
    if (p.customerIds.length) w.push(`r.customer_id = ANY(${sql.add(p.customerIds)}::uuid[])`);
    if (p.productIds.length) w.push(`rp.product_id = ANY(${sql.add(p.productIds)}::uuid[])`);
    if (scope.creatorIds) w.push(`r.createdby_id = ANY(${sql.add(scope.creatorIds)}::uuid[])`);

    const rows = await query(
      `SELECT r.id AS "rbcId", d.id AS "documentId", r."rbcNo" AS "rbcNo", to_char(${date}, 'YYYY-MM-DD') AS day,
              COALESCE(dc."challanNo", '') AS "dcNo",
              'customer:' || COALESCE(r.customer_id, dc.customer_id)::text AS "customerKey",
              COALESCE(NULLIF(cu.organisation_name, ''), '(no customer)') AS "customerName",
              r.branch_id AS "locationId", COALESCE(b.name, '') AS "locationName",
              COALESCE(rp.varient_id, rp.product_id)::text AS "productKey", ${productLabel('pr', 'pv')} AS "productName",
              COALESCE(rp."returnedNetWt", 0)::float AS "returnedKg", COALESCE(rp."returnedQtyAmt", 0)::float AS "returnedAmt",
              COALESCE(rp."rejectedNetWt", 0)::float AS "rejectedKg", COALESCE(rp."rejectedQtyAmt", 0)::float AS "rejectedAmt",
              (SELECT COALESCE(SUM(it."netWeight"), 0) FROM item it
                WHERE it."deliveryChallanId" = r.delivery_challan_id AND it."isDeleted" = false
                  AND it.product_id = rp.product_id AND it.varient_id IS NOT DISTINCT FROM rp.varient_id)::float AS "dispatchedKg",
              COALESCE(${employeeName('e')}, '') AS "createdByName"
         FROM return_by_customer r
         ${docLateral('r', 'return-by-customer')}
         JOIN returned_products_by_customer rp ON rp."postReturnId" = r.id AND rp."isDeleted" = false
         LEFT JOIN delivery_challan_purchase dc ON dc.id = r.delivery_challan_id
         LEFT JOIN customers cu ON cu.id = COALESCE(r.customer_id, dc.customer_id)
         LEFT JOIN branches b ON b.id = r.branch_id
         LEFT JOIN product pr ON pr.id = rp.product_id
         LEFT JOIN "productVarient" pv ON pv.id = rp.varient_id
         LEFT JOIN employees e ON e.id = r.createdby_id
        WHERE ${w.join(' AND ')}
        ORDER BY ${date}, r."rbcNo"`,
      sql.values,
    );

    const out = rows.map((r: any) => {
      const backKg = num(r.returnedKg) + num(r.rejectedKg);
      return {
        ...r,
        dayLabel: dayLabel(r.day),
        month: r.day.slice(0, 7),
        monthLabel: monthLabel(r.day.slice(0, 7)),
        backKg,
        backPct: ratio(backKg, num(r.dispatchedKg), 100),
      };
    });

    // Second sales in the same period: what was recovered by reselling returned / rejected goods.
    const ssql = new Sql();
    const sw = [`s."isDeleted" = false`, statusCondition('d', p.extra.docStatus || 'complete'),
      `COALESCE(s."saleDate", s."createdAt"::date) BETWEEN ${ssql.add(p.from)}::date AND ${ssql.add(p.to)}::date`];
    if (p.companyIds.length) sw.push(`s.company_id = ANY(${ssql.add(p.companyIds)}::uuid[])`);
    if (p.locationIds.length) sw.push(`s.branch_id = ANY(${ssql.add(p.locationIds)}::uuid[])`);
    const [ss] = scope.creatorIds
      ? [{ amount: 0 }]
      : await query(
          `SELECT COALESCE(SUM(s."totalAmt"), 0)::float AS amount FROM second_sale_document s ${docLateral('s', 'second-sale')} WHERE ${sw.join(' AND ')}`,
          ssql.values,
        );

    const sum = (k: string) => round(out.reduce((s: number, r: any) => s + num(r[k]), 0));
    const lostValue = sum('returnedAmt') + sum('rejectedAmt');
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'rbc', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'Returned', value: sum('returnedKg'), type: 'kg', higherIsBetter: false },
        { label: 'Rejected', value: sum('rejectedKg'), type: 'kg', higherIsBetter: false },
        { label: 'Value returned + rejected', value: lostValue, type: 'inr', higherIsBetter: false },
        { label: 'Back % of dispatched', value: ratio(sum('backKg'), sum('dispatchedKg'), 100), type: 'pct', higherIsBetter: false },
        { label: 'Recovered by second sales', value: num(ss?.amount), type: 'inr', hint: lostValue ? `${ratio(num(ss?.amount), lostValue, 100)}% of returned + rejected value` : undefined },
      ],
      chart: topChart(out, 'Top 10 customers by value returned + rejected', (r) => r.customerName, {
        name: 'Returned + rejected', type: 'inr', value: (r) => num(r.returnedAmt) + num(r.rejectedAmt),
      }),
      notes: [
        'Dispatched kg is the same product on the same DC. Back % = (returned + rejected kg) ÷ dispatched kg.',
        'Second sales are not linked to a return, so recovery compares the period\'s second-sale value with the period\'s returned + rejected value.',
      ],
    };
  },
};
