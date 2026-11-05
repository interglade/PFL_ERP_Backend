import { ParamSpec, ReportParams, ReportScope } from '../../reportCenter.types';
import { dayLabel, monthLabel, num, query } from '../common';
import { Sql, dayOf, dcFromLocationSql, docLateral, employeeName, paymentModeSql, productLabel, statusCondition } from '../sql';

export { Sql };

// ─── Shared parameter specs ─────────────────────────────────────────────────

export const P_PERIOD: ParamSpec = { key: 'period', label: 'Period', kind: 'dateRange', required: true };
export const P_AS_ON: ParamSpec = { key: 'asOn', label: 'As on', kind: 'date', required: true };
export const P_COMPANIES: ParamSpec = { key: 'companies', label: 'Company', kind: 'companies' };
export const P_LOCATIONS: ParamSpec = { key: 'locations', label: 'Sales location', kind: 'locations' };
export const P_CUSTOMERS: ParamSpec = { key: 'customers', label: 'Customer', kind: 'customers' };
export const P_PRODUCTS: ParamSpec = { key: 'products', label: 'Product', kind: 'products' };
export const P_EMPLOYEES: ParamSpec = { key: 'employees', label: 'Created by', kind: 'employees' };
export const P_DOC_STATUS: ParamSpec = {
  key: 'docStatus',
  label: 'Documents counted',
  kind: 'select',
  default: 'complete',
  options: [
    { value: 'complete', label: 'Complete only' },
    { value: 'all', label: 'Complete + in approval' },
  ],
  help: 'Complete = approval finished. "In approval" adds documents still waiting for an approver. Rejected and draft documents are never counted.',
};
export const P_SALES_COUNTED: ParamSpec = {
  key: 'salesCounted',
  label: 'Sales counted',
  kind: 'select',
  default: 'invoices',
  options: [
    { value: 'invoices', label: 'Final invoices only' },
    { value: 'all', label: 'Final invoices + Other DC (walk-in) + Second sales' },
  ],
  help: 'Other DCs are the bill for walk-in buyers (no Final Invoice is made from them). Second sales resell returned or rejected goods.',
};

// ─── Sales lines ────────────────────────────────────────────────────────────

/** Date / company / location / customer / product / creator / scope conditions, by column names of one source. */
function where(
  sql: Sql,
  p: ReportParams,
  scope: ReportScope,
  c: { date: string; company: string; location: string; customer: string | null; product: string; creator: string | null; status: string },
  opts: { period?: boolean; asOn?: boolean } = {},
): string {
  const w = [statusCondition(c.status, p.extra.docStatus || 'complete')];
  if (opts.period !== false) w.push(`${c.date} BETWEEN ${sql.add(p.from)}::date AND ${sql.add(p.to)}::date`);
  if (opts.asOn) w.push(`${c.date} <= ${sql.add(p.asOn)}::date`);
  if (p.companyIds.length) w.push(`${c.company} = ANY(${sql.add(p.companyIds)}::uuid[])`);
  if (p.locationIds.length) w.push(`${c.location} = ANY(${sql.add(p.locationIds)}::uuid[])`);
  if (p.customerIds.length) w.push(c.customer ? `${c.customer} = ANY(${sql.add(p.customerIds)}::uuid[])` : 'FALSE');
  if (p.productIds.length) w.push(`${c.product} = ANY(${sql.add(p.productIds)}::uuid[])`);
  if (p.employeeIds.length) w.push(c.creator ? `${c.creator} = ANY(${sql.add(p.employeeIds)}::uuid[])` : 'FALSE');
  if (scope.creatorIds) w.push(c.creator ? `${c.creator} = ANY(${sql.add(scope.creatorIds)}::uuid[])` : 'FALSE');
  return w.join(' AND ');
}

/**
 * One row per sold line with everything the sales reports group and total by:
 *  - Final Invoice lines (accepted quantity, kg and amount; invoice GST, freight, other charges
 *    and discount spread over lines in proportion to line amount)
 *  - with "Sales counted = all": Other DC lines (walk-in bills) and Second Sale lines
 * `amount` is the taxable value, `lineTotal` what the customer is billed.
 */
export async function salesLinesSql(sql: Sql, p: ReportParams, scope: ReportScope, opts: { period?: boolean } = {}): Promise<string> {
  const invDate = `COALESCE(i."invoiceDate", i."createdAt"::date)`;
  const share = `(CASE WHEN SUM(ip.amount) OVER (PARTITION BY i.id) > 0 THEN ip.amount / SUM(ip.amount) OVER (PARTITION BY i.id) ELSE 0 END)`;
  const tax = `COALESCE(i."taxAmount", COALESCE(i.cgst, 0) + COALESCE(i.sgst, 0) + COALESCE(i.igst, 0), 0)`;
  const invoices = `
    SELECT 'Final Invoice' AS "docKind", 'final-invoice' AS "linkType", i.id AS "docId", d.id AS "documentId", i."invoiceNo" AS "docNo",
           to_char(${invDate}, 'YYYY-MM-DD') AS day, d.status AS "docStatus", COALESCE(i."ammountStatus"::text, 'Unpaid') AS "paymentStatus",
           'customer:' || i.customer_id::text AS "customerKey", i.customer_id AS "customerId",
           COALESCE(NULLIF(cu.organisation_name, ''), '(no customer)') AS "customerName", 'Registered' AS "customerType",
           i.branch_id AS "locationId", COALESCE(b.name, '') AS "locationName", COALESCE(co.name, '') AS "companyName",
           COALESCE(ip.varient_id, ip.product_id)::text AS "productKey", ip.product_id AS "productId", ip.varient_id AS "variantId",
           ${productLabel('pr', 'pv')} AS "productName", COALESCE(u.abbreviation, u.unit, '') AS uom,
           COALESCE(ip."acceptedQty", ip.quantity, 0)::float AS qty, COALESCE(ip."netWeight", 0)::float AS "netKg",
           COALESCE(ip.amount, 0)::float AS amount,
           (${tax} * ${share})::float AS tax,
           ((COALESCE(i.freight, 0) + COALESCE(i."otherCharges", 0) - COALESCE(i.discount, 0)) * ${share})::float AS charges,
           dc.id AS "dcId", COALESCE(dc."challanNo", '') AS "dcNo",
           (CASE WHEN dc.grn_id IS NOT NULL THEN 'Direct (from GRN)' ELSE 'From stock' END) AS "saleType", dc.grn_id AS "grnId",
           i.created_by AS "createdById", COALESCE(${employeeName('e')}, '') AS "createdByName"
      FROM invoices i
      ${docLateral('i', 'final-invoice')}
      JOIN invoice_products ip ON ip.invoice_id = i.id AND ip."isDeleted" = false
      LEFT JOIN delivery_challan_purchase dc ON dc.id = i.delivery_challan_id
      LEFT JOIN customers cu ON cu.id = i.customer_id
      LEFT JOIN branches b ON b.id = i.branch_id
      LEFT JOIN company co ON co.id = i.company_id
      LEFT JOIN product pr ON pr.id = ip.product_id
      LEFT JOIN "productVarient" pv ON pv.id = ip.varient_id
      LEFT JOIN uom u ON u.id = ip.saleuom_id
      LEFT JOIN employees e ON e.id = i.created_by
     WHERE i."isDeleted" = false
       AND ${where(sql, p, scope, { date: invDate, company: 'i.company_id', location: 'i.branch_id', customer: 'i.customer_id', product: 'ip.product_id', creator: 'i.created_by', status: 'd' }, opts)}`;

  if ((p.extra.salesCounted || 'invoices') !== 'all') return invoices;

  const fromLoc = await dcFromLocationSql('dc');
  const otherDc = `
    SELECT 'Other DC', 'dc-other', dc.id, d.id, dc."challanNo",
           to_char(dc."createdAt", 'YYYY-MM-DD'), d.status, '',
           'walkin:' || lower(trim(COALESCE(dc.other_customer_name, ''))), NULL::uuid,
           COALESCE(NULLIF(trim(dc.other_customer_name), ''), '(walk-in)'), 'Walk-in',
           ${fromLoc}, COALESCE(b.name, ''), COALESCE(co.name, ''),
           COALESCE(it.varient_id, it.product_id)::text, it.product_id, it.varient_id,
           ${productLabel('pr', 'pv')}, COALESCE(u.abbreviation, u.unit, ''),
           COALESCE(it.quantity, 0)::float, COALESCE(it."netWeight", 0)::float, COALESCE(it.amount, 0)::float, 0::float, 0::float,
           dc.id, COALESCE(dc."challanNo", ''), 'From stock', NULL::uuid,
           dc.created_by, COALESCE(${employeeName('e')}, '')
      FROM delivery_challan_purchase dc
      ${docLateral('dc', 'DC_TYPE_OTHER')}
      JOIN item it ON it."deliveryChallanId" = dc.id AND it."isDeleted" = false
      LEFT JOIN branches b ON b.id = ${fromLoc}
      LEFT JOIN company co ON co.id = dc.company_id
      LEFT JOIN product pr ON pr.id = it.product_id
      LEFT JOIN "productVarient" pv ON pv.id = it.varient_id
      LEFT JOIN uom u ON u.id = COALESCE(it.saleuom_id, it.uom_id)
      LEFT JOIN employees e ON e.id = dc.created_by
     WHERE dc."isDeleted" = false AND dc.type = 'other-delivery-challan'
       AND ${where(sql, p, scope, { date: 'dc."createdAt"::date', company: 'dc.company_id', location: fromLoc, customer: null, product: 'it.product_id', creator: 'dc.created_by', status: 'd' }, opts)}`;

  const secondSale = `
    SELECT 'Second Sale', 'second-sale', s.id, d.id, s."secondSaleNo",
           to_char(COALESCE(s."saleDate", s."createdAt"::date), 'YYYY-MM-DD'), d.status, '',
           'walkin:' || lower(trim(COALESCE(s."customerName", ''))), NULL::uuid,
           COALESCE(NULLIF(trim(s."customerName"), ''), '(walk-in)'), 'Walk-in',
           s.branch_id, COALESCE(b.name, ''), COALESCE(co.name, ''),
           COALESCE(sp.varient_id, sp.product_id)::text, sp.product_id, sp.varient_id,
           ${productLabel('pr', 'pv')}, COALESCE(u.abbreviation, u.unit, ''),
           COALESCE(sp.quantity, 0)::float, COALESCE(sp."netWeight", 0)::float, COALESCE(sp.amount, 0)::float, 0::float, 0::float,
           NULL::uuid, '', 'From stock', NULL::uuid,
           sd.last_action_by, COALESCE(${employeeName('e')}, '')
      FROM second_sale_document s
      ${docLateral('s', 'second-sale')}
      -- No creator column on the second sale: its approval document records who raised it
      LEFT JOIN documents sd ON sd.id = d.id
      LEFT JOIN employees e ON e.id = sd.last_action_by
      JOIN second_sale_product sp ON sp.second_sale_register_id = s.id AND sp."isDeleted" = false
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN company co ON co.id = s.company_id
      LEFT JOIN product pr ON pr.id = sp.product_id
      LEFT JOIN "productVarient" pv ON pv.id = sp.varient_id
      LEFT JOIN uom u ON u.id = sp.saleuom_id
     WHERE s."isDeleted" = false
       AND ${where(sql, p, scope, { date: 'COALESCE(s."saleDate", s."createdAt"::date)', company: 's.company_id', location: 's.branch_id', customer: null, product: 'sp.product_id', creator: 'sd.last_action_by', status: 'd' }, opts)}`;

  return `${invoices} UNION ALL ${otherDc} UNION ALL ${secondSale}`;
}

/** Runs salesLinesSql and adds labels and the billed line total. */
export async function salesLines(p: ReportParams, scope: ReportScope, opts: { period?: boolean } = {}) {
  const sql = new Sql();
  const text = await salesLinesSql(sql, p, scope, opts);
  const rows = await query(`SELECT * FROM (${text}) x ORDER BY x.day, x."docNo", x."productName"`, sql.values);
  return rows.map((r: any) => ({
    ...r,
    dayLabel: dayLabel(r.day),
    month: r.day.slice(0, 7),
    monthLabel: monthLabel(r.day.slice(0, 7)),
    lineTotal: num(r.amount) + num(r.tax) + num(r.charges),
  }));
}

/**
 * Cost of goods for sold lines, by kg:
 *  - from stock (customer DC, Other DC, Second Sale): the stock ledger's value out for that
 *    document and product (batch cost), per kg
 *  - direct sale (customer DC with a referred GRN): that GRN's rate per kg for the product
 * Lines with no cost data get cost = null and are left out of margin.
 */
export async function attachCost(lines: any[]): Promise<void> {
  const stockDocs = [...new Set(lines.filter((l) => !l.grnId).map((l) => (l.docKind === 'Second Sale' ? l.docId : l.dcId)).filter(Boolean))];
  const grnIds = [...new Set(lines.map((l) => l.grnId).filter(Boolean))];
  const [ledger, grn] = await Promise.all([
    stockDocs.length
      ? query(
          `SELECT doc_id::text AS doc, product_id::text AS product, COALESCE(variant_id::text, '') AS variant,
                  SUM(value_out)::float AS value, SUM(kg_out)::float AS kg
             FROM stock_ledger
            WHERE doc_id::text = ANY($1::text[]) AND movement_type IN ('DC_CUSTOMER', 'DC_OTHER', 'SECOND_SALE')
            GROUP BY 1, 2, 3`,
          [stockDocs],
        )
      : [],
    grnIds.length
      ? query(
          `SELECT grn_id::text AS grn, product_id::text AS product, COALESCE(varient_id::text, '') AS variant,
                  SUM(amount)::float AS value, SUM("netWeight")::float AS kg
             FROM grn_products WHERE grn_id = ANY($1::uuid[]) AND "isDeleted" = false GROUP BY 1, 2, 3`,
          [grnIds],
        )
      : [],
  ]);

  const perKg = (rows: any[], docKey: string) => {
    const exact = new Map<string, number>();
    const byDoc = new Map<string, { v: number; kg: number }>();
    for (const r of rows) {
      if (num(r.kg) > 0) exact.set(`${r[docKey]}|${r.product}|${r.variant}`, num(r.value) / num(r.kg));
      const t = byDoc.get(r[docKey]) ?? { v: 0, kg: 0 };
      t.v += num(r.value);
      t.kg += num(r.kg);
      byDoc.set(r[docKey], t);
    }
    return (doc: string, product: string, variant: string): number | null => {
      const e = exact.get(`${doc}|${product}|${variant}`);
      if (e !== undefined) return e;
      const t = byDoc.get(doc);
      return t && t.kg > 0 ? t.v / t.kg : null;
    };
  };
  const stockRate = perKg(ledger, 'doc');
  const grnRate = perKg(grn, 'grn');

  for (const l of lines) {
    const variant = l.variantId ? String(l.variantId) : '';
    const rate = l.grnId
      ? grnRate(String(l.grnId), String(l.productId), variant)
      : stockRate(String(l.docKind === 'Second Sale' ? l.docId : l.dcId), String(l.productId), variant);
    l.cost = rate === null ? null : Math.round(rate * num(l.netKg) * 100) / 100;
    l.costedAmount = rate === null ? 0 : num(l.amount);
    l.margin = l.cost === null ? null : Math.round((num(l.amount) - l.cost) * 100) / 100;
  }
}

/** Invoice balance as on a date: total - live payments dated up to then. */
export const invoicePaidSql = (sql: Sql, asOn: string, i = 'i') =>
  `COALESCE((SELECT SUM(ipay.amount) FROM invoice_payments ipay
              WHERE ipay.invoice_id = ${i}.id AND ipay."isDeleted" = false AND ipay.voided_at IS NULL
                AND ipay.payment_date <= ${sql.add(asOn)}::date), 0)`;

export { dayOf, docLateral, employeeName, paymentModeSql, productLabel, statusCondition };
