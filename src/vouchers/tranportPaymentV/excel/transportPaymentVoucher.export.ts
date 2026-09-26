/**
 * Transport Payment Voucher Excel export.
 *
 * Field map (from the entities):
 *   transport_payment_voucher        -> Transport Payment Voucher sheet
 *   products (many-to-many)          -> TPV Products sheet
 *   documents + approval_stage_info  -> status columns + Approvals sheet
 */

import { TPVoucher } from '../entity/transportPaymentvoucher.entity';
import { ExportDefinition, ExportSheet } from '../../../excel/export/exportTypes';
import { CATEGORY_COLUMNS, PRODUCT_COLUMNS, joinSelect } from '../../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
import { joinVoucherCommon, voucherIdentityColumns, voucherTrailingColumns } from '../../excel/voucherCommon.export';

const TABLE = 'transport_payment_voucher';
type Row = DocumentRow<TPVoucher>;
type ProductRow = { voucherId: string; voucherNo: string; product: any };

export const TRANSPORT_PAYMENT_VOUCHER_SHEETS: ExportSheet[] = [
  documentHeaderSheet<TPVoucher>({
    name: 'Transport Payment Voucher',
    loadRecords: async (ctx) => {
      const qb = ctx.manager.getRepository(TPVoucher).createQueryBuilder('voucher');
      joinVoucherCommon(qb, 'voucher');
      joinSelect(qb, 'voucher.products', 'product', ['id', 'name']);
      return qb.where('voucher.id IN (:...ids)', { ids: ctx.ids }).getMany();
    },
    columns: [
      ...voucherIdentityColumns<TPVoucher>(TABLE),
      { header: 'Vehicle No', maps: `${TABLE}.vehicleNo`, get: (r: Row) => r.record.vehicleNo },
      { header: 'Driver Name', maps: `${TABLE}.driverName`, get: (r: Row) => r.record.driverName },
      { header: 'Contact No', maps: `${TABLE}.contactNo`, get: (r: Row) => r.record.contactNo },
      { header: 'Alternate Contact No', maps: `${TABLE}.altContactNo`, get: (r: Row) => r.record.altContactNo },
      { header: 'Dispatch Location', maps: `${TABLE}.dispatchLocation`, get: (r: Row) => r.record.dispatchLocation },
      { header: 'Destination Location', maps: `${TABLE}.destinationLocation`, get: (r: Row) => r.record.destinationLocation },
      { header: 'Products', maps: `${TABLE}.products -> product.name`, get: (r: Row) => (r.record.products ?? []).map((p) => p.name) },
      { header: 'Freight Amount', maps: `${TABLE}.freightAmt`, type: 'amount', get: (r: Row) => r.record.freightAmt },
      { header: 'Decided Amount', maps: `${TABLE}.decidedAmt`, type: 'amount', get: (r: Row) => r.record.decidedAmt },
      { header: 'Actual Amount', maps: `${TABLE}.actualAmt`, type: 'amount', get: (r: Row) => r.record.actualAmt },
      { header: 'Advance Amount', maps: `${TABLE}.advanceAmt`, type: 'amount', get: (r: Row) => r.record.advanceAmt },
      { header: 'Total Payable Amount', maps: `${TABLE}.totalPayableAmt`, type: 'amount', get: (r: Row) => r.record.totalPayableAmt },
      { header: 'Deduction Amount', maps: `${TABLE}.deductionAmt`, type: 'amount', get: (r: Row) => r.record.deductionAmt },
      { header: 'Extra Amount', maps: `${TABLE}.extraAmt`, type: 'amount', get: (r: Row) => r.record.extraAmt },
      { header: 'Final Payable Amount', maps: `${TABLE}.finalPayableAmt`, type: 'amount', get: (r: Row) => r.record.finalPayableAmt },
      { header: 'KYC Done', maps: `${TABLE}.kyc`, type: 'boolean', get: (r: Row) => r.record.kyc },
      ...voucherTrailingColumns<TPVoucher>(TABLE),
      ...documentColumns<TPVoucher>(),
    ],
  }),
  {
    name: 'TPV Products',
    refId: (row: ProductRow) => row.voucherId,
    load: async (ctx) => {
      const qb = ctx.manager
        .getRepository(TPVoucher)
        .createQueryBuilder('voucher')
        .select(['voucher.id', 'voucher.voucherNo'])
        .innerJoin('voucher.products', 'product')
        .addSelect(PRODUCT_COLUMNS.map((c) => `product.${c}`));
      joinSelect(qb, 'product.category', 'category', CATEGORY_COLUMNS);
      const vouchers = await qb.where('voucher.id IN (:...ids)', { ids: ctx.ids }).getMany();
      return vouchers.flatMap((v) => (v.products ?? []).map((product) => ({ voucherId: v.id, voucherNo: v.voucherNo, product })));
    },
    columns: [
      { header: 'Voucher No', maps: `${TABLE}.voucherNo`, get: (r: ProductRow) => r.voucherNo },
      { header: 'Voucher Record ID', maps: `${TABLE}.id`, get: (r: ProductRow) => r.voucherId },
      { header: 'Product ID', maps: 'product.id', get: (r: ProductRow) => r.product?.id },
      { header: 'Product Code', maps: 'product.productCode', get: (r: ProductRow) => r.product?.productCode },
      { header: 'Product Name', maps: 'product.name', get: (r: ProductRow) => r.product?.name },
      { header: 'Category', maps: 'product.category -> product_category.name', get: (r: ProductRow) => r.product?.category?.name },
    ],
  },
];

export const TRANSPORT_PAYMENT_VOUCHER_EXPORT: ExportDefinition = {
  fileStem: 'Transport_Payment_Voucher',
  sheets: [
    ...TRANSPORT_PAYMENT_VOUCHER_SHEETS,
    approvalSheet({ numberHeader: 'Voucher No', sources: [{ entity: TPVoucher, numberColumn: 'voucherNo' }] }),
  ],
};
