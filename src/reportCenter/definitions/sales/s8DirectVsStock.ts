import { ReportDefinition } from '../../reportCenter.types';
import { num, ratio } from '../common';
import { salesDocLink } from './s1SalesRegister';
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

/** S8 - how much goes straight from purchase to customer, and at what margin vs selling from stock. */
export const directVsStockSales: ReportDefinition = {
  key: 'direct-vs-stock-sales',
  code: 'S8',
  title: 'Direct vs Stock Sales',
  description: 'How much do we sell straight from a purchase (GRN to customer) versus from CC/DC stock? Kg, sales, cost and margin for each sale type, by product.',
  permKey: 'sales-report',
  params: [P_PERIOD, P_COMPANIES, P_LOCATIONS, P_CUSTOMERS, P_PRODUCTS, P_DOC_STATUS, P_SALES_COUNTED],
  groupings: [
    { key: 'saleType', label: 'Sale type' },
    { key: 'productKey', label: 'Product', labelField: 'productName' },
    { key: 'customerKey', label: 'Customer', labelField: 'customerName' },
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
  ],
  defaultGroupBy: ['saleType', 'productKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'docNo', label: 'Invoice / Bill No', type: 'text', width: 16 },
    { key: 'customerName', label: 'Customer', type: 'text', width: 20 },
    { key: 'productName', label: 'Product', type: 'text', width: 18 },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'amount', label: 'Sales (taxable)', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'ratePerKg', label: 'Sale Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'netKg' } },
    { key: 'cost', label: 'Cost', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'costPerKg', label: 'Cost Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'cost', den: 'costedKg' } },
    { key: 'margin', label: 'Margin', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'marginPct', label: 'Margin %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'margin', den: 'costedAmount', scale: 100 } },
    { key: 'docKind', label: 'Document type', type: 'text', width: 12, excelOnly: true },
    { key: 'dcNo', label: 'DC No', type: 'text', width: 16, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const rows = await salesLines(p, scope);
    await attachCost(rows);
    for (const r of rows) {
      r.ratePerKg = ratio(num(r.amount), num(r.netKg));
      r.costedKg = r.cost === null ? 0 : num(r.netKg);
      r.costPerKg = r.cost === null ? null : ratio(num(r.cost), num(r.netKg));
      r.marginPct = r.cost === null ? null : ratio(num(r.margin), num(r.amount), 100);
    }
    const part = (type: string, k: string) => rows.filter((r) => r.saleType === type).reduce((s, r) => s + num(r[k]), 0);
    const direct = part('Direct (from GRN)', 'netKg');
    const stock = part('From stock', 'netKg');
    return {
      rows,
      link: salesDocLink,
      kpis: [
        { label: 'Direct sales', value: part('Direct (from GRN)', 'amount'), type: 'inr', hint: `${Math.round(direct).toLocaleString('en-IN')} kg` },
        { label: 'Sales from stock', value: part('From stock', 'amount'), type: 'inr', hint: `${Math.round(stock).toLocaleString('en-IN')} kg` },
        { label: 'Direct share of kg', value: ratio(direct, direct + stock, 100), type: 'pct' },
        { label: 'Direct margin %', value: ratio(part('Direct (from GRN)', 'margin'), part('Direct (from GRN)', 'costedAmount'), 100), type: 'pct' },
        { label: 'Stock margin %', value: ratio(part('From stock', 'margin'), part('From stock', 'costedAmount'), 100), type: 'pct' },
      ],
      chart: {
        type: 'bar',
        title: 'Sales and margin by sale type',
        categories: ['Direct (from GRN)', 'From stock'],
        series: [
          { name: 'Sales', type: 'inr', values: [part('Direct (from GRN)', 'amount'), part('From stock', 'amount')] },
          { name: 'Margin', type: 'inr', values: [part('Direct (from GRN)', 'margin'), part('From stock', 'margin')] },
        ],
      },
      notes: [
        'Direct = customer DC with a referred GRN (goods go from the farmer / vendor straight to the customer), costed at that GRN\'s rate per kg. From stock = sold out of CC/DC stock, costed at batch cost from the stock ledger.',
        'Lines with no cost record show a blank cost and are left out of margin %.',
      ],
    };
  },
};
