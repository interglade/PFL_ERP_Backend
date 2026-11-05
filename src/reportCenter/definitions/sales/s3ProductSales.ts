import { ChartSpec, ReportDefinition } from '../../reportCenter.types';
import { dayLabel, monthLabel, num, planningWeek, ratio, round } from '../common';
import {
  P_COMPANIES,
  P_CUSTOMERS,
  P_DOC_STATUS,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  P_SALES_COUNTED,
  attachCost,
  salesLines,
} from './salesSql';

const bucketOf = (bucket: string, l: any): { key: string; label: string } => {
  if (bucket === 'day') return { key: l.day, label: dayLabel(l.day) };
  if (bucket === 'month') return { key: l.month, label: monthLabel(l.month) };
  return planningWeek(l.day);
};

/** S3 - what sells, where, at what rate and margin: per product and period. */
export const productSalesAnalysis: ReportDefinition = {
  key: 'product-sales-analysis',
  code: 'S3',
  title: 'Product Sales Analysis',
  description: 'What sells, where, and at what rate? Per product and week (or day / month): kg, sales, average / lowest / highest rate, margin per kg, number of customers and the biggest customer\'s share.',
  permKey: 'sales-report',
  params: [
    P_PERIOD,
    {
      key: 'bucket',
      label: 'Period columns',
      kind: 'select',
      default: 'week',
      options: [
        { value: 'week', label: 'Planning week (1-7, 8-14, 15-21, 22-end)' },
        { value: 'day', label: 'Day' },
        { value: 'month', label: 'Month' },
      ],
    },
    P_COMPANIES,
    P_LOCATIONS,
    P_CUSTOMERS,
    P_PRODUCTS,
    P_DOC_STATUS,
    P_SALES_COUNTED,
  ],
  groupings: [
    { key: 'productKey', label: 'Product', labelField: 'productName' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['productKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'periodLabel', label: 'Period', type: 'text', width: 22 },
    { key: 'productName', label: 'Product', type: 'text', width: 18 },
    { key: 'locationName', label: 'Location', type: 'text', width: 14 },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'amount', label: 'Sales (taxable)', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'ratePerKg', label: 'Avg Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'netKg' } },
    { key: 'minRate', label: 'Lowest Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'min' } },
    { key: 'maxRate', label: 'Highest Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'max' } },
    { key: 'marginPerKg', label: 'Margin Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'margin', den: 'costedKg' } },
    { key: 'docs', label: 'Invoices / bills', type: 'count', width: 8, aggregate: { kind: 'sum' } },
    { key: 'customers', label: 'Customers', type: 'count', width: 8 },
    { key: 'topCustomer', label: 'Biggest customer', type: 'text', width: 22 },
    { key: 'topShare', label: 'Its share %', type: 'pct', width: 8 },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const lines = await salesLines(p, scope);
    await attachCost(lines);
    const bucket = p.extra.bucket || 'week';

    const cells = new Map<string, any>();
    for (const l of lines) {
      const b = bucketOf(bucket, l);
      const key = `${l.productKey}|${l.locationId}|${b.key}`;
      const c =
        cells.get(key) ??
        { productKey: l.productKey, productName: l.productName, locationId: l.locationId, locationName: l.locationName,
          periodKey: b.key, periodLabel: b.label, netKg: 0, amount: 0, margin: 0, costedKg: 0,
          minRate: null as number | null, maxRate: null as number | null, docSet: new Set<string>(),
          byCustomer: new Map<string, { name: string; kg: number }>() };
      const kg = num(l.netKg);
      c.netKg += kg;
      c.amount += num(l.amount);
      if (l.margin !== null) {
        c.margin += num(l.margin);
        c.costedKg += kg;
      }
      if (kg > 0) {
        const rate = num(l.amount) / kg;
        c.minRate = c.minRate === null ? rate : Math.min(c.minRate, rate);
        c.maxRate = c.maxRate === null ? rate : Math.max(c.maxRate, rate);
      }
      c.docSet.add(l.docId);
      const s = c.byCustomer.get(l.customerKey) ?? { name: l.customerName, kg: 0 };
      s.kg += kg;
      c.byCustomer.set(l.customerKey, s);
      cells.set(key, c);
    }

    const rows = [...cells.values()]
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
      .map((c) => {
        const top = [...c.byCustomer.values()].sort((a: any, b: any) => b.kg - a.kg)[0];
        return {
          productKey: c.productKey, productName: c.productName, locationId: c.locationId, locationName: c.locationName,
          periodKey: c.periodKey, periodLabel: c.periodLabel,
          netKg: round(c.netKg, 3), amount: round(c.amount), ratePerKg: ratio(c.amount, c.netKg),
          minRate: c.minRate === null ? null : round(c.minRate), maxRate: c.maxRate === null ? null : round(c.maxRate),
          margin: round(c.margin), costedKg: c.costedKg, marginPerKg: c.costedKg ? ratio(c.margin, c.costedKg) : null,
          docs: c.docSet.size, customers: c.byCustomer.size,
          topCustomer: top?.name ?? '', topShare: top ? ratio(top.kg, c.netKg, 100) : 0,
        };
      });

    const kgByProduct = new Map<string, { name: string; kg: number }>();
    for (const r of rows) {
      const x = kgByProduct.get(r.productKey) ?? { name: r.productName, kg: 0 };
      x.kg += r.netKg;
      kgByProduct.set(r.productKey, x);
    }
    const top5 = [...kgByProduct.entries()].sort((a, b) => b[1].kg - a[1].kg).slice(0, 5);
    const periods = [...new Map(rows.map((r) => [r.periodKey, r.periodLabel])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const chart: ChartSpec = {
      type: 'line',
      title: 'Average sale Rs/kg - top 5 products by quantity',
      categories: periods.map(([, label]) => label),
      series: top5.map(([pk, x]) => ({
        name: x.name,
        type: 'rate',
        values: periods.map(([key]) => {
          const rs = rows.filter((r) => r.productKey === pk && r.periodKey === key);
          return ratio(rs.reduce((s, r) => s + r.amount, 0), rs.reduce((s, r) => s + r.netKg, 0));
        }),
      })),
    };

    const kg = rows.reduce((s, r) => s + r.netKg, 0);
    const amt = rows.reduce((s, r) => s + r.amount, 0);
    return {
      rows,
      kpis: [
        { label: 'Products', value: kgByProduct.size, type: 'count' },
        { label: 'Net quantity', value: kg, type: 'kg' },
        { label: 'Sales (taxable)', value: amt, type: 'inr' },
        { label: 'Average Rs/kg', value: ratio(amt, kg), type: 'rate' },
        { label: 'Margin Rs/kg', value: ratio(rows.reduce((s, r) => s + r.margin, 0), rows.reduce((s, r) => s + r.costedKg, 0)), type: 'rate' },
      ],
      chart,
      notes: ['Lowest and highest Rs/kg are per sold line. Margin per kg uses lines with a known cost (batch cost, or GRN rate for direct sales).'],
    };
  },
};
