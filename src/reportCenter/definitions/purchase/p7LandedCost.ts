import { ReportDefinition } from '../../reportCenter.types';
import { dayLabel, monthLabel, num, periodChart, query, ratio, round } from '../common';
import {
  P_COMPANIES,
  P_GRN_STATUS,
  P_LOCATIONS,
  P_PERIOD,
  P_SUPPLIERS,
  Sql,
  dayOf,
  docLateral,
  grnWhere,
  statusCondition,
  supplierJoins,
  supplierKey,
  supplierName,
} from './purchaseSql';

/** Sum of one voucher table against GRN `g`, filtered by the voucher's own approval status. */
const voucherSum = (table: string, docType: string, amountSql: string, mode: string) => `
  (SELECT COALESCE(SUM(${amountSql}), 0) FROM ${table} vo
     ${docLateral('vo', docType, 'vd')}
    WHERE vo.grn_id = g.id AND vo."isDeleted" = false AND ${statusCondition('vd', mode)})::float`;

/** P7 - what a kg really costs: goods + freight + other charges + the four vouchers. */
export const landedCost: ReportDefinition = {
  key: 'landed-cost',
  code: 'P7',
  title: 'Expenses & Landed Cost',
  description: 'What does a kg really cost us? Per GRN: goods value plus freight, other charges and the multi-cash, labour, transport and packing-material vouchers raised against it, giving landed Rs/kg.',
  permKey: 'purchase-report',
  params: [
    P_PERIOD,
    P_COMPANIES,
    P_LOCATIONS,
    P_SUPPLIERS,
    P_GRN_STATUS,
    {
      key: 'voucherStatus',
      label: 'Vouchers counted',
      kind: 'select',
      default: 'complete',
      options: [
        { value: 'complete', label: 'Complete only' },
        { value: 'all', label: 'Complete + in approval' },
      ],
    },
  ],
  groupings: [
    { key: 'locationId', label: 'Location', labelField: 'locationName' },
    { key: 'supplierKey', label: 'Supplier', labelField: 'supplierName' },
    { key: 'month', label: 'Month', labelField: 'monthLabel' },
    { key: 'day', label: 'Date', labelField: 'dayLabel' },
  ],
  defaultGroupBy: ['locationId'],
  allowSummaryOnly: true,
  columns: [
    { key: 'dayLabel', label: 'Date', type: 'date', width: 11 },
    { key: 'grnNo', label: 'GRN No', type: 'text', width: 16 },
    { key: 'supplierName', label: 'Supplier', type: 'text', width: 20 },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 10, aggregate: { kind: 'sum' } },
    { key: 'goods', label: 'Goods value', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'freight', label: 'Freight', type: 'inr', width: 10, aggregate: { kind: 'sum' } },
    { key: 'otherCharges', label: 'Other charges', type: 'inr', width: 10, aggregate: { kind: 'sum' } },
    { key: 'mcVoucher', label: 'Multi-cash', type: 'inr', width: 10, aggregate: { kind: 'sum' } },
    { key: 'labourVoucher', label: 'Labour', type: 'inr', width: 10, aggregate: { kind: 'sum' } },
    { key: 'transportVoucher', label: 'Transport', type: 'inr', width: 10, aggregate: { kind: 'sum' } },
    { key: 'packingVoucher', label: 'Packing material', type: 'inr', width: 10, aggregate: { kind: 'sum' } },
    { key: 'landed', label: 'Landed total', type: 'inr', width: 12, aggregate: { kind: 'sum' } },
    { key: 'goodsRate', label: 'Goods Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'goods', den: 'netKg' } },
    { key: 'landedRate', label: 'Landed Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'landed', den: 'netKg' } },
    { key: 'upliftPct', label: 'Extra cost %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'extras', den: 'goods', scale: 100 } },
    { key: 'locationName', label: 'Location', type: 'text', width: 14, excelOnly: true },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const mode = p.extra.voucherStatus || 'complete';
    const rows = await query(
      `SELECT g.id AS "grnId", d.id AS "documentId", g."grnNo" AS "grnNo",
              ${dayOf('g."createdAt"')} AS day, to_char(g."createdAt", 'YYYY-MM') AS month,
              ${supplierKey('g')} AS "supplierKey", COALESCE(${supplierName('g')}, '(no supplier)') AS "supplierName",
              g.purchaselocation_id AS "locationId", COALESCE(b.name, '') AS "locationName",
              (SELECT COALESCE(SUM(gp."netWeight"), 0) FROM grn_products gp WHERE gp.grn_id = g.id AND gp."isDeleted" = false)::float AS "netKg",
              (SELECT COALESCE(SUM(gp.amount), 0) FROM grn_products gp WHERE gp.grn_id = g.id AND gp."isDeleted" = false)::float AS goods,
              COALESCE(g.freight, 0)::float AS freight, COALESCE(g."otherCharges", 0)::float AS "otherCharges",
              ${voucherSum('multiple_cash_voucher', 'multi-cash-voucher', 'vo."totalAmt"', mode)} AS "mcVoucher",
              ${voucherSum('labour_payment_voucher', 'labor-payment-voucher', 'vo."totalAmt"', mode)} AS "labourVoucher",
              ${voucherSum('transport_payment_voucher', 'transport-payment-voucher', 'COALESCE(vo."finalPayableAmt", vo."totalPayableAmt")', mode)} AS "transportVoucher",
              ${voucherSum('packing_material_payment', 'packaging-material-voucher', 'vo."totalAmt"', mode)} AS "packingVoucher"
         FROM grns g
         ${docLateral('g', 'grn')}
         ${supplierJoins('g')}
         LEFT JOIN branches b ON b.id = g.purchaselocation_id
        WHERE ${grnWhere(sql, p, scope)}
        ORDER BY g."createdAt", g."grnNo"`,
      sql.values,
    );

    const out = rows.map((r: any) => {
      const extras = num(r.freight) + num(r.otherCharges) + num(r.mcVoucher) + num(r.labourVoucher) + num(r.transportVoucher) + num(r.packingVoucher);
      const landed = num(r.goods) + extras;
      return {
        ...r,
        dayLabel: dayLabel(r.day),
        monthLabel: monthLabel(r.month),
        extras: round(extras),
        landed: round(landed),
        goodsRate: ratio(num(r.goods), num(r.netKg)),
        landedRate: ratio(landed, num(r.netKg)),
        upliftPct: ratio(extras, num(r.goods), 100),
      };
    });
    const sum = (k: string) => out.reduce((s, r: any) => s + num(r[k]), 0);
    return {
      rows: out,
      link: (r) => (r.documentId ? { kind: 'document', docType: 'grn', documentId: r.documentId } : undefined),
      kpis: [
        { label: 'Goods value', value: sum('goods'), type: 'inr' },
        { label: 'Extra costs', value: sum('extras'), type: 'inr', higherIsBetter: false },
        { label: 'Goods Rs/kg', value: ratio(sum('goods'), sum('netKg')), type: 'rate' },
        { label: 'Landed Rs/kg', value: ratio(sum('landed'), sum('netKg')), type: 'rate', higherIsBetter: false },
        { label: 'Extra cost on goods', value: ratio(sum('extras'), sum('goods'), 100), type: 'pct', higherIsBetter: false },
      ],
      chart: periodChart(p, out, 'Goods vs extra costs', [
        { name: 'Goods', type: 'inr', value: (r) => num(r.goods) },
        { name: 'Extra costs', type: 'inr', value: (r) => num(r.extras) },
      ]),
      notes: ['Vouchers are counted against the GRN they were raised for. Transport uses the final payable amount (else total payable).'],
    };
  },
};
