/**
 * All-vouchers Excel export: every voucher type the user can see, in one workbook.
 *
 * Sheets:
 *   All Vouchers          one row per voucher of any type, with a Voucher Type column
 *   <type> + line sheets  the full per-type sheets, restricted to that type
 *   Voucher Approvals     approval history for all types, with a Voucher Type column
 *
 * Refs carry `kind` (see VOUCHER_KINDS) so each sheet only queries its own table.
 */

import { EntityTarget, ObjectLiteral } from 'typeorm';
import { CashVoucher } from '../multiCashV/entity/mCashVoucher.entity';
import { LPVoucher } from '../labourPaymentV/entity/labourPaymentVoucher.entity';
import { TPVoucher } from '../tranportPaymentV/entity/transportPaymentvoucher.entity';
import { PMPVoucher } from '../paymentMaterialV/entity/packingMaterialVoucher.entity';
import { ExportDefinition, ExportSheet } from '../../excel/export/exportTypes';
import { restrictToKind } from '../../excel/export/exportQuery';
import { approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import { MULTI_CASH_VOUCHER_SHEETS } from '../multiCashV/excel/multiCashVoucher.export';
import { LABOUR_PAYMENT_VOUCHER_SHEETS } from '../labourPaymentV/excel/labourPaymentVoucher.export';
import { TRANSPORT_PAYMENT_VOUCHER_SHEETS } from '../tranportPaymentV/excel/transportPaymentVoucher.export';
import { PACKING_MATERIAL_VOUCHER_SHEETS } from '../paymentMaterialV/excel/packingMaterialVoucher.export';
import {
  VOUCHER_KINDS,
  VOUCHER_TYPE_LABELS,
  VoucherBase,
  joinVoucherCommon,
  voucherIdentityColumns,
  voucherTrailingColumns,
} from './voucherCommon.export';

interface VoucherSource {
  kind: string;
  entity: EntityTarget<ObjectLiteral>;
  /** Amount shown in the summary; transport vouchers pay out `finalPayableAmt`. */
  amountColumn: string;
  sheets: ExportSheet[];
}

const SOURCES: VoucherSource[] = [
  { kind: VOUCHER_KINDS.MULTI_CASH, entity: CashVoucher, amountColumn: 'totalAmt', sheets: MULTI_CASH_VOUCHER_SHEETS },
  { kind: VOUCHER_KINDS.LABOUR_PAYMENT, entity: LPVoucher, amountColumn: 'totalAmt', sheets: LABOUR_PAYMENT_VOUCHER_SHEETS },
  { kind: VOUCHER_KINDS.TRANSPORT_PAYMENT, entity: TPVoucher, amountColumn: 'finalPayableAmt', sheets: TRANSPORT_PAYMENT_VOUCHER_SHEETS },
  { kind: VOUCHER_KINDS.PACKING_MATERIAL, entity: PMPVoucher, amountColumn: 'totalAmt', sheets: PACKING_MATERIAL_VOUCHER_SHEETS },
];

type VoucherSummary = VoucherBase & { voucherType: string; amount: unknown };

const summarySheet = documentHeaderSheet<VoucherSummary>({
  name: 'All Vouchers',
  loadRecords: async (ctx) => {
    const records: VoucherSummary[] = [];
    for (const source of SOURCES) {
      const ids = ctx.refs.filter((ref) => ref.kind === source.kind).map((ref) => ref.id);
      if (!ids.length) continue;
      const qb = ctx.manager.getRepository(source.entity).createQueryBuilder('voucher');
      joinVoucherCommon(qb, 'voucher');
      const vouchers = (await qb.where('voucher.id IN (:...ids)', { ids }).getMany()) as (VoucherBase & ObjectLiteral)[];
      for (const voucher of vouchers) {
        records.push({
          ...voucher,
          voucherType: VOUCHER_TYPE_LABELS[source.kind],
          amount: voucher[source.amountColumn],
        });
      }
    }
    return records;
  },
  columns: [
    { header: 'Voucher Type', maps: 'voucher table', get: (r) => r.record.voucherType },
    ...voucherIdentityColumns<VoucherSummary>('<voucher table>'),
    { header: 'Amount', maps: '<voucher table>.totalAmt / transport_payment_voucher.finalPayableAmt', type: 'amount', get: (r) => r.record.amount },
    ...voucherTrailingColumns<VoucherSummary>('<voucher table>'),
    ...documentColumns<VoucherSummary>(),
  ],
});

export const ALL_VOUCHERS_EXPORT: ExportDefinition = {
  fileStem: 'All_Vouchers',
  sheets: [
    summarySheet,
    ...SOURCES.flatMap((source) => source.sheets.map((sheet) => restrictToKind(source.kind, sheet))),
    approvalSheet({
      name: 'Voucher Approvals',
      numberHeader: 'Voucher No',
      typeHeader: 'Voucher Type',
      sources: SOURCES.map((source) => ({
        entity: source.entity,
        numberColumn: 'voucherNo',
        kind: source.kind,
        typeLabel: VOUCHER_TYPE_LABELS[source.kind],
      })),
    }),
  ],
};
