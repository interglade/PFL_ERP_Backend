import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { CacheService } from '../../global/cache.service';
import { TYPES } from '../../types';
import { SalesTab } from '../adminControlCenter.types';
import { completedInvoicesSql } from './accOverview.service';
import { scopeWhere } from './accPurchase.service';
import {
  TabFilters,
  cacheKey,
  cachedTab,
  completeDoc,
  dcLineKg,
  nowIst,
  num,
  periodRange,
  round2,
  sqlTs,
} from './accShared.util';

/**
 * Sales tab, built around customer delivery challans and the accepted
 * quantity a final invoice is raised on.
 */
@injectable()
export class AccSalesService {
  constructor(
    @inject(TYPES.DataSource) private readonly dataSource: DataSource,
    @inject(TYPES.CacheService) private readonly cacheService: CacheService,
  ) {}

  getSales(filters: TabFilters, refresh: boolean) {
    return cachedTab(
      this.cacheService,
      cacheKey('sales', filters.period, filters.location, filters.company),
      refresh,
      () => this.compute(filters),
    );
  }

  private async compute(filters: TabFilters): Promise<SalesTab> {
    const range = periodRange(filters.period, nowIst());
    const start = sqlTs(range.start);
    const end = sqlTs(range.end);

    const [challans, invoices, secondSales] = await Promise.all([
      this.challans(filters, start, end),
      this.invoices(filters, start, end),
      this.secondSales(filters, start, end),
    ]);

    return {
      totals: { ...challans, amount: invoices.amount },
      byCategory: invoices.byCategory,
      secondSales,
      topCustomers: invoices.topCustomers,
      topProducts: invoices.topProducts,
    };
  }

  /** Customer DCs in the period: dispatched / accepted / returned / rejected, and what is not yet billed. */
  private async challans(filters: TabFilters, start: string, end: string) {
    const kg = dcLineKg('it');
    const params: any[] = [start, end];
    const where =
      `AND dc."createdAt" >= $1::timestamp AND dc."createdAt" < $2::timestamp` +
      scopeWhere(filters, params, { branch: 'dc.branch_id', company: 'dc.company_id' });

    const [row] = await this.dataSource.query(
      `WITH dcs AS (
         SELECT dc.id, k.dispatched, k.accepted, k.returned, k.rejected, k."acceptedAmount",
                EXISTS (SELECT 1 FROM invoices i
                         WHERE i.delivery_challan_id = dc.id AND i."isDeleted" = false
                           AND NOT EXISTS (SELECT 1 FROM documents rd
                                            WHERE rd.document_type_id = i.id::text AND rd.type = 'final-invoice'
                                              AND rd.status::text IN ('REJECT', 'disapproved'))) AS invoiced
           FROM delivery_challan_purchase dc
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(${kg.dispatched}), 0) AS dispatched,
                    COALESCE(SUM(${kg.accepted}), 0) AS accepted,
                    COALESCE(SUM(${kg.returned}), 0) AS returned,
                    COALESCE(SUM(${kg.rejected}), 0) AS rejected,
                    COALESCE(SUM(${kg.acceptedAmount}), 0) AS "acceptedAmount"
               FROM item it
              WHERE it."deliveryChallanId" = dc.id AND it."isDeleted" = false
           ) k ON true
          WHERE dc.type = 'customer_delivery_challan' AND dc."isDeleted" = false
            AND ${completeDoc('dc', 'DC_TYPE_CUSTOMER')} ${where}
       )
       SELECT COUNT(*)::int AS "dcCount",
              COALESCE(SUM(dispatched), 0) AS "dispatchedQty",
              COALESCE(SUM(accepted), 0) AS "acceptedQty",
              COALESCE(SUM(returned), 0) AS "returnedQty",
              COALESCE(SUM(rejected), 0) AS "rejectedQty",
              COUNT(*) FILTER (WHERE accepted > 0 AND NOT invoiced)::int AS "uninvoicedDcCount",
              COALESCE(SUM(accepted) FILTER (WHERE accepted > 0 AND NOT invoiced), 0) AS "uninvoicedQty",
              COALESCE(SUM("acceptedAmount") FILTER (WHERE accepted > 0 AND NOT invoiced), 0) AS "uninvoicedAmount"
         FROM dcs`,
      params,
    );

    // Round the parts first and derive accepted from them, so the three add
    // up to dispatched exactly after rounding too.
    const dispatchedQty = round2(num(row?.dispatchedQty));
    const returnedQty = round2(num(row?.returnedQty));
    const rejectedQty = round2(num(row?.rejectedQty));
    return {
      dcCount: row?.dcCount ?? 0,
      dispatchedQty,
      acceptedQty: round2(dispatchedQty - returnedQty - rejectedQty),
      returnedQty,
      rejectedQty,
      uninvoicedDcCount: row?.uninvoicedDcCount ?? 0,
      uninvoicedQty: round2(num(row?.uninvoicedQty)),
      uninvoicedAmount: round2(num(row?.uninvoicedAmount)),
    };
  }

  /** Approved final invoices in the period: amount, categories, top customers and products. */
  private async invoices(filters: TabFilters, start: string, end: string) {
    const kg = dcLineKg('it');
    const params: any[] = [start, end];
    const tsSql = `COALESCE(i."invoiceDate"::timestamp, i."createdAt")`;
    const where =
      `AND ${tsSql} >= $1::timestamp AND ${tsSql} < $2::timestamp` +
      scopeWhere(filters, params, { branch: 'i.branch_id', company: 'i.company_id' });
    const docs = `WITH docs AS (${completedInvoicesSql(where)})`;

    const [total, byCategory, topCustomers, topProducts] = await Promise.all([
      this.dataSource.query(`${docs} SELECT COALESCE(SUM(amt), 0) AS amount FROM docs`, params),
      this.dataSource.query(
        `${docs}
         SELECT COALESCE(cc.name, 'Uncategorised') AS category, SUM(docs.amt) AS amount
           FROM docs
           LEFT JOIN customers c ON c.id = docs.customer_id
           LEFT JOIN customer_category cc ON cc.id = c."customerCategoryId"
          GROUP BY cc.id, cc.name
          ORDER BY amount DESC`,
        params,
      ),
      this.dataSource.query(
        `${docs}
         SELECT c.id::text AS id, COALESCE(c.organisation_name, '') AS name, COALESCE(cc.name, '') AS category,
                COUNT(*)::int AS invoices, SUM(docs.qty) AS quantity, SUM(docs.amt) AS amount,
                COALESCE(SUM(docs.amt) FILTER (WHERE docs.unpaid), 0) AS "unpaidAmount",
                COALESCE(c.customer_primary_contact_number, '') AS phone
           FROM docs
           JOIN customers c ON c.id = docs.customer_id
           LEFT JOIN customer_category cc ON cc.id = c."customerCategoryId"
          GROUP BY c.id, cc.name
          ORDER BY amount DESC
          LIMIT 5`,
        params,
      ),
      this.dataSource.query(
        `${docs},
         dcs AS (SELECT DISTINCT delivery_challan_id AS id FROM docs WHERE delivery_challan_id IS NOT NULL)
         SELECT COALESCE(it.varient_id, it.product_id)::text AS id, COALESCE(p.product_name, '') AS product,
                COALESCE(NULLIF(pv.variety, ''), NULLIF(pv."variantName", ''), '') AS variant,
                COALESCE(SUM(${kg.accepted}), 0) AS quantity,
                COALESCE(SUM(${kg.returned}), 0) AS "returnedQty",
                COALESCE(SUM(${kg.acceptedAmount}), 0) AS amount
           FROM dcs
           JOIN item it ON it."deliveryChallanId" = dcs.id AND it."isDeleted" = false
           LEFT JOIN product p ON p.id = it.product_id
           LEFT JOIN "productVarient" pv ON pv.id = it.varient_id
          GROUP BY it.product_id, it.varient_id, p.product_name, pv.variety, pv."variantName"
          ORDER BY amount DESC
          LIMIT 5`,
        params,
      ),
    ]);

    return {
      amount: round2(num(total[0]?.amount)),
      byCategory: byCategory.map((r: any) => ({ category: r.category, amount: round2(num(r.amount)) })),
      topCustomers: topCustomers.map((r: any) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        invoices: r.invoices ?? 0,
        quantity: round2(num(r.quantity)),
        amount: round2(num(r.amount)),
        unpaidAmount: round2(num(r.unpaidAmount)),
        phone: r.phone,
      })),
      topProducts: topProducts.map((r: any) => ({
        id: r.id,
        product: r.product,
        variant: r.variant,
        quantity: round2(num(r.quantity)),
        returnedQty: round2(num(r.returnedQty)),
        amount: round2(num(r.amount)),
      })),
    };
  }

  private async secondSales(filters: TabFilters, start: string, end: string) {
    const params: any[] = [start, end];
    const where =
      `AND ss."saleDate"::timestamp >= $1::timestamp AND ss."saleDate"::timestamp < $2::timestamp` +
      scopeWhere(filters, params, { branch: 'ss.branch_id', company: 'ss.company_id' });
    const [row] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS entries,
              COALESCE(SUM(ss."totalNetWeight"), 0) AS quantity,
              COALESCE(SUM(ss."totalAmt"), 0) AS amount
         FROM second_sale_document ss
        WHERE ss."isDeleted" = false AND ${completeDoc('ss', 'second-sale')} ${where}`,
      params,
    );
    return {
      entries: row?.entries ?? 0,
      quantity: round2(num(row?.quantity)),
      amount: round2(num(row?.amount)),
    };
  }
}
