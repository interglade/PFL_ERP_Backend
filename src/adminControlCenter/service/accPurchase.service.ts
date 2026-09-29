import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { CacheService } from '../../global/cache.service';
import { TYPES } from '../../types';
import { PartyRow, PurchaseTab } from '../adminControlCenter.types';
import { completedGrnsSql } from './accOverview.service';
import {
  PERIODS,
  TabFilters,
  buildSeries,
  cacheKey,
  cachedTab,
  completeDoc,
  earliestStart,
  nowIst,
  num,
  periodRange,
  round2,
  sqlTs,
} from './accShared.util';

const TREND_METRICS = ['farmerQty', 'vendorQty', 'farmerAmount', 'vendorAmount'] as const;

/** Every GRN falls in exactly one source, so farmer + vendor = total. */
const SOURCE_SQL = `(CASE WHEN docs.source = 'farmer' OR (docs.source IS NULL AND docs.farmer_id IS NOT NULL)
                         THEN 'farmer' ELSE 'vendor' END)`;

/** "location, city" of an address, or '' */
const place = (a: string) =>
  `NULLIF(concat_ws(', ', NULLIF(${a}.location, ''), NULLIF(${a}.city, '')), '')`;

/**
 * Builds the location / company part of a WHERE clause for any document
 * alias, appending its parameters to `params`.
 */
export function scopeWhere(
  filters: TabFilters,
  params: any[],
  cols: { branch: string; company: string },
): string {
  let sql = '';
  if (filters.location) {
    params.push(filters.location);
    sql += ` AND ${cols.branch} = $${params.length}`;
  }
  if (filters.company) {
    params.push(filters.company);
    sql += ` AND ${cols.company} = $${params.length}`;
  }
  return sql;
}

@injectable()
export class AccPurchaseService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {}

  getPurchase(filters: TabFilters, refresh: boolean) {
    return cachedTab(
      this.cacheService,
      cacheKey('purchase', filters.period, filters.location, filters.company),
      refresh,
      () => this.compute(filters),
    );
  }

  private async compute(filters: TabFilters): Promise<PurchaseTab> {
    const now = nowIst();
    const range = periodRange(filters.period, now);

    // GRNs in the selected period, after the location and company filters.
    const params: any[] = [sqlTs(range.start), sqlTs(range.end)];
    const where =
      `AND g."createdAt" >= $1::timestamp AND g."createdAt" < $2::timestamp` +
      scopeWhere(filters, params, { branch: 'g.branch_id', company: 'g.company_id' });
    const docs = `WITH docs AS (${completedGrnsSql(where)})`;

    const [totals, topFarmers, topVendors, vendorCategories, topProducts, voucherSpend, daily] =
      await Promise.all([
        this.dataSource.query(
          `${docs}
           SELECT COUNT(*)::int AS "grnCount", COALESCE(SUM(qty), 0) AS quantity, COALESCE(SUM(amt), 0) AS amount,
                  COALESCE(SUM(qty) FILTER (WHERE ${SOURCE_SQL} = 'farmer'), 0) AS "farmerQty",
                  COALESCE(SUM(amt) FILTER (WHERE ${SOURCE_SQL} = 'farmer'), 0) AS "farmerAmount",
                  COALESCE(SUM(qty) FILTER (WHERE ${SOURCE_SQL} = 'vendor'), 0) AS "vendorQty",
                  COALESCE(SUM(amt) FILTER (WHERE ${SOURCE_SQL} = 'vendor'), 0) AS "vendorAmount"
             FROM docs`,
          params,
        ),
        this.dataSource.query(
          `${docs}
           SELECT f.id::text AS id, concat_ws(' ', f."farmerfName", f."farmerlName") AS name,
                  COALESCE(${place('fa')}, ${place('ra')}, '') AS location,
                  SUM(docs.qty) AS quantity, SUM(docs.amt) AS amount, COUNT(*)::int AS "grnCount",
                  COALESCE(f."primaryMobileNo", '') AS phone
             FROM docs
             JOIN farmer f ON f.id = docs.farmer_id
             LEFT JOIN addresses fa ON fa.id = f."farmAddressId"
             LEFT JOIN addresses ra ON ra.id = f."residensialAddressId"
            WHERE ${SOURCE_SQL} = 'farmer'
            GROUP BY f.id, fa.id, ra.id
            ORDER BY amount DESC
            LIMIT 5`,
          params,
        ),
        this.dataSource.query(
          `${docs}
           SELECT v.id::text AS id, COALESCE(v.company_name, '') AS name,
                  COALESCE(${place('va')}, '') AS location,
                  SUM(docs.qty) AS quantity, SUM(docs.amt) AS amount, COUNT(*)::int AS "grnCount",
                  COALESCE(v.office_contact_number, '') AS phone
             FROM docs
             JOIN vendor v ON v.id = docs.vendor_id
             LEFT JOIN addresses va ON va.id = v.office_address_id
            WHERE ${SOURCE_SQL} = 'vendor'
            GROUP BY v.id, va.id
            ORDER BY amount DESC
            LIMIT 5`,
          params,
        ),
        this.dataSource.query(
          `${docs}
           SELECT COALESCE(vc.id::text, 'uncategorised') AS id, COALESCE(vc.name, 'Uncategorised') AS category,
                  SUM(docs.qty) AS quantity, SUM(docs.amt) AS amount
             FROM docs
             LEFT JOIN vendor v ON v.id = docs.vendor_id
             LEFT JOIN vendor_category vc ON vc.id = v.vendor_category_id
            WHERE ${SOURCE_SQL} = 'vendor'
            GROUP BY vc.id, vc.name
            ORDER BY amount DESC`,
          params,
        ),
        this.dataSource.query(
          `${docs}
           SELECT COALESCE(gp.varient_id, gp.product_id)::text AS id, COALESCE(p.product_name, '') AS product,
                  COALESCE(NULLIF(pv.variety, ''), NULLIF(pv."variantName", ''), '') AS variant,
                  COALESCE(SUM(gp."netWeight"), 0) AS quantity, COALESCE(SUM(gp.amount), 0) AS amount
             FROM docs
             JOIN grn_products gp ON gp.grn_id = docs.id AND gp."isDeleted" = false
             LEFT JOIN product p ON p.id = gp.product_id
             LEFT JOIN "productVarient" pv ON pv.id = gp.varient_id
            GROUP BY gp.product_id, gp.varient_id, p.product_name, pv.variety, pv."variantName"
            ORDER BY amount DESC
            LIMIT 7`,
          params,
        ),
        this.voucherSpend(),
        this.dailyBySource(filters, now),
      ]);

    const t = totals[0] || {};
    const sourceTrends: any = {};
    for (const period of PERIODS) {
      sourceTrends[period] = buildSeries(period, daily, TREND_METRICS, now);
    }

    return {
      totals: {
        grnCount: t.grnCount ?? 0,
        quantity: round2(num(t.quantity)),
        amount: round2(num(t.amount)),
        farmerQty: round2(num(t.farmerQty)),
        farmerAmount: round2(num(t.farmerAmount)),
        vendorQty: round2(num(t.vendorQty)),
        vendorAmount: round2(num(t.vendorAmount)),
        voucherSpend,
      },
      sourceTrends,
      topFarmers: topFarmers.map(partyRow),
      topVendors: topVendors.map(partyRow),
      vendorCategories: vendorCategories.map((r: any) => ({
        id: r.id,
        category: r.category,
        quantity: round2(num(r.quantity)),
        amount: round2(num(r.amount)),
      })),
      topProducts: topProducts.map((r: any) => ({
        id: r.id,
        product: r.product,
        variant: r.variant,
        quantity: round2(num(r.quantity)),
        amount: round2(num(r.amount)),
      })),
    };
  }

  /**
   * Daily farmer/vendor figures from the earliest period start, so all four
   * trend keys come from one query. The period filter does not apply here -
   * the chart follows its own toggle - but location and company do.
   */
  private async dailyBySource(filters: TabFilters, now = nowIst()) {
    const params: any[] = [sqlTs(earliestStart(PERIODS, now))];
    const where =
      `AND g."createdAt" >= $1::timestamp` +
      scopeWhere(filters, params, { branch: 'g.branch_id', company: 'g.company_id' });
    const rows: any[] = await this.dataSource.query(
      `WITH docs AS (${completedGrnsSql(where)})
       SELECT to_char(ts, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(qty) FILTER (WHERE ${SOURCE_SQL} = 'farmer'), 0) AS "farmerQty",
              COALESCE(SUM(qty) FILTER (WHERE ${SOURCE_SQL} = 'vendor'), 0) AS "vendorQty",
              COALESCE(SUM(amt) FILTER (WHERE ${SOURCE_SQL} = 'farmer'), 0) AS "farmerAmount",
              COALESCE(SUM(amt) FILTER (WHERE ${SOURCE_SQL} = 'vendor'), 0) AS "vendorAmount"
         FROM docs
        GROUP BY 1`,
      params,
    );
    return rows;
  }

  /** Approved vouchers of all four kinds, till now, ignoring the filters. */
  private async voucherSpend(): Promise<number> {
    const sum = (table: string, type: string, amountSql: string) =>
      `(SELECT COALESCE(SUM(${amountSql}), 0) FROM ${table} v
         WHERE v."isDeleted" = false AND ${completeDoc('v', type)})`;
    const [row] = await this.dataSource.query(
      `SELECT ${sum('multiple_cash_voucher', 'multi-cash-voucher', 'v."totalAmt"')}
            + ${sum('labour_payment_voucher', 'labor-payment-voucher', 'v."totalAmt"')}
            + ${sum('transport_payment_voucher', 'transport-payment-voucher', 'COALESCE(v."finalPayableAmt", v."totalPayableAmt")')}
            + ${sum('packing_material_payment', 'packaging-material-voucher', 'v."totalAmt"')} AS total`,
    );
    return round2(num(row?.total));
  }
}

function partyRow(r: any): PartyRow {
  return {
    id: r.id,
    name: r.name || '',
    location: r.location || '',
    quantity: round2(num(r.quantity)),
    amount: round2(num(r.amount)),
    grnCount: r.grnCount ?? 0,
    phone: r.phone || '',
  };
}
