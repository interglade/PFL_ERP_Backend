import { tsBounds } from '../../engine/params';
import { ReportDefinition } from '../../reportCenter.types';
import { num, query, round } from '../common';
import {
  P_COMPANIES,
  P_LOCATIONS,
  P_PERIOD,
  P_SUPPLIERS,
  Sql,
  docLateral,
  employeeName,
  grnWhere,
  productLabel,
  supplierJoins,
  supplierKey,
  supplierName,
} from './purchaseSql';

/** P8 - which GRN lines were changed after creation, by whom, and what changed. */
export const grnEditHistory: ReportDefinition = {
  key: 'grn-edit-history',
  code: 'P8',
  title: 'GRN Edit History',
  description: 'Which GRNs were changed after creation? Every added, changed or removed line with quantity, rate and weight before and after, the value impact, and who made the change.',
  permKey: 'purchase-report',
  params: [P_PERIOD, P_COMPANIES, P_LOCATIONS, P_SUPPLIERS],
  groupings: [
    { key: 'grnId', label: 'GRN', labelField: 'grnNo' },
    { key: 'modifiedById', label: 'Changed by', labelField: 'modifiedBy' },
    { key: 'supplierKey', label: 'Supplier', labelField: 'supplierName' },
  ],
  defaultGroupBy: ['grnId'],
  allowSummaryOnly: true,
  columns: [
    { key: 'modifiedAt', label: 'Changed on', type: 'text', width: 17 },
    { key: 'grnNo', label: 'GRN No', type: 'text', width: 16 },
    { key: 'version', label: 'Version', type: 'count', width: 6 },
    { key: 'changeType', label: 'Change', type: 'text', width: 9 },
    { key: 'productName', label: 'Product', type: 'text', width: 18 },
    { key: 'oldQty', label: 'Qty before', type: 'qty', width: 9 },
    { key: 'newQty', label: 'Qty after', type: 'qty', width: 9 },
    { key: 'oldRate', label: 'Rate before', type: 'rate', width: 9 },
    { key: 'newRate', label: 'Rate after', type: 'rate', width: 9 },
    { key: 'oldKg', label: 'Net kg before', type: 'kg', width: 10 },
    { key: 'newKg', label: 'Net kg after', type: 'kg', width: 10 },
    { key: 'valueChange', label: 'Value change', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'modifiedBy', label: 'Changed by', type: 'text', width: 16 },
    { key: 'supplierName', label: 'Supplier', type: 'text', width: 20, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const where = grnWhere(sql, p, scope, { period: false, status: 'any' });
    const [start, end] = tsBounds(p.from, p.to);
    const rows = await query(
      `SELECT h.id, g.id AS "grnId", d.id AS "documentId", g."grnNo" AS "grnNo", h.version, initcap(h."changeType") AS "changeType",
              to_char(h."modifiedAt", 'DD Mon YYYY HH12:MI AM') AS "modifiedAt",
              ${supplierKey('g')} AS "supplierKey", COALESCE(${supplierName('g')}, '(no supplier)') AS "supplierName",
              ${productLabel('pr', 'pv')} AS "productName",
              h."oldQuantity"::float AS "oldQty", h."newQuantity"::float AS "newQty",
              h."oldRate"::float AS "oldRate", h."newRate"::float AS "newRate",
              h."oldNetWeight"::float AS "oldKg", h."newNetWeight"::float AS "newKg",
              h.modified_by_id AS "modifiedById", COALESCE(${employeeName('e')}, '') AS "modifiedBy"
         FROM grn_product_history h
         JOIN grns g ON g.id = h.grn_id
         ${docLateral('g', 'grn')}
         ${supplierJoins('g')}
         LEFT JOIN product pr ON pr.id = h.product_id
         LEFT JOIN "productVarient" pv ON pv.id = h.variant_id
         LEFT JOIN employees e ON e.id = h.modified_by_id
        WHERE h."isDeleted" = false
          AND h."modifiedAt" >= ${sql.add(start)}::timestamp AND h."modifiedAt" < ${sql.add(end)}::timestamp
          AND ${where}
        ORDER BY h."modifiedAt", g."grnNo", h.version`,
      sql.values,
    );

    const out = rows.map((r: any) => ({
      ...r,
      valueChange: round(num(r.newQty) * num(r.newRate) - num(r.oldQty) * num(r.oldRate)),
    }));
    const grns = new Set(out.map((r: any) => r.grnId)).size;
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'grn', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'GRNs changed', value: grns, type: 'count', higherIsBetter: false },
        { label: 'Line changes', value: out.length, type: 'count', higherIsBetter: false },
        { label: 'Lines removed', value: out.filter((r: any) => r.changeType === 'Removed').length, type: 'count', higherIsBetter: false },
        { label: 'Net value change', value: out.reduce((s: number, r: any) => s + r.valueChange, 0), type: 'inr' },
      ],
      chart: null,
      notes: ['Value change = quantity × rate after − quantity × rate before, per line. Freight and other charges are not part of line history.'],
    };
  },
};
