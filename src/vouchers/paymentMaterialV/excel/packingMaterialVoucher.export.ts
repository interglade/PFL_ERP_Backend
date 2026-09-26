/**
 * Packing Material Payment Voucher Excel export.
 *
 * Field map (from the entities):
 *   packing_material_payment          -> Packing Material Voucher sheet
 *   material_use_for_packing_voucher  -> PMPV Materials sheet
 *   documents + approval_stage_info   -> status columns + Approvals sheet
 */

import { PMPVoucher } from '../entity/packingMaterialVoucher.entity';
import { Materials } from '../entity/material.entity';
import { ExportDefinition, ExportSheet } from '../../../excel/export/exportTypes';
import { ADDRESS_COLUMNS, UOM_COLUMNS, joinSelect } from '../../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
import { addressColumn, auditColumns, uomColumn } from '../../../excel/export/commonColumns';
import { joinVoucherCommon, voucherIdentityColumns, voucherTrailingColumns } from '../../excel/voucherCommon.export';

const TABLE = 'packing_material_payment';
type Row = DocumentRow<PMPVoucher>;

export const PACKING_MATERIAL_VOUCHER_SHEETS: ExportSheet[] = [
  documentHeaderSheet<PMPVoucher>({
    name: 'Packing Material Voucher',
    loadRecords: async (ctx) => {
      const qb = ctx.manager.getRepository(PMPVoucher).createQueryBuilder('voucher');
      joinVoucherCommon(qb, 'voucher');
      joinSelect(qb, 'voucher.address', 'sellerAddress', ADDRESS_COLUMNS);
      return qb.where('voucher.id IN (:...ids)', { ids: ctx.ids }).getMany();
    },
    columns: [
      ...voucherIdentityColumns<PMPVoucher>(TABLE),
      { header: 'Seller Name', maps: `${TABLE}.sellerName`, get: (r: Row) => r.record.sellerName },
      addressColumn<Row>('Seller Address', (r) => r.record.address, `${TABLE}.address`),
      { header: 'Contact No', maps: `${TABLE}.contactNo`, get: (r: Row) => r.record.contactNo },
      { header: 'Alternate Contact No', maps: `${TABLE}.altContactNo`, get: (r: Row) => r.record.altContactNo },
      { header: 'Purpose', maps: `${TABLE}.purpose`, get: (r: Row) => r.record.purpose },
      { header: 'Total Amount', maps: `${TABLE}.totalAmt`, type: 'amount', get: (r: Row) => r.record.totalAmt },
      { header: 'KYC Done', maps: `${TABLE}.kyc`, type: 'boolean', get: (r: Row) => r.record.kyc },
      ...voucherTrailingColumns<PMPVoucher>(TABLE),
      ...documentColumns<PMPVoucher>(),
    ],
  }),
  {
    name: 'PMPV Materials',
    refId: (line: Materials) => line.pmVoucher?.id,
    load: async (ctx) => {
      const qb = ctx.manager
        .getRepository(Materials)
        .createQueryBuilder('line')
        .innerJoin('line.pmVoucher', 'parent')
        .addSelect(['parent.id', 'parent.voucherNo']);
      joinSelect(qb, 'line.itemUom', 'itemUom', UOM_COLUMNS);
      return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
    },
    columns: [
      { header: 'Voucher No', maps: `${TABLE}.voucherNo`, get: (l: Materials) => l.pmVoucher?.voucherNo },
      { header: 'Voucher Record ID', maps: `${TABLE}.id`, get: (l: Materials) => l.pmVoucher?.id },
      { header: 'Material ID', maps: 'material_use_for_packing_voucher.id', get: (l: Materials) => l.id },
      { header: 'Item Name', maps: 'material_use_for_packing_voucher.itemName', get: (l: Materials) => l.itemName },
      { header: 'Item Quantity', maps: 'material_use_for_packing_voucher.itemQty', type: 'quantity', get: (l: Materials) => l.itemQty },
      uomColumn<Materials>('Item UOM', (l) => l.itemUom, 'material_use_for_packing_voucher.itemUom'),
      { header: 'Rate', maps: 'material_use_for_packing_voucher.rate', type: 'amount', get: (l: Materials) => l.rate },
      { header: 'Amount', maps: 'material_use_for_packing_voucher.amt', type: 'amount', get: (l: Materials) => l.amt },
      ...auditColumns<Materials>((l) => l, 'material_use_for_packing_voucher'),
    ],
  },
];

export const PACKING_MATERIAL_VOUCHER_EXPORT: ExportDefinition = {
  fileStem: 'Packing_Material_Voucher',
  sheets: [
    ...PACKING_MATERIAL_VOUCHER_SHEETS,
    approvalSheet({ numberHeader: 'Voucher No', sources: [{ entity: PMPVoucher, numberColumn: 'voucherNo' }] }),
  ],
};
