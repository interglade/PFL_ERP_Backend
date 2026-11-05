import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../types';
import { completedGrnsSql } from '../../adminControlCenter/service/accOverview.service';
import { completeDoc, dcLineKg, Period } from '../../adminControlCenter/service/accShared.util';
import { MyOperation, MyProcurement, MySales } from '../myDashboard.types';
import { myDocumentRows, myRegistrations, num, periodBounds, round2, userLocationIds } from './myShared';

const SOURCE_SQL = `(CASE WHEN docs.source = 'farmer' OR (docs.source IS NULL AND docs.farmer_id IS NOT NULL)
                         THEN 'farmer' ELSE 'vendor' END)`;

/** Completed documents created by the user (documents.last_action_by is the creator). */
const createdBy = (alias: string, type: string, param: string) => `EXISTS (SELECT 1 FROM documents od
    WHERE od.document_type_id = ${alias}.id::text AND od.type = '${type}'
      AND od.last_action_by = ${param} AND od."isDeleted" = false)`;

/**
 * Procurement / Sales / Operation tabs - shown only to users without an
 * approval role, with their own numbers for the selected period.
 */
@injectable()
export class MyDepartmentsService {
  constructor(@inject(TYPES.DataSource) private readonly dataSource: DataSource) {}

  async getProcurement(userId: string, period: Period): Promise<MyProcurement> {
    const [start, end] = periodBounds(period);
    const where = `AND g."createdAt" >= $1::timestamp AND g."createdAt" < $2::timestamp AND ${createdBy('g', 'grn', '$3')}`;

    const voucher = (table: string, type: string, amountSql: string) =>
      `(SELECT COALESCE(SUM(${amountSql}), 0) FROM ${table} v
         WHERE v."isDeleted" = false AND ${completeDoc('v', type)} AND ${createdBy('v', type, '$1')}
           AND v."createdAt" >= $2::timestamp AND v."createdAt" < $3::timestamp)`;

    const [[totals], [spend], documents, registrations] = await Promise.all([
      this.dataSource.query(
        `WITH docs AS (${completedGrnsSql(where)})
         SELECT COUNT(*)::int AS "grnCount", COALESCE(SUM(qty), 0) AS quantity, COALESCE(SUM(amt), 0) AS amount,
                COALESCE(SUM(qty) FILTER (WHERE ${SOURCE_SQL} = 'farmer'), 0) AS "farmerQty",
                COALESCE(SUM(amt) FILTER (WHERE ${SOURCE_SQL} = 'farmer'), 0) AS "farmerAmount",
                COALESCE(SUM(qty) FILTER (WHERE ${SOURCE_SQL} = 'vendor'), 0) AS "vendorQty",
                COALESCE(SUM(amt) FILTER (WHERE ${SOURCE_SQL} = 'vendor'), 0) AS "vendorAmount"
           FROM docs`,
        [start, end, userId],
      ),
      this.dataSource.query(
        `SELECT ${voucher('multiple_cash_voucher', 'multi-cash-voucher', 'v."totalAmt"')}
              + ${voucher('labour_payment_voucher', 'labor-payment-voucher', 'v."totalAmt"')}
              + ${voucher('transport_payment_voucher', 'transport-payment-voucher', 'COALESCE(v."finalPayableAmt", v."totalPayableAmt")')}
              + ${voucher('packing_material_payment', 'packaging-material-voucher', 'v."totalAmt"')} AS total`,
        [userId, start, end],
      ),
      myDocumentRows(
        this.dataSource,
        userId,
        period,
        ['rfpa', 'deal-slip', 'grn', 'multi-cash-voucher', 'labor-payment-voucher', 'transport-payment-voucher', 'packaging-material-voucher'],
        'purchase',
      ),
      myRegistrations(this.dataSource, userId, ['Farmer', 'Vendor']),
    ]);

    return {
      totals: {
        grnCount: totals?.grnCount ?? 0,
        quantity: round2(num(totals?.quantity)),
        amount: round2(num(totals?.amount)),
        farmerQty: round2(num(totals?.farmerQty)),
        farmerAmount: round2(num(totals?.farmerAmount)),
        vendorQty: round2(num(totals?.vendorQty)),
        vendorAmount: round2(num(totals?.vendorAmount)),
        voucherSpend: round2(num(spend?.total)),
      },
      documents,
      registrations,
    };
  }

  async getSales(userId: string, period: Period): Promise<MySales> {
    const [start, end] = periodBounds(period);
    const kg = dcLineKg('it');
    const invoiceTs = `COALESCE(i."invoiceDate"::timestamp, i."createdAt")`;

    const [[dc], [invoice], [second], documents, registrations] = await Promise.all([
      // same figures as the admin Sales tab, for the user's own customer DCs
      this.dataSource.query(
        `WITH dcs AS (
           SELECT dc.id, k.dispatched, k.accepted, k.returned, k.rejected, k."acceptedAmount",
                  EXISTS (SELECT 1 FROM invoices i
                           WHERE i.delivery_challan_id = dc.id AND i."isDeleted" = false
                             AND NOT EXISTS (SELECT 1 FROM documents rd
                                              WHERE rd.document_type_id = i.id::text AND rd.type = 'final-invoice'
                                                AND rd.status::text = 'Rejected')) AS invoiced
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
              AND ${completeDoc('dc', 'DC_TYPE_CUSTOMER')} AND ${createdBy('dc', 'DC_TYPE_CUSTOMER', '$3')}
              AND dc."createdAt" >= $1::timestamp AND dc."createdAt" < $2::timestamp
         )
         SELECT COUNT(*)::int AS "dcCount",
                COALESCE(SUM(dispatched), 0) AS "dispatchedQty",
                COALESCE(SUM(returned), 0) AS "returnedQty",
                COALESCE(SUM(rejected), 0) AS "rejectedQty",
                COUNT(*) FILTER (WHERE accepted > 0 AND NOT invoiced)::int AS "uninvoicedDcCount",
                COALESCE(SUM(accepted) FILTER (WHERE accepted > 0 AND NOT invoiced), 0) AS "uninvoicedQty",
                COALESCE(SUM("acceptedAmount") FILTER (WHERE accepted > 0 AND NOT invoiced), 0) AS "uninvoicedAmount"
           FROM dcs`,
        [start, end, userId],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(i."totalAmount"), 0) AS amount
           FROM invoices i
          WHERE i."isDeleted" = false AND ${completeDoc('i', 'final-invoice')} AND ${createdBy('i', 'final-invoice', '$3')}
            AND ${invoiceTs} >= $1::timestamp AND ${invoiceTs} < $2::timestamp`,
        [start, end, userId],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(ss."totalNetWeight"), 0) AS quantity, COALESCE(SUM(ss."totalAmt"), 0) AS amount
           FROM second_sale_document ss
          WHERE ss."isDeleted" = false AND ${completeDoc('ss', 'second-sale')} AND ${createdBy('ss', 'second-sale', '$3')}
            AND ss."saleDate"::timestamp >= $1::timestamp AND ss."saleDate"::timestamp < $2::timestamp`,
        [start, end, userId],
      ),
      myDocumentRows(this.dataSource, userId, period, ['DC_TYPE_CUSTOMER', 'final-invoice', 'second-sale', 'DC_TYPE_OTHER'], 'sales'),
      myRegistrations(this.dataSource, userId, ['Customer']),
    ]);

    // round the parts first and derive accepted, so they add up to dispatched (as the admin tab does)
    const dispatchedQty = round2(num(dc?.dispatchedQty));
    const returnedQty = round2(num(dc?.returnedQty));
    const rejectedQty = round2(num(dc?.rejectedQty));
    return {
      totals: {
        amount: round2(num(invoice?.amount)),
        dcCount: dc?.dcCount ?? 0,
        dispatchedQty,
        acceptedQty: round2(dispatchedQty - returnedQty - rejectedQty),
        returnedQty,
        rejectedQty,
        uninvoicedDcCount: dc?.uninvoicedDcCount ?? 0,
        uninvoicedQty: round2(num(dc?.uninvoicedQty)),
        uninvoicedAmount: round2(num(dc?.uninvoicedAmount)),
        secondSalesQty: round2(num(second?.quantity)),
        secondSalesAmount: round2(num(second?.amount)),
      },
      documents,
      registrations,
    };
  }

  /** Goods handled at the user's locations, and the operation documents they created. */
  async getOperation(userId: string, period: Period): Promise<MyOperation> {
    const [start, end] = periodBounds(period);
    const locations = await userLocationIds(this.dataSource, userId);

    const kgAt = (header: string, type: string, lines: string, lineFk: string, dateCol: string) =>
      `(SELECT COALESCE(SUM(l."netWeight"), 0)
          FROM ${header} h
          JOIN ${lines} l ON l.${lineFk} = h.id AND l."isDeleted" = false
         WHERE h."isDeleted" = false AND h.branch_id = ANY($1::uuid[]) AND ${completeDoc('h', type)}
           AND h.${dateCol}::timestamp >= $2::timestamp AND h.${dateCol}::timestamp < $3::timestamp)`;

    const [[totals], documents] = await Promise.all([
      locations.length
        ? this.dataSource.query(
            `SELECT (SELECT COALESCE(SUM(l."arrivedQty"), 0)
                       FROM aqr h
                       JOIN aqr_product l ON l.aqr_id = h.id AND l."isDeleted" = false
                      WHERE h."isDeleted" = false AND h.branch_id = ANY($1::uuid[]) AND ${completeDoc('h', 'aqr')}
                        AND COALESCE(h."arrivalDate"::timestamp, h."createdAt") >= $2::timestamp
                        AND COALESCE(h."arrivalDate"::timestamp, h."createdAt") < $3::timestamp) AS received,
                    ${kgAt('inward_register', 'inward-register', '"inwardProduct"', '"inwardRegisterId"', 'date')} AS inward,
                    ${kgAt('dump_register', 'dump-register', 'dump_product', 'dump_register_id', 'date')} AS dumped,
                    ${kgAt('return_to_vendor', 'return-to-vendor', 'return_to_vendor_product', 'return_to_vendor_id', '"returnDate"')} AS "returnedToVendor"`,
            [locations, start, end],
          )
        : Promise.resolve([{}]),
      myDocumentRows(
        this.dataSource,
        userId,
        period,
        ['aqr', 'inward-register', 'dump-register', 'return-to-vendor', 'return-by-customer', 'DC_TYPE_STOCK_TRANSFER'],
        'stock-transfer',
      ),
    ]);

    return {
      totals: {
        received: round2(num(totals?.received)),
        inward: round2(num(totals?.inward)),
        dumped: round2(num(totals?.dumped)),
        returnedToVendor: round2(num(totals?.returnedToVendor)),
      },
      documents,
    };
  }
}
