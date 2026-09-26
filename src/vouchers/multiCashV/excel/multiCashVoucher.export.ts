/**
 * Multi Cash Voucher Excel export.
 *
 * Field map (from the entities):
 *   multiple_cash_voucher                -> Multi Cash Voucher sheet
 *   material_for_the_multi_cash_voucher  -> MCV Particulars sheet (ledger lines)
 *   documents + approval_stage_info      -> status columns + Approvals sheet
 */

import { CashVoucher } from '../entity/mCashVoucher.entity';
import { MVItems } from '../entity/mvoucher.entity';
import { ExportDefinition, ExportSheet } from '../../../excel/export/exportTypes';
import { joinSelect } from '../../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
import { auditColumns } from '../../../excel/export/commonColumns';
import { joinVoucherCommon, voucherIdentityColumns, voucherTrailingColumns } from '../../excel/voucherCommon.export';

const TABLE = 'multiple_cash_voucher';

export const MULTI_CASH_VOUCHER_SHEETS: ExportSheet[] = [
  documentHeaderSheet<CashVoucher>({
    name: 'Multi Cash Voucher',
    loadRecords: async (ctx) => {
      const qb = ctx.manager.getRepository(CashVoucher).createQueryBuilder('voucher');
      joinVoucherCommon(qb, 'voucher');
      joinSelect(qb, 'voucher.challanNo', 'challan', ['id', 'challanNo']);
      return qb.where('voucher.id IN (:...ids)', { ids: ctx.ids }).getMany();
    },
    columns: [
      ...voucherIdentityColumns<CashVoucher>(TABLE),
      { header: 'Delivery Challan No', maps: `${TABLE}.challanNo -> delivery_challan_purchase.challanNo`, get: (r: DocumentRow<CashVoucher>) => r.record.challanNo?.challanNo },
      { header: 'Total Amount', maps: `${TABLE}.totalAmt`, type: 'amount', get: (r: DocumentRow<CashVoucher>) => r.record.totalAmt },
      ...voucherTrailingColumns<CashVoucher>(TABLE),
      ...documentColumns<CashVoucher>(),
    ],
  }),
  {
    name: 'MCV Particulars',
    refId: (line: MVItems) => line.cashVoucher?.id,
    load: async (ctx) =>
      ctx.manager
        .getRepository(MVItems)
        .createQueryBuilder('line')
        .innerJoin('line.cashVoucher', 'parent')
        .addSelect(['parent.id', 'parent.voucherNo'])
        .where('parent.id IN (:...ids)', { ids: ctx.ids })
        .orderBy('line.createdAt', 'ASC')
        .getMany(),
    columns: [
      { header: 'Voucher No', maps: `${TABLE}.voucherNo`, get: (l: MVItems) => l.cashVoucher?.voucherNo },
      { header: 'Voucher Record ID', maps: `${TABLE}.id`, get: (l: MVItems) => l.cashVoucher?.id },
      { header: 'Particular ID', maps: 'material_for_the_multi_cash_voucher.id', get: (l: MVItems) => l.id },
      { header: 'Description', maps: 'material_for_the_multi_cash_voucher.description', get: (l: MVItems) => l.description },
      { header: 'Amount', maps: 'material_for_the_multi_cash_voucher.amt', type: 'amount', get: (l: MVItems) => l.amt },
      ...auditColumns<MVItems>((l) => l, 'material_for_the_multi_cash_voucher'),
    ],
  },
];

export const MULTI_CASH_VOUCHER_EXPORT: ExportDefinition = {
  fileStem: 'Multi_Cash_Voucher',
  sheets: [
    ...MULTI_CASH_VOUCHER_SHEETS,
    approvalSheet({ numberHeader: 'Voucher No', sources: [{ entity: CashVoucher, numberColumn: 'voucherNo' }] }),
  ],
};
