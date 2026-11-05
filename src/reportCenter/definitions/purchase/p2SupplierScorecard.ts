import { ReportDefinition } from '../../reportCenter.types';
import { num, query, ratio, round, topChart } from '../common';
import {
  P_COMPANIES,
  P_GRN_STATUS,
  P_LOCATIONS,
  P_PERIOD,
  P_PRODUCTS,
  P_SUPPLIERS,
  Sql,
  docLateral,
  purchaseLinesSql,
} from './purchaseSql';

/**
 * Per-GRN after-purchase facts: AQR received/loss kg, AQR quality split, dumped kg,
 * returned-to-vendor kg, live payments (amount and amount x days after GRN), and balance today.
 * Rejected dumps / RTVs are left out.
 */
const GRN_FACTS_SQL = `
  SELECT g.id AS "grnId",
    (SELECT COALESCE(SUM(ap."receivedQty"), 0) FROM aqr a JOIN aqr_product ap ON ap.aqr_id = a.id AND ap."isDeleted" = false
      WHERE a.grn_id = g.id AND a."isDeleted" = false)::float AS "aqrReceived",
    (SELECT COALESCE(SUM(ap."lossKg"), 0) FROM aqr a JOIN aqr_product ap ON ap.aqr_id = a.id AND ap."isDeleted" = false
      WHERE a.grn_id = g.id AND a."isDeleted" = false)::float AS "aqrLoss",
    (SELECT COALESCE(SUM(q.quantity) FILTER (WHERE q."qualityParameterType" = 'good'), 0) FROM aqr a JOIN aqr_parameter q ON q."aqrId" = a.id AND q."isDeleted" = false
      WHERE a.grn_id = g.id AND a."isDeleted" = false)::float AS "qGood",
    (SELECT COALESCE(SUM(q.quantity), 0) FROM aqr a JOIN aqr_parameter q ON q."aqrId" = a.id AND q."isDeleted" = false
      WHERE a.grn_id = g.id AND a."isDeleted" = false)::float AS "qTotal",
    (SELECT COALESCE(SUM(q.quantity) FILTER (WHERE q."qualityParameterType" = 'bad'), 0) FROM aqr a JOIN aqr_parameter q ON q."aqrId" = a.id AND q."isDeleted" = false
      WHERE a.grn_id = g.id AND a."isDeleted" = false)::float AS "qBad",
    (SELECT COALESCE(SUM(dp."netWeight"), 0) FROM dump_register dr
       ${docLateral('dr', 'dump-register', 'dd2')}
       JOIN dump_product dp ON dp.dump_register_id = dr.id AND dp."isDeleted" = false
      WHERE dr.grn_id = g.id AND dr."isDeleted" = false AND COALESCE(dd2.status, '') <> 'Rejected')::float AS "dumpKg",
    (SELECT COALESCE(SUM(r."returnedNetWeight"), 0) FROM return_to_vendor r
       ${docLateral('r', 'return-to-vendor', 'rd2')}
      WHERE r.grn_id = g.id AND r."isDeleted" = false AND COALESCE(rd2.status, '') <> 'Rejected')::float AS "rtvKg",
    (SELECT COALESCE(SUM(gp.amount), 0) FROM grn_payments gp
      WHERE gp.grn_id = g.id AND gp."isDeleted" = false AND gp.voided_at IS NULL)::float AS paid,
    (SELECT COALESCE(SUM(gp.amount * GREATEST(gp.payment_date - g."createdAt"::date, 0)), 0) FROM grn_payments gp
      WHERE gp.grn_id = g.id AND gp."isDeleted" = false AND gp.voided_at IS NULL)::float AS "paidDays",
    GREATEST(COALESCE(g."totalAmt", 0)
      - COALESCE((SELECT pi.advance_paid_amount FROM payment_info_for_grn pi WHERE pi.id = g.payment_info_id), 0)
      - COALESCE((SELECT SUM(gp.amount) FROM grn_payments gp WHERE gp.grn_id = g.id AND gp."isDeleted" = false AND gp.voided_at IS NULL), 0), 0)::float AS outstanding
  FROM grns g WHERE g.id = ANY($1::uuid[])`;

/** P2 - who are our good suppliers: volume, price vs other suppliers, quality, losses, payment speed. */
export const supplierScorecard: ReportDefinition = {
  key: 'supplier-scorecard',
  code: 'P2',
  title: 'Vendor & Farmer Scorecard',
  description: 'Which suppliers are good? Volume, price compared with other suppliers of the same products, arrival quality, dump and return-to-vendor rates, payment days and outstanding.',
  permKey: 'purchase-report',
  params: [P_PERIOD, P_COMPANIES, P_LOCATIONS, P_SUPPLIERS, P_PRODUCTS, P_GRN_STATUS],
  groupings: [{ key: 'supplierType', label: 'Supplier type' }],
  defaultGroupBy: [],
  columns: [
    { key: 'rank', label: '#', type: 'count', width: 5 },
    { key: 'supplierName', label: 'Supplier', type: 'text', width: 24 },
    { key: 'supplierType', label: 'Type', type: 'text', width: 8 },
    { key: 'grns', label: 'GRNs', type: 'count', width: 7, aggregate: { kind: 'sum' } },
    { key: 'netKg', label: 'Net kg', type: 'kg', width: 11, aggregate: { kind: 'sum' } },
    { key: 'value', label: 'Purchase value', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
    { key: 'ratePerKg', label: 'Rs/kg', type: 'rate', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'netKg' } },
    { key: 'priceIndex', label: 'Price index', type: 'pct', width: 9, aggregate: { kind: 'ratio', num: 'amount', den: 'marketValue', scale: 100 } },
    { key: 'aqrLossPct', label: 'AQR loss %', type: 'pct', width: 9, aggregate: { kind: 'ratio', num: 'aqrLoss', den: 'aqrReceived', scale: 100 } },
    { key: 'goodPct', label: 'Good quality %', type: 'pct', width: 9, aggregate: { kind: 'ratio', num: 'qGood', den: 'qTotal', scale: 100 } },
    { key: 'badPct', label: 'Bad quality %', type: 'pct', width: 9, aggregate: { kind: 'ratio', num: 'qBad', den: 'qTotal', scale: 100 } },
    { key: 'dumpPct', label: 'Dump %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'dumpKg', den: 'netKg', scale: 100 } },
    { key: 'rtvPct', label: 'RTV %', type: 'pct', width: 8, aggregate: { kind: 'ratio', num: 'rtvKg', den: 'netKg', scale: 100 } },
    { key: 'payDays', label: 'Avg payment days', type: 'days', width: 9, aggregate: { kind: 'ratio', num: 'paidDays', den: 'paid' } },
    { key: 'outstanding', label: 'Outstanding', type: 'inr', width: 13, aggregate: { kind: 'sum' } },
  ],
  layout: { orientation: 'landscape', defaultView: 'table' },

  async run(p, scope) {
    const sql = new Sql();
    const lines = await query(purchaseLinesSql(sql, p, scope), sql.values);

    // Market rate per product = all suppliers in the period, ignoring the supplier filter.
    let market = lines;
    if (p.vendorIds.length || p.farmerIds.length) {
      const msql = new Sql();
      market = await query(purchaseLinesSql(msql, { ...p, vendorIds: [], farmerIds: [] }, scope), msql.values);
    }
    const marketRate = new Map<string, { amt: number; kg: number }>();
    for (const l of market) {
      const m = marketRate.get(l.productKey) ?? { amt: 0, kg: 0 };
      m.amt += num(l.amount);
      m.kg += num(l.netKg);
      marketRate.set(l.productKey, m);
    }

    const grnIds = [...new Set(lines.map((l) => l.grnId))];
    const facts = grnIds.length ? await query(GRN_FACTS_SQL, [grnIds]) : [];
    const factOf = new Map(facts.map((f: any) => [f.grnId, f]));

    const bySupplier = new Map<string, any>();
    for (const l of lines) {
      const s =
        bySupplier.get(l.supplierKey) ??
        { supplierKey: l.supplierKey, supplierName: l.supplierName, supplierType: l.supplierType, grnSet: new Set<string>(),
          netKg: 0, amount: 0, charges: 0, marketValue: 0 };
      s.grnSet.add(l.grnId);
      s.netKg += num(l.netKg);
      s.amount += num(l.amount);
      s.charges += num(l.charges);
      const m = marketRate.get(l.productKey);
      s.marketValue += m && m.kg ? num(l.netKg) * (m.amt / m.kg) : num(l.amount);
      bySupplier.set(l.supplierKey, s);
    }

    const rows: any[] = [...bySupplier.values()].map((s) => {
      const f = { aqrReceived: 0, aqrLoss: 0, qGood: 0, qBad: 0, qTotal: 0, dumpKg: 0, rtvKg: 0, paid: 0, paidDays: 0, outstanding: 0 };
      for (const id of s.grnSet) {
        const x: any = factOf.get(id);
        if (!x) continue;
        for (const k of Object.keys(f) as (keyof typeof f)[]) f[k] += num(x[k]);
      }
      return {
        ...s,
        ...f,
        grnSet: undefined,
        grns: s.grnSet.size,
        value: round(s.amount + s.charges),
        ratePerKg: ratio(s.amount, s.netKg),
        priceIndex: ratio(s.amount, s.marketValue, 100),
        aqrLossPct: ratio(f.aqrLoss, f.aqrReceived, 100),
        goodPct: ratio(f.qGood, f.qTotal, 100),
        badPct: ratio(f.qBad, f.qTotal, 100),
        dumpPct: ratio(f.dumpKg, s.netKg, 100),
        rtvPct: ratio(f.rtvKg, s.netKg, 100),
        payDays: ratio(f.paidDays, f.paid),
      };
    });
    rows.sort((a, b) => b.value - a.value);
    rows.forEach((r, i) => (r.rank = i + 1));

    const tot = (k: string) => rows.reduce((s, r: any) => s + num(r[k]), 0);
    return {
      rows,
      link: (r) => ({ kind: 'report', report: 'purchase-register', params: { suppliers: r.supplierKey, groupBy: 'productKey' }, label: 'Purchases' }),
      kpis: [
        { label: 'Suppliers', value: rows.length, type: 'count' },
        { label: 'Purchase value', value: tot('value'), type: 'inr' },
        { label: 'AQR loss', value: ratio(tot('aqrLoss'), tot('aqrReceived'), 100), type: 'pct', higherIsBetter: false },
        { label: 'Dumped', value: ratio(tot('dumpKg'), tot('netKg'), 100), type: 'pct', higherIsBetter: false },
        { label: 'Returned to vendor', value: ratio(tot('rtvKg'), tot('netKg'), 100), type: 'pct', higherIsBetter: false },
      ],
      chart: topChart(rows, 'Top 10 suppliers by purchase value', (r) => r.supplierName, { name: 'Purchase value', type: 'inr', value: (r) => r.value }),
      notes: [
        'Price index: 100 = paid the average rate of all suppliers for the same products in this period; above 100 = paid more.',
        'Quality %, AQR loss, dump and RTV come from the AQR, Dump Register and Return To Vendor documents raised against these GRNs. Payment days are amount-weighted days from GRN date to payment.',
      ],
    };
  },
};
