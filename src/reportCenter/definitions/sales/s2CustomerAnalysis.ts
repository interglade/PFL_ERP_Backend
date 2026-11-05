import moment from 'moment-timezone';
import { IST, todayIst } from '../../engine/params';
import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, num, query, ratio, round, topChart } from '../common';
import {
  P_COMPANIES,
  P_CUSTOMERS,
  P_DOC_STATUS,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  P_SALES_COUNTED,
  attachCost,
  docLateral,
  salesLines,
} from './salesSql';

/**
 * Per customer DC: dispatched kg, and returned / rejected kg and value from Returned By Customer
 * (rejected RBCs left out). Per invoice: live payments with amount × days after invoice date,
 * and the balance today.
 */
const RETURNS_SQL = `
  SELECT dc.id::text AS dc,
    (SELECT COALESCE(SUM(it."netWeight"), 0) FROM item it WHERE it."deliveryChallanId" = dc.id AND it."isDeleted" = false)::float AS dispatched,
    (SELECT COALESCE(SUM(rp."returnedNetWt"), 0) FROM return_by_customer r ${docLateral('r', 'return-by-customer', 'rd')}
       JOIN returned_products_by_customer rp ON rp."postReturnId" = r.id AND rp."isDeleted" = false
      WHERE r.delivery_challan_id = dc.id AND r."isDeleted" = false AND COALESCE(rd.status, '') <> 'Rejected')::float AS returned,
    (SELECT COALESCE(SUM(rp."rejectedNetWt"), 0) FROM return_by_customer r ${docLateral('r', 'return-by-customer', 'rd')}
       JOIN returned_products_by_customer rp ON rp."postReturnId" = r.id AND rp."isDeleted" = false
      WHERE r.delivery_challan_id = dc.id AND r."isDeleted" = false AND COALESCE(rd.status, '') <> 'Rejected')::float AS rejected
  FROM delivery_challan_purchase dc WHERE dc.id = ANY($1::uuid[])`;

const PAYMENTS_SQL = `
  SELECT i.id::text AS inv, COALESCE(i."totalAmount", 0)::float AS total,
    (SELECT COALESCE(SUM(pay.amount), 0) FROM invoice_payments pay
      WHERE pay.invoice_id = i.id AND pay."isDeleted" = false AND pay.voided_at IS NULL)::float AS paid,
    (SELECT COALESCE(SUM(pay.amount * GREATEST(pay.payment_date - COALESCE(i."invoiceDate", i."createdAt"::date), 0)), 0) FROM invoice_payments pay
      WHERE pay.invoice_id = i.id AND pay."isDeleted" = false AND pay.voided_at IS NULL)::float AS "paidDays"
  FROM invoices i WHERE i.id = ANY($1::uuid[])`;

/** Last Final Invoice date of each registered customer, up to today (any period). */
const LAST_SALE_SQL = `
  SELECT 'customer:' || i.customer_id::text AS key, MAX(COALESCE(i."invoiceDate", i."createdAt"::date))::text AS last,
         MAX(cu.organisation_name) AS name
    FROM invoices i ${docLateral('i', 'final-invoice')}
    LEFT JOIN customers cu ON cu.id = i.customer_id
   WHERE i."isDeleted" = false AND i.customer_id IS NOT NULL AND COALESCE(d.status, '') NOT IN ('Rejected', 'Draft')
     AND COALESCE(i."invoiceDate", i."createdAt"::date) <= $1::date
   GROUP BY i.customer_id`;

/** S2 - who are our best and worst customers: sales, margin, returns, payment speed, dormancy. */
export const customerAnalysis: ReportDefinition = {
  key: 'customer-analysis',
  code: 'S2',
  title: 'Customer Analysis',
  description: 'Who are our best and worst customers? Sales, rate, margin, return and rejection %, payment days, outstanding and days since the last order, with customers who stopped ordering.',
  permKey: 'sales-report',
  params: [
    P_PERIOD,
    P_COMPANIES,
    P_LOCATIONS,
    P_CUSTOMERS,
    P_PRODUCTS,
    P_DOC_STATUS,
    P_SALES_COUNTED,
    {
      key: 'dormant',
      label: 'Customers listed',
      kind: 'select',
      default: 'active',
      options: [
        { value: 'active', label: 'With sales in the period' },
        { value: 'withDormant', label: 'Also those who bought before but not in the period' },
      ],
    },
  ],
  groupings: [{ key: 'customerType', label: 'Customer type' }],
  defaultGroupBy: [],
  columns: [
    { key: 'rank', label: '#', type: 'count', width: 5 },
    { key: 'customerName', label: 'Customer', type: 'text', width: 24 },
    { key: 'customerType', label: 'Type', type: 'text', width: 9 },
    { key: 'docs', label: 'Invoices / bills', type: 'count', width: 8, aggregate: { kind: 'sum' } },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 11, aggregate: { kind: 'sum' } },
    { key: 'amount', label: 'Sales (taxable)', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'ratePerKg', label: 'Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'netKg' } },
    { key: 'margin', label: 'Gross margin', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'marginPct', label: 'Margin %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'margin', den: 'costedAmount', scale: 100 } },
    { key: 'returnPct', label: 'Returned %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'returnedKg', den: 'dispatchedKg', scale: 100 } },
    { key: 'rejectPct', label: 'Rejected %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'rejectedKg', den: 'dispatchedKg', scale: 100 } },
    { key: 'payDays', label: 'Avg payment days', type: 'days', width: 9, aggregate: { kind: 'ratio', num: 'paidDays', den: 'paid' } },
    { key: 'outstanding', label: 'Outstanding', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'lastSale', label: 'Last invoice', type: 'date', width: 11 },
    { key: 'daysSince', label: 'Days since', type: 'days', width: 7 },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const lines = await salesLines(p, scope);
    await attachCost(lines);

    const dcIds = [...new Set(lines.filter((l) => l.docKind === 'Final Invoice' && l.dcId).map((l) => l.dcId))];
    const invIds = [...new Set(lines.filter((l) => l.docKind === 'Final Invoice').map((l) => l.docId))];
    const today = todayIst();
    const [returns, payments, lastSales] = await Promise.all([
      dcIds.length ? query(RETURNS_SQL, [dcIds]) : [],
      invIds.length ? query(PAYMENTS_SQL, [invIds]) : [],
      query(LAST_SALE_SQL, [today]),
    ]);
    const retOf = new Map(returns.map((r: any) => [r.dc, r]));
    const payOf = new Map(payments.map((r: any) => [r.inv, r]));
    const lastOf = new Map(lastSales.map((r: any) => [r.key, r]));

    const byCustomer = new Map<string, any>();
    const blank = (l: any) => ({
      customerKey: l.customerKey, customerName: l.customerName, customerType: l.customerType,
      docSet: new Set<string>(), dcSet: new Set<string>(), invSet: new Set<string>(), lastLine: '',
      netKg: 0, amount: 0, margin: 0, costedAmount: 0,
    });
    for (const l of lines) {
      const c = byCustomer.get(l.customerKey) ?? blank(l);
      c.docSet.add(l.docId);
      if (l.docKind === 'Final Invoice') {
        c.invSet.add(l.docId);
        if (l.dcId) c.dcSet.add(l.dcId);
      }
      c.netKg += num(l.netKg);
      c.amount += num(l.amount);
      if (l.margin !== null) {
        c.margin += num(l.margin);
        c.costedAmount += num(l.costedAmount);
      }
      if (l.day > c.lastLine) c.lastLine = l.day;
      byCustomer.set(l.customerKey, c);
    }

    // Registered customers who bought before but not in this period.
    if (p.extra.dormant === 'withDormant' && !scope.creatorIds) {
      for (const [key, r] of lastOf) {
        if (byCustomer.has(key) || r.last >= p.from) continue;
        if (p.customerIds.length && !p.customerIds.includes(key.slice('customer:'.length))) continue;
        byCustomer.set(key, { ...blank({ customerKey: key, customerName: r.name, customerType: 'Registered' }) });
      }
    }

    const rows: any[] = [...byCustomer.values()].map((c) => {
      let dispatchedKg = 0, returnedKg = 0, rejectedKg = 0, paid = 0, paidDays = 0, outstanding = 0;
      for (const dc of c.dcSet) {
        const r: any = retOf.get(dc);
        if (!r) continue;
        dispatchedKg += num(r.dispatched);
        returnedKg += num(r.returned);
        rejectedKg += num(r.rejected);
      }
      for (const inv of c.invSet) {
        const x: any = payOf.get(inv);
        if (!x) continue;
        paid += num(x.paid);
        paidDays += num(x.paidDays);
        outstanding += Math.max(num(x.total) - num(x.paid), 0);
      }
      const last = (lastOf.get(c.customerKey) as any)?.last ?? c.lastLine;
      // Blank, not 0, where there is nothing to divide by (e.g. a customer who stopped ordering).
      const rate = (a: number, b: number, scale = 1) => (b ? ratio(a, b, scale) : null);
      return {
        customerKey: c.customerKey, customerName: c.customerName, customerType: c.customerType,
        docs: c.docSet.size, netKg: round(c.netKg, 3), amount: round(c.amount), ratePerKg: rate(c.amount, c.netKg),
        margin: round(c.margin), costedAmount: c.costedAmount, marginPct: rate(c.margin, c.costedAmount, 100),
        dispatchedKg, returnedKg, rejectedKg,
        returnPct: rate(returnedKg, dispatchedKg, 100), rejectPct: rate(rejectedKg, dispatchedKg, 100),
        paid, paidDays, payDays: rate(paidDays, paid), outstanding: round(outstanding),
        lastSale: last ? dayLabel(last) : '',
        daysSince: last ? moment.tz(today, IST).diff(moment.tz(last, IST), 'days') : null,
      };
    });
    rows.sort((a, b) => b.amount - a.amount || (a.daysSince ?? 0) - (b.daysSince ?? 0));
    rows.forEach((r, i) => (r.rank = i + 1));

    const tot = (k: string) => rows.reduce((s, r) => s + num(r[k]), 0);
    const dormant = rows.filter((r) => r.docs === 0).length;
    return {
      rows,
      link: (r) =>
        r.customerKey.startsWith('customer:')
          ? { kind: 'report', report: 'customer-statement', params: { customer: r.customerKey.slice(9), from: p.from, to: p.to }, label: 'Statement' }
          : undefined,
      kpis: [
        { label: 'Customers with sales', value: rows.length - dormant, type: 'count' },
        { label: 'Sales (taxable)', value: tot('amount'), type: 'inr' },
        { label: 'Gross margin %', value: ratio(tot('margin'), tot('costedAmount'), 100), type: 'pct' },
        { label: 'Returned + rejected', value: ratio(tot('returnedKg') + tot('rejectedKg'), tot('dispatchedKg'), 100), type: 'pct', higherIsBetter: false },
        ...(p.extra.dormant === 'withDormant' ? [{ label: 'Stopped ordering', value: dormant, type: 'count' as const, higherIsBetter: false }] : []),
      ],
      chart: topChart(rows.filter((r) => r.amount > 0), 'Top 10 customers by sales', (r) => r.customerName, { name: 'Sales', type: 'inr', value: (r) => r.amount }),
      notes: [
        'Margin = taxable sales − cost of goods: stock sales at batch cost from the stock ledger, direct sales at the referred GRN\'s rate per kg. Lines with no cost record are left out of margin %.',
        'Returned / rejected % come from Returned By Customer against the invoiced DCs (kg). Payment days are amount-weighted days from invoice date to payment. Outstanding is as of today.',
        'Walk-in buyers (Other DC, Second Sale) are grouped by the name written on the bill.',
      ],
    };
  },
};
