import { ReportDefinition, ReportParams, ReportScope, PartyBlock } from '../../reportCenter.types';
import { dayLabel, num, query, round } from '../common';
import { P_COMPANIES, P_GRN_STATUS, P_PERIOD, Sql, docLateral, grnWhere, paymentModeSql } from './purchaseSql';

const addressLine = (a: string) =>
  `NULLIF(concat_ws(', ', NULLIF(${a}.address1, ''), NULLIF(${a}.address2, ''), NULLIF(${a}.location, ''),
                     NULLIF(${a}.city, ''), NULLIF(${a}.state, ''), NULLIF(${a}.pincode, '')), '')`;

async function party(p: ReportParams): Promise<PartyBlock> {
  if (p.vendorIds.length) {
    const [v] = await query(
      `SELECT v.company_name AS name, v.vendor_code AS code, v.gstn, v.office_contact_number AS phone, v.email,
              ${addressLine('a')} AS address
         FROM vendor v LEFT JOIN addresses a ON a.id = v.office_address_id WHERE v.id = $1`,
      [p.vendorIds[0]],
    );
    return {
      title: 'Vendor',
      name: v?.name || '(vendor not found)',
      lines: [v?.address, v?.code && `Vendor code: ${v.code}`, v?.gstn && `GSTIN: ${v.gstn}`, [v?.phone, v?.email].filter(Boolean).join(' · ')].filter(Boolean),
    };
  }
  const [f] = await query(
    `SELECT trim(concat_ws(' ', f."farmerfName", f."farmermName", f."farmerlName")) AS name, f."farmerCode" AS code,
            f."primaryMobileNo" AS phone, ${addressLine('a')} AS address
       FROM farmer f LEFT JOIN addresses a ON a.id = COALESCE(f."residensialAddressId", f."farmAddressId") WHERE f.id = $1`,
    [p.farmerIds[0]],
  );
  return {
    title: 'Farmer',
    name: f?.name || '(farmer not found)',
    lines: [f?.address, f?.code && `Farmer code: ${f.code}`, f?.phone].filter(Boolean),
  };
}

/**
 * Every money movement with one supplier: GRN totals (we owe more), advances and payments
 * (we owe less). Rows dated before `from` make the opening balance.
 */
async function entries(p: ReportParams, scope: ReportScope) {
  const sql = new Sql();
  const where = grnWhere(sql, p, scope, { period: false });
  const to = sql.add(p.to);
  return query(
    `WITH gs AS (SELECT g.id, g."grnNo", d.id AS "documentId", g."createdAt", g."totalAmt", g.payment_info_id
                   FROM grns g ${docLateral('g', 'grn')} WHERE ${where})
     SELECT * FROM (
       SELECT to_char(gs."createdAt", 'YYYY-MM-DD') AS day, 1 AS seq, gs."grnNo" AS ref, gs."documentId",
              'Purchase (GRN)' AS particulars, COALESCE(gs."totalAmt", 0)::float AS purchase, 0::float AS payment
         FROM gs WHERE gs."createdAt"::date <= ${to}::date
       UNION ALL
       SELECT to_char(COALESCE(pi.payment_date, gs."createdAt"::date), 'YYYY-MM-DD'), 2, gs."grnNo", gs."documentId",
              'Advance' || COALESCE(' - ' || NULLIF(pi.payment_mode, ''), ''), 0, pi.advance_paid_amount::float
         FROM gs JOIN payment_info_for_grn pi ON pi.id = gs.payment_info_id
        WHERE COALESCE(pi.advance_paid_amount, 0) > 0 AND COALESCE(pi.payment_date, gs."createdAt"::date) <= ${to}::date
       UNION ALL
       SELECT to_char(gp.payment_date, 'YYYY-MM-DD'), 3, gs."grnNo", gs."documentId",
              'Payment #' || gp.payment_no || COALESCE(' - ' || ${paymentModeSql('gp.payment_mode')}, '') || COALESCE(' (' || NULLIF(gp.reference_no, '') || ')', ''),
              0, gp.amount::float
         FROM gs JOIN grn_payments gp ON gp.grn_id = gs.id AND gp."isDeleted" = false AND gp.voided_at IS NULL
        WHERE gp.payment_date <= ${to}::date
     ) x ORDER BY x.day, x.seq, x.ref`,
    sql.values,
  );
}

/** P9 - running account with one supplier for a period: opening, GRNs, advances, payments, closing. */
export const supplierStatement: ReportDefinition = {
  key: 'supplier-statement',
  code: 'P9',
  title: 'Supplier Statement of Account',
  description: 'What is our running balance with one supplier? Opening balance, GRNs, advances and payments for the period with the balance after each entry, and the closing balance.',
  permKey: 'purchase-report',
  params: [{ key: 'supplier', label: 'Supplier', kind: 'supplier', required: true }, P_PERIOD, P_COMPANIES, P_GRN_STATUS],
  groupings: [],
  defaultGroupBy: [],
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'particulars', label: 'Particulars', type: 'text', width: 30 },
    { key: 'ref', label: 'GRN No', type: 'text', width: 16 },
    { key: 'purchase', label: 'Purchase (Rs)', type: 'inr', width: 14, aggregate: { kind: 'sum' } },
    { key: 'payment', label: 'Paid (Rs)', type: 'inr', width: 14, aggregate: { kind: 'sum' } },
    { key: 'balance', label: 'Balance payable (Rs)', type: 'inr', width: 15 },
  ],
  layout: { orientation: 'portrait', defaultView: 'template' },

  async run(p, scope) {
    const [block, all] = await Promise.all([party(p), entries(p, scope)]);
    let opening = 0;
    for (const e of all) if (e.day < p.from) opening += num(e.purchase) - num(e.payment);

    let running = opening;
    const rows = all
      .filter((e: any) => e.day >= p.from)
      .map((e: any) => {
        running += num(e.purchase) - num(e.payment);
        // Blank rather than 0.00 in the column that does not apply, as on a printed statement.
        return {
          ...e,
          dayLabel: dayLabel(e.day),
          purchase: num(e.purchase) || null,
          payment: num(e.payment) || null,
          balance: round(running),
        };
      });
    const purchases = rows.reduce((s: number, r: any) => s + num(r.purchase), 0);
    const payments = rows.reduce((s: number, r: any) => s + num(r.payment), 0);
    const closing = round(running);

    return {
      rows,
      party: block,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'grn', documentId: r.documentId } : undefined),
      opening: { kind: 'opening', level: 0, label: `Opening balance as on ${dayLabel(p.from)}`, cells: { balance: round(opening) } },
      closing: {
        kind: 'closing',
        level: 0,
        label: `Closing balance as on ${dayLabel(p.to)}`,
        cells: { purchase: round(purchases), payment: round(payments), balance: closing },
      },
      noGrandTotal: true,
      kpis: [
        { label: 'Opening balance', value: round(opening), type: 'inr' },
        { label: 'Purchases', value: round(purchases), type: 'inr' },
        { label: 'Paid', value: round(payments), type: 'inr' },
        { label: closing >= 0 ? 'Closing balance payable' : 'Closing balance (advance with supplier)', value: Math.abs(closing), type: 'inr' },
      ],
      chart: null,
      notes: [
        'Purchases are GRN totals (goods + freight + other charges). Advances are dated by their payment date. Voided payments are left out.',
        'A negative balance means we have paid the supplier more than the GRNs so far (an advance with them).',
      ],
    };
  },
};
