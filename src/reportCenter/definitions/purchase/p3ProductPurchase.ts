import { ChartSpec, ReportDefinition } from '../../reportCenter.types';
import { dayLabel, monthLabel, num, planningWeek, query, ratio, round } from '../common';
import {
  P_COMPANIES,
  P_GRN_STATUS,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  P_SUPPLIERS,
  Sql,
  purchaseLinesSql,
} from './purchaseSql';

const bucketOf = (bucket: string, l: any): { key: string; label: string } => {
  if (bucket === 'day') return { key: l.day, label: dayLabel(l.day) };
  if (bucket === 'month') return { key: l.month, label: monthLabel(l.month) };
  return planningWeek(l.day);
};

/** P3 - what we buy, from where, at what rate: per product and period. */
export const productPurchaseAnalysis: ReportDefinition = {
  key: 'product-purchase-analysis',
  code: 'P3',
  title: 'Product Purchase Analysis',
  description: 'What are we buying, where, and at what rate? Per product and week (or day / month): kg, value, average / lowest / highest rate, number of suppliers and the biggest supplier\'s share.',
  permKey: 'purchase-report',
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
    P_SUPPLIERS,
    P_PRODUCTS,
    P_GRN_STATUS,
  ],
  groupings: [
    { key: 'productKey', label: 'Product', labelField: 'productName' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['productKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'periodLabel', label: 'Period', type: 'text', width: 22 },
    { key: 'productName', label: 'Product', type: 'text', width: 20 },
    { key: 'locationName', label: 'Location', type: 'text', width: 16 },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 11, aggregate: { kind: 'sum' } },
    { key: 'amount', label: 'Amount', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'ratePerKg', label: 'Avg Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'netKg' } },
    { key: 'minRate', label: 'Lowest Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'min' } },
    { key: 'maxRate', label: 'Highest Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'max' } },
    { key: 'grns', label: 'GRNs', type: 'count', width: 7, aggregate: { kind: 'sum' } },
    { key: 'suppliers', label: 'Suppliers', type: 'count', width: 8 },
    { key: 'topSupplier', label: 'Biggest supplier', type: 'text', width: 22 },
    { key: 'topShare', label: 'Its share %', type: 'pct', width: 8 },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const lines = await query(`${purchaseLinesSql(sql, p, scope)} ORDER BY g."createdAt"`, sql.values);
    const bucket = p.extra.bucket || 'week';

    const cells = new Map<string, any>();
    for (const l of lines) {
      const b = bucketOf(bucket, l);
      const key = `${l.productKey}|${l.locationId}|${b.key}`;
      const c =
        cells.get(key) ??
        { productKey: l.productKey, productName: l.productName, locationId: l.locationId, locationName: l.locationName,
          periodKey: b.key, periodLabel: b.label, netKg: 0, amount: 0, minRate: null as number | null, maxRate: null as number | null,
          grnSet: new Set<string>(), bySupplier: new Map<string, { name: string; kg: number }>() };
      const kg = num(l.netKg);
      c.netKg += kg;
      c.amount += num(l.amount);
      if (kg > 0) {
        const rate = num(l.amount) / kg;
        c.minRate = c.minRate === null ? rate : Math.min(c.minRate, rate);
        c.maxRate = c.maxRate === null ? rate : Math.max(c.maxRate, rate);
      }
      c.grnSet.add(l.grnId);
      const s = c.bySupplier.get(l.supplierKey) ?? { name: l.supplierName, kg: 0 };
      s.kg += kg;
      c.bySupplier.set(l.supplierKey, s);
      cells.set(key, c);
    }

    const rows = [...cells.values()]
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey))
      .map((c) => {
        const top = [...c.bySupplier.values()].sort((a: any, b: any) => b.kg - a.kg)[0];
        return {
          productKey: c.productKey, productName: c.productName, locationId: c.locationId, locationName: c.locationName,
          periodKey: c.periodKey, periodLabel: c.periodLabel,
          netKg: round(c.netKg, 3), amount: round(c.amount), ratePerKg: ratio(c.amount, c.netKg),
          minRate: c.minRate === null ? null : round(c.minRate), maxRate: c.maxRate === null ? null : round(c.maxRate),
          grns: c.grnSet.size, suppliers: c.bySupplier.size,
          topSupplier: top?.name ?? '', topShare: top ? ratio(top.kg, c.netKg, 100) : 0,
        };
      });

    // Average rate trend of the five products bought most (by kg).
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
      title: 'Average Rs/kg - top 5 products by quantity',
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
        { label: 'Amount', value: amt, type: 'inr' },
        { label: 'Average Rs/kg', value: ratio(amt, kg), type: 'rate' },
      ],
      chart,
      notes: ['Lowest and highest Rs/kg are per GRN line. "Biggest supplier" is by kg within the row.'],
    };
  },
};
