import { ParamSpec, ReportParams, ReportScope } from '../../reportCenter.types';
import { tsBounds } from '../../engine/params';
import { Sql, dayOf, docLateral, employeeName, paymentModeSql, productLabel, statusCondition } from '../sql';

export { Sql, dayOf, docLateral, employeeName, paymentModeSql, productLabel, statusCondition };

// ─── Shared parameter specs ─────────────────────────────────────────────────

export const P_PERIOD: ParamSpec = { key: 'period', label: 'Period', kind: 'dateRange', required: true };
export const P_AS_ON: ParamSpec = { key: 'asOn', label: 'As on', kind: 'date', required: true };
export const P_COMPANIES: ParamSpec = { key: 'companies', label: 'Company', kind: 'companies' };
export const P_LOCATIONS: ParamSpec = { key: 'locations', label: 'Purchase location', kind: 'locations' };
export const P_SUPPLIERS: ParamSpec = { key: 'suppliers', label: 'Supplier', kind: 'suppliers' };
export const P_PRODUCTS: ParamSpec = { key: 'products', label: 'Product', kind: 'products' };
export const P_EMPLOYEES: ParamSpec = { key: 'employees', label: 'Created by', kind: 'employees' };
export const P_GRN_STATUS: ParamSpec = {
  key: 'grnStatus',
  label: 'GRNs counted',
  kind: 'select',
  default: 'complete',
  options: [
    { value: 'complete', label: 'Complete only' },
    { value: 'all', label: 'Complete + in approval' },
  ],
  help: 'Complete = approval flow finished. "In approval" adds GRNs still with a verifier, approver or finalizer. Rejected and draft GRNs are never counted.',
};

// ─── SQL fragments ──────────────────────────────────────────────────────────

/** Every GRN has exactly one supplier: a farmer when source says so (or only a farmer is set), else a vendor. */
export const isFarmer = (g: string) => `(${g}.source::text = 'farmer' OR (${g}.source IS NULL AND ${g}.farmer_id IS NOT NULL))`;

export const supplierJoins = (g: string) => `
  LEFT JOIN vendor v ON v.id = ${g}.vendor_id
  LEFT JOIN farmer f ON f.id = ${g}.farmer_id`;

export const supplierKey = (g: string) =>
  `(CASE WHEN ${isFarmer(g)} THEN 'farmer:' || ${g}.farmer_id::text ELSE 'vendor:' || ${g}.vendor_id::text END)`;

export const supplierName = (g: string) =>
  `(CASE WHEN ${isFarmer(g)} THEN NULLIF(trim(concat_ws(' ', f."farmerfName", f."farmermName", f."farmerlName")), '')
         ELSE NULLIF(v.company_name, '') END)`;

export const supplierType = (g: string) => `(CASE WHEN ${isFarmer(g)} THEN 'Farmer' ELSE 'Vendor' END)`;

/**
 * WHERE conditions on a GRN alias `g` (its documents lateral is `d`) for the shared filters:
 * period (on GRN date), company, location, supplier, creator, team scope, status mode.
 * Product is a line filter and is applied by the caller where lines are joined.
 */
export function grnWhere(
  sql: Sql,
  p: ReportParams,
  scope: ReportScope,
  opts: { period?: boolean; asOn?: boolean; status?: string } = {},
): string {
  const w: string[] = [`g."isDeleted" = false`, statusCondition('d', opts.status ?? p.extra.grnStatus ?? 'complete')];
  if (opts.period !== false) {
    const [start, end] = tsBounds(p.from, p.to);
    w.push(`g."createdAt" >= ${sql.add(start)}::timestamp AND g."createdAt" < ${sql.add(end)}::timestamp`);
  }
  if (opts.asOn) {
    const [, end] = tsBounds(p.asOn, p.asOn);
    w.push(`g."createdAt" < ${sql.add(end)}::timestamp`);
  }
  if (p.companyIds.length) w.push(`g.company_id = ANY(${sql.add(p.companyIds)}::uuid[])`);
  if (p.locationIds.length) w.push(`g.purchaselocation_id = ANY(${sql.add(p.locationIds)}::uuid[])`);
  if (p.vendorIds.length || p.farmerIds.length) {
    const parts: string[] = [];
    if (p.vendorIds.length) parts.push(`(NOT ${isFarmer('g')} AND g.vendor_id = ANY(${sql.add(p.vendorIds)}::uuid[]))`);
    if (p.farmerIds.length) parts.push(`(${isFarmer('g')} AND g.farmer_id = ANY(${sql.add(p.farmerIds)}::uuid[]))`);
    w.push(`(${parts.join(' OR ')})`);
  }
  if (p.employeeIds.length) w.push(`g.createdby_id = ANY(${sql.add(p.employeeIds)}::uuid[])`);
  if (scope.creatorIds) w.push(`g.createdby_id = ANY(${sql.add(scope.creatorIds)}::uuid[])`);
  return w.join(' AND ');
}

/** Product filter on a line alias (grn_products / rfpa_product ...). */
export function productWhere(sql: Sql, p: ReportParams, line: string): string {
  return p.productIds.length ? ` AND ${line}.product_id = ANY(${sql.add(p.productIds)}::uuid[])` : '';
}

/**
 * One row per GRN line with everything the purchase reports group and total by.
 * Freight and other charges belong to the GRN; they are spread over its lines in
 * proportion to line amount so the line totals add up to the GRN total.
 */
export function purchaseLinesSql(sql: Sql, p: ReportParams, scope: ReportScope, opts: { period?: boolean } = {}): string {
  return `
    SELECT g.id AS "grnId", d.id AS "documentId", d.status AS "grnStatus",
           g."grnNo" AS "grnNo", COALESCE(g."batchNo", '') AS "batchNo",
           ${dayOf('g."createdAt"')} AS day, to_char(g."createdAt", 'YYYY-MM') AS month,
           COALESCE(g."ammountStatus"::text, 'Unpaid') AS "paymentStatus",
           ${supplierKey('g')} AS "supplierKey", COALESCE(${supplierName('g')}, '(no supplier)') AS "supplierName",
           ${supplierType('g')} AS "supplierType",
           g.purchaselocation_id AS "locationId", COALESCE(b.name, '') AS "locationName",
           COALESCE(c.name, '') AS "companyName",
           COALESCE(gp.varient_id, gp.product_id)::text AS "productKey", gp.product_id AS "productId",
           ${productLabel('pr', 'pv')} AS "productName",
           COALESCE(gp.grade, '') AS grade, COALESCE(u.abbreviation, u.unit, '') AS uom,
           COALESCE(gp.quantity, 0)::float AS qty, COALESCE(gp."netWeight", 0)::float AS "netKg",
           COALESCE(gp.amount, 0)::float AS amount,
           (CASE WHEN SUM(gp.amount) OVER (PARTITION BY g.id) > 0
                 THEN (COALESCE(g.freight, 0) + COALESCE(g."otherCharges", 0)) * gp.amount / SUM(gp.amount) OVER (PARTITION BY g.id)
                 ELSE 0 END)::float AS charges,
           g.createdby_id AS "createdById", COALESCE(${employeeName('e')}, '') AS "createdByName"
      FROM grns g
      ${docLateral('g', 'grn')}
      JOIN grn_products gp ON gp.grn_id = g.id AND gp."isDeleted" = false
      ${supplierJoins('g')}
      LEFT JOIN branches b ON b.id = g.purchaselocation_id
      LEFT JOIN company c ON c.id = g.company_id
      LEFT JOIN product pr ON pr.id = gp.product_id
      LEFT JOIN "productVarient" pv ON pv.id = gp.varient_id
      LEFT JOIN uom u ON u.id = gp.uom_id
      LEFT JOIN employees e ON e.id = g.createdby_id
     WHERE ${grnWhere(sql, p, scope, opts)}${productWhere(sql, p, 'gp')}`;
}

/** What a GRN still owes as on a date: total - advance - live payments dated up to then. */
export function grnBalanceSql(sql: Sql, asOn: string, g = 'g'): { paid: string; advance: string } {
  const on = sql.add(asOn);
  return {
    advance: `COALESCE((SELECT pi.advance_paid_amount FROM payment_info_for_grn pi WHERE pi.id = ${g}.payment_info_id), 0)`,
    paid: `COALESCE((SELECT SUM(gpay.amount) FROM grn_payments gpay
                      WHERE gpay.grn_id = ${g}.id AND gpay."isDeleted" = false AND gpay.voided_at IS NULL
                        AND gpay.payment_date <= ${on}::date), 0)`,
  };
}
