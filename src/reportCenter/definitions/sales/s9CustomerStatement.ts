import { PartyBlock, ReportDefinition, ReportParams, ReportScope } from '../../reportCenter.types';
import { dayLabel, num, query, round } from '../common';
import { P_COMPANIES, P_DOC_STATUS, P_PERIOD, Sql, docLateral, paymentModeSql, statusCondition } from './salesSql';

const addressLine = (a: string) =>
  `NULLIF(concat_ws(', ', NULLIF(${a}.address1, ''), NULLIF(${a}.address2, ''), NULLIF(${a}.location, ''),
                     NULLIF(${a}.city, ''), NULLIF(${a}.state, ''), NULLIF(${a}.pincode, '')), '')`;

async function party(customerId: string): Promise<PartyBlock> {
  const [c] = await query(
    `SELECT cu.organisation_name AS name, cu.customercode AS code, cu.customer_primary_contact_number AS phone,
            cu.customer_email_primary AS email, ${addressLine('a')} AS address,
            COALESCE(NULLIF(pt."Revision_exposure_limit_amount", 0), NULLIF(pt."initial_exposure_limit_Amount", 0)) AS "limit"
       FROM customers cu
       LEFT JOIN addresses a ON a.id = cu."customerAddressId"
       LEFT JOIN customer_payment_terms pt ON pt.id = cu."paymentTermsId"
      WHERE cu.id = $1`,
    [customerId],
  );
  return {
    title: 'Customer',
    name: c?.name || '(customer not found)',
    lines: [
      c?.address,
      c?.code && `Customer code: ${c.code}`,
      [c?.phone, c?.email].filter(Boolean).join(' · '),
      c?.limit && `Exposure limit: Rs ${Math.round(num(c.limit)).toLocaleString('en-IN')}`,
    ].filter(Boolean),
  };
}

/** Invoices (customer owes more) and payments (owes less) for one customer, up to `to`. */
async function entries(p: ReportParams, scope: ReportScope) {
  const sql = new Sql();
  const invDate = `COALESCE(i."invoiceDate", i."createdAt"::date)`;
  const w = [`i."isDeleted" = false`, statusCondition('d', p.extra.docStatus || 'complete'), `i.customer_id = ${sql.add(p.customerIds[0])}::uuid`];
  if (p.companyIds.length) w.push(`i.company_id = ANY(${sql.add(p.companyIds)}::uuid[])`);
  if (scope.creatorIds) w.push(`i.created_by = ANY(${sql.add(scope.creatorIds)}::uuid[])`);
  const to = sql.add(p.to);
  return query(
    `WITH inv AS (SELECT i.id, i."invoiceNo", d.id AS "documentId", ${invDate} AS dt, i."totalAmount", i.delivery_challan_id
                    FROM invoices i ${docLateral('i', 'final-invoice')} WHERE ${w.join(' AND ')})
     SELECT * FROM (
       SELECT to_char(inv.dt, 'YYYY-MM-DD') AS day, 1 AS seq, inv."invoiceNo" AS ref, inv."documentId",
              'Sale (Final Invoice)' || COALESCE(' - DC ' || dc."challanNo", '') AS particulars,
              COALESCE(inv."totalAmount", 0)::float AS debit, 0::float AS credit
         FROM inv LEFT JOIN delivery_challan_purchase dc ON dc.id = inv.delivery_challan_id
        WHERE inv.dt <= ${to}::date
       UNION ALL
       SELECT to_char(pay.payment_date, 'YYYY-MM-DD'), 2, inv."invoiceNo", inv."documentId",
              'Receipt #' || pay.payment_no || COALESCE(' - ' || ${paymentModeSql('pay.payment_mode')}, '') || COALESCE(' (' || NULLIF(pay.reference_no, '') || ')', ''),
              0, pay.amount::float
         FROM inv JOIN invoice_payments pay ON pay.invoice_id = inv.id AND pay."isDeleted" = false AND pay.voided_at IS NULL
        WHERE pay.payment_date <= ${to}::date
     ) x ORDER BY x.day, x.seq, x.ref`,
    sql.values,
  );
}

/** S9 - running account with one customer for a period: opening, invoices, receipts, closing. */
export const customerStatement: ReportDefinition = {
  key: 'customer-statement',
  code: 'S9',
  title: 'Customer Statement of Account',
  description: 'What is this customer\'s running balance? Opening balance, Final Invoices and receipts for the period with the balance after each entry, the closing balance and the exposure limit.',
  permKey: 'sales-report',
  params: [{ key: 'customer', label: 'Customer', kind: 'customer', required: true }, P_PERIOD, P_COMPANIES, P_DOC_STATUS],
  groupings: [],
  defaultGroupBy: [],
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'particulars', label: 'Particulars', type: 'text', width: 34 },
    { key: 'ref', label: 'Invoice No', type: 'text', width: 16 },
    { key: 'debit', label: 'Invoiced (Rs)', type: 'inr', width: 14, aggregate: { kind: 'sum' } },
    { key: 'credit', label: 'Received (Rs)', type: 'inr', width: 14, aggregate: { kind: 'sum' } },
    { key: 'balance', label: 'Balance due (Rs)', type: 'inr', width: 15 },
  ],
  layout: { orientation: 'portrait', defaultView: 'template' },

  async run(p, scope) {
    const [block, all] = await Promise.all([party(p.customerIds[0]), entries(p, scope)]);
    let opening = 0;
    for (const e of all) if (e.day < p.from) opening += num(e.debit) - num(e.credit);

    let running = opening;
    const rows = all
      .filter((e: any) => e.day >= p.from)
      .map((e: any) => {
        running += num(e.debit) - num(e.credit);
        return { ...e, dayLabel: dayLabel(e.day), debit: num(e.debit) || null, credit: num(e.credit) || null, balance: round(running) };
      });
    const invoiced = rows.reduce((s: number, r: any) => s + num(r.debit), 0);
    const received = rows.reduce((s: number, r: any) => s + num(r.credit), 0);
    const closing = round(running);

    return {
      rows,
      party: block,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'final-invoice', documentId: r.documentId } : undefined),
      opening: { kind: 'opening', level: 0, label: `Opening balance as on ${dayLabel(p.from)}`, cells: { balance: round(opening) } },
      closing: {
        kind: 'closing',
        level: 0,
        label: `Closing balance as on ${dayLabel(p.to)}`,
        cells: { debit: round(invoiced), credit: round(received), balance: closing },
      },
      noGrandTotal: true,
      kpis: [
        { label: 'Opening balance', value: round(opening), type: 'inr' },
        { label: 'Invoiced', value: round(invoiced), type: 'inr' },
        { label: 'Received', value: round(received), type: 'inr' },
        { label: closing >= 0 ? 'Closing balance due' : 'Closing balance (paid in advance)', value: Math.abs(closing), type: 'inr' },
      ],
      chart: null,
      notes: [
        'Invoiced = Final Invoice totals (taxable value + GST + freight and charges − discount). Returns and rejections are already taken off the invoice. Voided receipts are left out.',
      ],
    };
  },
};
