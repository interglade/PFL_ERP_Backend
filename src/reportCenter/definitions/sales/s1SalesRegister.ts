import { ReportDefinition, RowLink } from '../../reportCenter.types';
import { distinct, num, periodChart, previousParams, ratio } from '../common';
import {
  P_COMPANIES,
  P_CUSTOMERS,
  P_DOC_STATUS,
  P_EMPLOYEES,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  P_SALES_COUNTED,
  salesLines,
} from './salesSql';

/** Row → the sold document's detail page (invoice, Other DC or Second Sale). */
export const salesDocLink = (r: Record<string, any>): RowLink | undefined =>
  r.documentId ? { kind: 'document', docType: r.linkType, documentId: r.documentId } : undefined;

/** S1 - every sold line, grouped as the user chooses. Replaces the sales aggregate and DC / invoice detail reports. */
export const salesRegister: ReportDefinition = {
  key: 'sales-register',
  code: 'S1',
  title: 'Sales Register',
  description: 'What did we sell? Every Final Invoice line with accepted quantity, rate, taxable value, GST and charges, grouped by location, customer, product or date with subtotals.',
  permKey: 'sales-report',
  params: [P_PERIOD, P_COMPANIES, P_LOCATIONS, P_CUSTOMERS, P_PRODUCTS, P_EMPLOYEES, P_DOC_STATUS, P_SALES_COUNTED],
  groupings: [
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
    { key: 'customerKey', label: 'Customer', labelField: 'customerName' },
    { key: 'customerType', label: 'Customer type' },
    { key: 'productKey', label: 'Product', labelField: 'productName' },
    { key: 'day', label: 'Date', labelField: 'dayLabel' },
    { key: 'month', label: 'Month', labelField: 'monthLabel' },
    { key: 'docId', label: 'Document', labelField: 'docNo' },
    { key: 'saleType', label: 'Sale type' },
    { key: 'docKind', label: 'Document type' },
    { key: 'createdById', label: 'Created by', labelField: 'createdByName' },
  ],
  defaultGroupBy: ['locationId', 'customerKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'docNo', label: 'Invoice / Bill No', type: 'text', width: 16 },
    { key: 'dcNo', label: 'DC No', type: 'text', width: 16 },
    { key: 'customerName', label: 'Customer', type: 'text', width: 22 },
    { key: 'locationName', label: 'Location', type: 'text', width: 14 },
    { key: 'productName', label: 'Product', type: 'text', width: 18 },
    { key: 'qty', label: 'Qty', type: 'qty', width: 9 },
    { key: 'uom', label: 'UOM', type: 'text', width: 6 },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'ratePerKg', label: 'Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'netKg' } },
    { key: 'amount', label: 'Taxable value', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'tax', label: 'GST', type: 'inr', width: 10, aggregate: { kind: 'sum' } },
    { key: 'charges', label: 'Freight & other − discount', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'lineTotal', label: 'Total', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'docStatus', label: 'Status', type: 'text', width: 10 },
    { key: 'paymentStatus', label: 'Payment', type: 'text', width: 9 },
    { key: 'docKind', label: 'Document type', type: 'text', width: 12, excelOnly: true },
    { key: 'saleType', label: 'Sale type', type: 'text', width: 16, excelOnly: true },
    { key: 'companyName', label: 'Company', type: 'text', width: 18, excelOnly: true },
    { key: 'createdByName', label: 'Created by', type: 'text', width: 16, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const [rows, prev] = await Promise.all([salesLines(p, scope), salesLines(previousParams(p), scope)]);
    for (const r of rows) r.ratePerKg = ratio(num(r.amount), num(r.netKg));
    const sum = (rs: any[], k: string) => rs.reduce((s, r) => s + num(r[k]), 0);
    return {
      rows,
      link: salesDocLink,
      kpis: [
        { label: 'Documents', value: distinct(rows, 'docId'), type: 'count', previous: distinct(prev, 'docId') },
        { label: 'Net quantity', value: sum(rows, 'netKg'), type: 'kg', previous: sum(prev, 'netKg') },
        { label: 'Sales (taxable)', value: sum(rows, 'amount'), type: 'inr', previous: sum(prev, 'amount') },
        { label: 'Billed (incl. GST & charges)', value: sum(rows, 'lineTotal'), type: 'inr', previous: sum(prev, 'lineTotal') },
        { label: 'Average Rs/kg', value: ratio(sum(rows, 'amount'), sum(rows, 'netKg')), type: 'rate', previous: ratio(sum(prev, 'amount'), sum(prev, 'netKg')) },
        { label: 'Customers', value: distinct(rows, 'customerKey'), type: 'count', previous: distinct(prev, 'customerKey') },
      ],
      chart: periodChart(p, rows, 'Sales (taxable)', [{ name: 'Sales', type: 'inr', value: (r) => num(r.amount) }]),
      notes: [
        'Final Invoice lines carry the accepted quantity (returns and rejections are already taken off). Invoice GST, freight, other charges and discount are spread over its lines in proportion to line amount.',
        'Dated by invoice date (Other DC by DC date, Second Sale by sale date).',
      ],
    };
  },
};
