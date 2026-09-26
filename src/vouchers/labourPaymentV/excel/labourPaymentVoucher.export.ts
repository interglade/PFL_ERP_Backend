/**
 * Labour Payment Voucher Excel export.
 *
 * Field map (from the entities):
 *   labour_payment_voucher           -> Labour Payment Voucher sheet
 *   documents + approval_stage_info  -> status columns + Approvals sheet
 *
 * A labour voucher has no line table; its products are stored as free text.
 */

import { LPVoucher } from '../entity/labourPaymentVoucher.entity';
import { ExportDefinition, ExportSheet } from '../../../excel/export/exportTypes';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
import { joinVoucherCommon, voucherIdentityColumns, voucherTrailingColumns } from '../../excel/voucherCommon.export';

const TABLE = 'labour_payment_voucher';
type Row = DocumentRow<LPVoucher>;

export const LABOUR_PAYMENT_VOUCHER_SHEETS: ExportSheet[] = [
  documentHeaderSheet<LPVoucher>({
    name: 'Labour Payment Voucher',
    loadRecords: async (ctx) => {
      const qb = ctx.manager.getRepository(LPVoucher).createQueryBuilder('voucher');
      joinVoucherCommon(qb, 'voucher');
      return qb.where('voucher.id IN (:...ids)', { ids: ctx.ids }).getMany();
    },
    columns: [
      ...voucherIdentityColumns<LPVoucher>(TABLE),
      { header: 'Loading Date', maps: `${TABLE}.loadingDate`, type: 'date', get: (r: Row) => r.record.loadingDate },
      { header: 'Products', maps: `${TABLE}.products`, get: (r: Row) => r.record.products },
      { header: 'No Of Labours', maps: `${TABLE}.noOfLabours`, type: 'integer', get: (r: Row) => r.record.noOfLabours },
      { header: 'Rate Per Labour', maps: `${TABLE}.ratePerLabour`, type: 'amount', get: (r: Row) => r.record.ratePerLabour },
      { header: 'Total Amount', maps: `${TABLE}.totalAmt`, type: 'amount', get: (r: Row) => r.record.totalAmt },
      { header: 'Contact No', maps: `${TABLE}.contactNo`, get: (r: Row) => r.record.contactNo },
      { header: 'Alternate Contact No', maps: `${TABLE}.altContactNo`, get: (r: Row) => r.record.altContactNo },
      { header: 'KYC Done', maps: `${TABLE}.kyc`, type: 'boolean', get: (r: Row) => r.record.kyc },
      ...voucherTrailingColumns<LPVoucher>(TABLE),
      ...documentColumns<LPVoucher>(),
    ],
  }),
];

export const LABOUR_PAYMENT_VOUCHER_EXPORT: ExportDefinition = {
  fileStem: 'Labour_Payment_Voucher',
  sheets: [
    ...LABOUR_PAYMENT_VOUCHER_SHEETS,
    approvalSheet({ numberHeader: 'Voucher No', sources: [{ entity: LPVoucher, numberColumn: 'voucherNo' }] }),
  ],
};
