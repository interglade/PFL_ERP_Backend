import { tsBounds } from '../../engine/params';
import { ReportDefinition, ReportParams, ReportScope } from '../../reportCenter.types';
import { dayLabel, num, query, ratio } from '../common';
import {
  P_COMPANIES,
  P_EMPLOYEES,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  P_SUPPLIERS,
  Sql,
  dayOf,
  docLateral,
  employeeName,
  grnWhere,
  isFarmer,
  productLabel,
  productWhere,
  supplierJoins,
  supplierKey,
  supplierName,
} from './purchaseSql';

function rfpaWhere(sql: Sql, p: ReportParams, scope: ReportScope): string {
  const [start, end] = tsBounds(p.from, p.to);
  const w = [
    `r."isDeleted" = false`,
    `COALESCE(rd.status, '') NOT IN ('Draft')`,
    `r."createdAt" >= ${sql.add(start)}::timestamp AND r."createdAt" < ${sql.add(end)}::timestamp`,
  ];
  if (p.companyIds.length) w.push(`r.company_id = ANY(${sql.add(p.companyIds)}::uuid[])`);
  if (p.locationIds.length) w.push(`r.purchaselocation_id = ANY(${sql.add(p.locationIds)}::uuid[])`);
  if (p.vendorIds.length || p.farmerIds.length) {
    const parts: string[] = [];
    if (p.vendorIds.length) parts.push(`(NOT ${isFarmer('r')} AND r.vendor_id = ANY(${sql.add(p.vendorIds)}::uuid[]))`);
    if (p.farmerIds.length) parts.push(`(${isFarmer('r')} AND r.farmer_id = ANY(${sql.add(p.farmerIds)}::uuid[]))`);
    w.push(`(${parts.join(' OR ')})`);
  }
  if (p.employeeIds.length) w.push(`r.created_by = ANY(${sql.add(p.employeeIds)}::uuid[])`);
  if (scope.creatorIds) w.push(`r.created_by = ANY(${sql.add(scope.creatorIds)}::uuid[])`);
  return w.join(' AND ');
}

/** P4 - do approved requests turn into purchases? One row per RFPA line, followed to its Deal Slip and GRNs. */
export const procurementFunnel: ReportDefinition = {
  key: 'procurement-funnel',
  code: 'P4',
  title: 'Procurement Funnel',
  description: 'Do purchase requests turn into purchases? RFPA → Deal Slip → GRN quantities, conversion % and days between steps, with direct GRNs (no RFPA) shown separately.',
  permKey: 'purchase-report',
  params: [P_PERIOD, P_COMPANIES, P_LOCATIONS, P_SUPPLIERS, P_PRODUCTS, P_EMPLOYEES],
  groupings: [
    { key: 'productKey', label: 'Product', labelField: 'productName' },
    { key: 'supplierKey', label: 'Supplier', labelField: 'supplierName' },
    { key: 'createdById', label: 'Raised by', labelField: 'createdByName' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['productKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'RFPA date', type: 'date', width: 11 },
    { key: 'rfpaNo', label: 'RFPA No', type: 'text', width: 16 },
    { key: 'rfpaStatus', label: 'RFPA status', type: 'text', width: 10 },
    { key: 'supplierName', label: 'Supplier', type: 'text', width: 20 },
    { key: 'productName', label: 'Product', type: 'text', width: 18 },
    { key: 'uom', label: 'UOM', type: 'text', width: 6 },
    { key: 'rfpaQty', label: 'RFPA qty', type: 'qty', width: 9, aggregate: { kind: 'sum' } },
    { key: 'dealSlipNo', label: 'Deal Slip', type: 'text', width: 16 },
    { key: 'dsQty', label: 'Deal Slip qty', type: 'qty', width: 9, aggregate: { kind: 'sum' } },
    { key: 'grnNos', label: 'GRN(s)', type: 'text', width: 18 },
    { key: 'grnQty', label: 'GRN qty', type: 'qty', width: 9, aggregate: { kind: 'sum' } },
    { key: 'grnKg', label: 'GRN net kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'conversionPct', label: 'RFPA → GRN %', type: 'pct', width: 9, aggregate: { kind: 'ratio', num: 'grnQty', den: 'rfpaQty', scale: 100 } },
    { key: 'daysToDs', label: 'Days to Deal Slip', type: 'days', width: 9, aggregate: { kind: 'ratio', num: 'daysToDs', den: 'hasDs' } },
    { key: 'daysToGrn', label: 'Days Deal Slip → GRN', type: 'days', width: 9, aggregate: { kind: 'ratio', num: 'daysToGrn', den: 'hasGrn' } },
    { key: 'createdByName', label: 'Raised by', type: 'text', width: 16, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const rows = await query(
      `SELECT r.id AS "rfpaId", rd.id AS "documentId", COALESCE(rd.status, '') AS "rfpaStatus", r."rfpaId" AS "rfpaNo",
              ${dayOf('r."createdAt"')} AS day,
              ${supplierKey('r')} AS "supplierKey", COALESCE(${supplierName('r')}, '(no supplier)') AS "supplierName",
              r.purchaselocation_id AS "locationId", COALESCE(b.name, '') AS "locationName",
              COALESCE(rp.varient_id, rp.product_id)::text AS "productKey", ${productLabel('pr', 'pv')} AS "productName",
              COALESCE(u.abbreviation, u.unit, '') AS uom, COALESCE(rp.quantity, 0)::float AS "rfpaQty",
              r.created_by AS "createdById", COALESCE(${employeeName('e')}, '') AS "createdByName",
              ds."dealSlipNo" AS "dealSlipNo",
              (SELECT COALESCE(SUM(dsp.quantity), 0) FROM deal_slip_product dsp
                WHERE dsp.rfpa_product_id = rp.id AND dsp."isDeleted" = false AND dsp.deal_slip_id = ds.id)::float AS "dsQty",
              gr."grnNos", COALESCE(gr.qty, 0)::float AS "grnQty", COALESCE(gr.kg, 0)::float AS "grnKg",
              (COALESCE(ds."dealSlipCreatedAt", ds."createdAt")::date - r."createdAt"::date) AS "daysToDs",
              (gr.first_at::date - COALESCE(ds."dealSlipCreatedAt", ds."createdAt")::date) AS "daysToGrn"
         FROM rfpa r
         ${docLateral('r', 'rfpa', 'rd')}
         JOIN rfpa_product rp ON rp.rfpa_id = r.id AND rp."isDeleted" = false
         ${supplierJoins('r')}
         LEFT JOIN branches b ON b.id = r.purchaselocation_id
         LEFT JOIN product pr ON pr.id = rp.product_id
         LEFT JOIN "productVarient" pv ON pv.id = rp.varient_id
         LEFT JOIN uom u ON u.id = rp.uom_id
         LEFT JOIN employees e ON e.id = r.created_by
         LEFT JOIN LATERAL (SELECT x.* FROM deal_slips x WHERE x.rfpa_id = r.id AND x."isDeleted" = false
                             ORDER BY x."createdAt" LIMIT 1) ds ON true
         LEFT JOIN LATERAL (
              SELECT string_agg(DISTINCT g."grnNo", ', ') AS "grnNos", SUM(gp.quantity) AS qty, SUM(gp."netWeight") AS kg,
                     MIN(g."createdAt") AS first_at
                FROM grns g
                ${docLateral('g', 'grn', 'gd')}
                JOIN grn_products gp ON gp.grn_id = g.id AND gp."isDeleted" = false
               WHERE g.deal_slip_id = ds.id AND g."isDeleted" = false AND COALESCE(gd.status, '') NOT IN ('Rejected', 'Draft')
                 AND gp.product_id = rp.product_id AND gp.varient_id IS NOT DISTINCT FROM rp.varient_id) gr ON true
        WHERE ${rfpaWhere(sql, p, scope)}${productWhere(sql, p, 'rp')}
        ORDER BY r."createdAt", r."rfpaId"`,
      sql.values,
    );

    const out = rows.map((r: any) => ({
      ...r,
      dayLabel: dayLabel(r.day),
      dealSlipNo: r.dealSlipNo ?? '',
      grnNos: r.grnNos ?? '',
      conversionPct: ratio(num(r.grnQty), num(r.rfpaQty), 100),
      hasDs: r.dealSlipNo ? 1 : 0,
      hasGrn: r.grnNos ? 1 : 0,
      daysToDs: r.dealSlipNo ? num(r.daysToDs) : null,
      daysToGrn: r.grnNos ? num(r.daysToGrn) : null,
    }));

    // Direct GRNs in the same period: bought without an RFPA / Deal Slip.
    const dsql = new Sql();
    const [direct] = await query(
      `SELECT COUNT(DISTINCT g.id)::int AS grns, COALESCE(SUM(gp."netWeight"), 0)::float AS kg
         FROM grns g ${docLateral('g', 'grn')}
         JOIN grn_products gp ON gp.grn_id = g.id AND gp."isDeleted" = false
        WHERE g.deal_slip_id IS NULL AND ${grnWhere(dsql, p, scope, { status: 'all' })}${productWhere(dsql, p, 'gp')}`,
      dsql.values,
    );

    const rfpaCount = new Set(out.map((r) => r.rfpaId)).size;
    const withDs = new Set(out.filter((r) => r.hasDs).map((r) => r.rfpaId)).size;
    const withGrn = new Set(out.filter((r) => r.hasGrn).map((r) => r.rfpaId)).size;
    const sum = (k: string) => out.reduce((s, r: any) => s + num(r[k]), 0);
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'rfpa', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'RFPAs raised', value: rfpaCount, type: 'count' },
        { label: 'Got a Deal Slip', value: ratio(withDs, rfpaCount, 100), type: 'pct', hint: `${withDs} of ${rfpaCount}` },
        { label: 'Got a GRN', value: ratio(withGrn, rfpaCount, 100), type: 'pct', hint: `${withGrn} of ${rfpaCount}` },
        { label: 'RFPA qty received', value: ratio(sum('grnQty'), sum('rfpaQty'), 100), type: 'pct' },
        { label: 'Direct GRNs (no RFPA)', value: num(direct?.grns), type: 'count', hint: `${num(direct?.kg).toFixed(0)} kg` },
      ],
      chart: {
        type: 'bar',
        title: 'Quantity at each step',
        categories: ['RFPA', 'Deal Slip', 'GRN'],
        series: [{ name: 'Quantity', type: 'qty', values: [sum('rfpaQty'), sum('dsQty'), sum('grnQty')] }],
      },
      notes: [
        'Quantities are in each line\'s own unit (RFPA quantity is stored as a whole number). GRN lines are matched to the RFPA line by product and variant.',
        'Direct GRNs count GRNs in the period (complete or in approval) that have no Deal Slip.',
      ],
    };
  },
};
