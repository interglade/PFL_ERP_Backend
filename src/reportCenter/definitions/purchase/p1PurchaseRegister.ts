import { ReportDefinition, ReportParams, ReportScope } from '../../reportCenter.types';
import { dayLabel, distinct, monthLabel, num, periodChart, previousParams, query, ratio } from '../common';
import {
  P_COMPANIES,
  P_EMPLOYEES,
  P_GRN_STATUS,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  P_SUPPLIERS,
  Sql,
  purchaseLinesSql,
} from './purchaseSql';

async function lines(p: ReportParams, scope: ReportScope) {
  const sql = new Sql();
  const rows = await query(
    `${purchaseLinesSql(sql, p, scope)} ORDER BY g."createdAt", g."grnNo", "productName"`,
    sql.values,
  );
  return rows.map((r: any) => {
    const amount = num(r.amount);
    const charges = num(r.charges);
    return {
      ...r,
      dayLabel: dayLabel(r.day),
      monthLabel: monthLabel(r.month),
      ratePerKg: ratio(amount, num(r.netKg)),
      charges,
      lineTotal: amount + charges,
    };
  });
}

/** P1 - every purchased line, grouped as the user chooses. Replaces GRN detail + purchase aggregate. */
export const purchaseRegister: ReportDefinition = {
  key: 'purchase-register',
  code: 'P1',
  title: 'Purchase Register',
  description: 'What did we buy? Every GRN line with quantity, rate, amount and charges, grouped by location, supplier, product or date with subtotals.',
  permKey: 'purchase-report',
  params: [P_PERIOD, P_COMPANIES, P_LOCATIONS, P_SUPPLIERS, P_PRODUCTS, P_EMPLOYEES, P_GRN_STATUS],
  groupings: [
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
    { key: 'supplierKey', label: 'Supplier', labelField: 'supplierName' },
    { key: 'supplierType', label: 'Supplier type' },
    { key: 'productKey', label: 'Product', labelField: 'productName' },
    { key: 'day', label: 'Date', labelField: 'dayLabel' },
    { key: 'month', label: 'Month', labelField: 'monthLabel' },
    { key: 'grnId', label: 'GRN', labelField: 'grnNo' },
    { key: 'createdById', label: 'Created by', labelField: 'createdByName' },
  ],
  defaultGroupBy: ['locationId', 'supplierKey'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'grnNo', label: 'GRN No', type: 'text', width: 16 },
    { key: 'batchNo', label: 'Batch', type: 'text', width: 14, excelOnly: true },
    { key: 'supplierName', label: 'Supplier', type: 'text', width: 22 },
    { key: 'supplierType', label: 'Type', type: 'text', width: 8, excelOnly: true },
    { key: 'locationName', label: 'Location', type: 'text', width: 16 },
    { key: 'productName', label: 'Product', type: 'text', width: 20 },
    { key: 'grade', label: 'Grade', type: 'text', width: 8, excelOnly: true },
    { key: 'qty', label: 'Qty', type: 'qty', width: 9 },
    { key: 'uom', label: 'UOM', type: 'text', width: 6 },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 11, aggregate: { kind: 'sum' } },
    { key: 'ratePerKg', label: 'Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'netKg' } },
    { key: 'amount', label: 'Amount', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'charges', label: 'Freight & charges', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'lineTotal', label: 'Total', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'grnStatus', label: 'Status', type: 'text', width: 10 },
    { key: 'paymentStatus', label: 'Payment', type: 'text', width: 9 },
    { key: 'companyName', label: 'Company', type: 'text', width: 18, excelOnly: true },
    { key: 'createdByName', label: 'Created by', type: 'text', width: 16, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const [rows, prev] = await Promise.all([lines(p, scope), lines(previousParams(p), scope)]);
    const sum = (rs: any[], k: string) => rs.reduce((s, r) => s + num(r[k]), 0);
    const kg = sum(rows, 'netKg');
    const prevKg = sum(prev, 'netKg');
    return {
      rows,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'grn', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'GRNs', value: distinct(rows, 'grnId'), type: 'count', previous: distinct(prev, 'grnId') },
        { label: 'Net quantity', value: kg, type: 'kg', previous: prevKg },
        { label: 'Purchase value', value: sum(rows, 'lineTotal'), type: 'inr', previous: sum(prev, 'lineTotal'), higherIsBetter: true },
        { label: 'Average Rs/kg', value: ratio(sum(rows, 'amount'), kg), type: 'rate', previous: ratio(sum(prev, 'amount'), prevKg), higherIsBetter: false },
        { label: 'Suppliers', value: distinct(rows, 'supplierKey'), type: 'count', previous: distinct(prev, 'supplierKey') },
      ],
      chart: periodChart(p, rows, 'Purchase value', [{ name: 'Purchase value', type: 'inr', value: (r) => r.lineTotal }]),
      notes: ['Freight and other charges are spread over each GRN\'s lines in proportion to line amount.'],
    };
  },
};
