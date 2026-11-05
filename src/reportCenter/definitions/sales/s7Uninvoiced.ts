import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, num, query, round } from '../common';
import { P_AS_ON, P_COMPANIES, P_CUSTOMERS, P_DOC_STATUS, P_LOCATIONS, Sql, docLateral, statusCondition } from './salesSql';

/**
 * Accepted share of a DC line after returns / rejections (item returnedQty / rejectedQty are in
 * the line's own unit), same rule as the dashboard (adminControlCenter accShared.util dcLineKg).
 */
const accepted = (it: string) =>
  `GREATEST(1 - (CASE WHEN COALESCE(${it}.quantity, 0) > 0
                      THEN LEAST(GREATEST((COALESCE(${it}."returnedQty", 0) + COALESCE(${it}."rejectedQty", 0)) / ${it}.quantity, 0), 1)
                      ELSE 0 END), 0)`;

/** S7 - goods delivered (or on the way) to customers with no Final Invoice yet: revenue not billed. */
export const uninvoicedDeliveries: ReportDefinition = {
  key: 'uninvoiced-deliveries',
  code: 'S7',
  title: 'Uninvoiced Deliveries',
  description: 'What have we delivered but not billed? Customer DCs with no Final Invoice as on a date, with delivery state, accepted value and age.',
  permKey: 'sales-report',
  params: [P_AS_ON, P_COMPANIES, P_LOCATIONS, P_CUSTOMERS, P_DOC_STATUS],
  groupings: [
    { key: 'customerKey', label: 'Customer', labelField: 'customerName' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
    { key: 'deliveryState', label: 'Delivery state' },
  ],
  defaultGroupBy: ['deliveryState'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'DC date', type: 'date', width: 11 },
    { key: 'dcNo', label: 'DC No', type: 'text', width: 16 },
    { key: 'customerName', label: 'Customer', type: 'text', width: 22 },
    { key: 'locationName', label: 'From location', type: 'text', width: 14 },
    { key: 'deliveryState', label: 'Delivery', type: 'text', width: 16 },
    { key: 'saleType', label: 'Sale type', type: 'text', width: 14 },
    { key: 'dispatchedKg', label: 'Dispatched kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'acceptedKg', label: 'Accepted kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'value', label: 'Value to invoice', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'daysOld', label: 'Days since DC', type: 'days', width: 8, aggregate: { kind: 'max' } },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const w = [`dc."isDeleted" = false`, `dc.type = 'customer_delivery_challan'`, statusCondition('d', p.extra.docStatus || 'complete'),
      `dc."createdAt"::date <= ${sql.add(p.asOn)}::date`,
      `NOT EXISTS (SELECT 1 FROM invoices i ${docLateral('i', 'final-invoice', 'idoc')}
                    WHERE i.delivery_challan_id = dc.id AND i."isDeleted" = false AND COALESCE(idoc.status, '') <> 'Rejected')`];
    if (p.companyIds.length) w.push(`dc.company_id = ANY(${sql.add(p.companyIds)}::uuid[])`);
    if (p.locationIds.length) w.push(`dc.branch_id = ANY(${sql.add(p.locationIds)}::uuid[])`);
    if (p.customerIds.length) w.push(`dc.customer_id = ANY(${sql.add(p.customerIds)}::uuid[])`);
    if (scope.creatorIds) w.push(`dc.created_by = ANY(${sql.add(scope.creatorIds)}::uuid[])`);

    const rows = await query(
      `SELECT dc.id AS "dcId", d.id AS "documentId", dc."challanNo" AS "dcNo", to_char(dc."createdAt", 'YYYY-MM-DD') AS day,
              'customer:' || dc.customer_id::text AS "customerKey", COALESCE(NULLIF(cu.organisation_name, ''), '(no customer)') AS "customerName",
              dc.branch_id AS "locationId", COALESCE(b.name, '') AS "locationName",
              COALESCE((SELECT c.outcome FROM dc_delivery_confirmation c WHERE c.dc_id = dc.id AND c.undone_at IS NULL
                         ORDER BY c.confirmed_at DESC LIMIT 1), 'Pending') AS "deliveryState",
              (CASE WHEN dc.grn_id IS NOT NULL THEN 'Direct (from GRN)' ELSE 'From stock' END) AS "saleType",
              (SELECT COALESCE(SUM(it."netWeight"), 0) FROM item it WHERE it."deliveryChallanId" = dc.id AND it."isDeleted" = false)::float AS "dispatchedKg",
              (SELECT COALESCE(SUM(it."netWeight" * ${accepted('it')}), 0) FROM item it WHERE it."deliveryChallanId" = dc.id AND it."isDeleted" = false)::float AS "acceptedKg",
              (SELECT COALESCE(SUM(it.amount * ${accepted('it')}), 0) FROM item it WHERE it."deliveryChallanId" = dc.id AND it."isDeleted" = false)::float AS value
         FROM delivery_challan_purchase dc
         ${docLateral('dc', 'DC_TYPE_CUSTOMER')}
         LEFT JOIN customers cu ON cu.id = dc.customer_id
         LEFT JOIN branches b ON b.id = dc.branch_id
        WHERE ${w.join(' AND ')}
        ORDER BY dc."createdAt", dc."challanNo"`,
      sql.values,
    );

    const asOnMs = Date.parse(p.asOn);
    const out = rows.map((r: any) => ({
      ...r,
      dayLabel: dayLabel(r.day),
      daysOld: Math.max(Math.round((asOnMs - Date.parse(r.day)) / 86400000), 0),
    }));
    const sum = (k: string, f: (r: any) => boolean = () => true) => round(out.filter(f).reduce((s: number, r: any) => s + num(r[k]), 0));
    const delivered = (r: any) => r.deliveryState !== 'Pending';
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'dc-customer', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'DCs not invoiced', value: out.length, type: 'count', higherIsBetter: false },
        { label: 'Value to invoice', value: sum('value'), type: 'inr', higherIsBetter: false },
        { label: 'Delivered, not invoiced', value: sum('value', delivered), type: 'inr', higherIsBetter: false, hint: `${out.filter(delivered).length} DC(s)` },
        { label: 'Oldest', value: out.reduce((m: number, r: any) => Math.max(m, r.daysOld), 0), type: 'days', higherIsBetter: false },
      ],
      chart: null,
      notes: [
        'Approved customer DCs with no Final Invoice (a rejected invoice does not count). Delivery state comes from the DC\'s delivery confirmation; "Pending" = not confirmed yet.',
        'Value to invoice = DC line amounts less returned and rejected quantities.',
      ],
    };
  },
};
