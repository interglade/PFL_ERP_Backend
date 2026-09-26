/**
 * Dump Register Excel export: header, dumped items and approval history.
 *
 * Field map (from the entities):
 *   dump_register            -> Dump Register sheet
 *   dump_product             -> Dump Items sheet
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * Dump reasons are not stored as a column; `dumpType` and `remark` carry them.
 */

import { DumpRegister } from '../entity/dumpRegister.entity';
import { DumpProduct } from '../entity/dumpProduct.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import { BRANCH_COLUMNS, COMPANY_COLUMNS, USER_COLUMNS, joinProductLine, joinSelect } from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  auditColumns,
  branchColumn,
  companyColumns,
  productColumns,
  uomColumn,
  userColumns,
} from '../../excel/export/commonColumns';

type Row = DocumentRow<DumpRegister>;

export const DUMP_REGISTER_EXPORT: ExportDefinition = {
  fileStem: 'Dump_Register',
  sheets: [
    documentHeaderSheet<DumpRegister>({
      name: 'Dump Register',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(DumpRegister).createQueryBuilder('dump');
        joinSelect(qb, 'dump.deliveryChallanNo', 'challan', ['id', 'challanNo']);
        joinSelect(qb, 'dump.rbcNo', 'rbc', ['id', 'rbcNo']);
        joinSelect(qb, 'dump.grn', 'grn', ['id', 'grnNo']);
        joinSelect(qb, 'dump.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'dump.location', 'location', BRANCH_COLUMNS);
        joinSelect(qb, 'dump.requestedBy', 'requestedBy', USER_COLUMNS);
        return qb.where('dump.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Dump No', maps: 'dump_register.dumpNo', get: (r) => r.record.dumpNo },
        { header: 'Dump Record ID', maps: 'dump_register.id', get: (r) => r.record.id },
        { header: 'Dump Type', maps: 'dump_register.dumpType', get: (r) => r.record.dumpType },
        { header: 'Dump Date', maps: 'dump_register.date', type: 'date', get: (r) => r.record.date },
        { header: 'Batch No', maps: 'dump_register.batchNo', get: (r) => r.record.batchNo },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Location', (r) => r.record.location, 'dump_register.location'),
        { header: 'GRN No', maps: 'dump_register.grn -> grns.grnNo', get: (r) => r.record.grn?.grnNo },
        { header: 'Delivery Challan No', maps: 'dump_register.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
        { header: 'Return By Customer No', maps: 'dump_register.rbcNo -> return_by_customer.rbcNo', get: (r) => r.record.rbcNo?.rbcNo },
        { header: 'Total Dump Qty', maps: 'dump_register.totalQty', type: 'quantity', get: (r) => r.record.totalQty },
        { header: 'Total Dump Cost', maps: 'dump_register.totalDumpCost', type: 'amount', get: (r) => r.record.totalDumpCost },
        { header: 'Total Cost In Words', maps: 'dump_register.totalCostInWords', get: (r) => r.record.totalCostInWords },
        { header: 'Remark', maps: 'dump_register.remark', get: (r) => r.record.remark },
        ...userColumns<Row>('Requested By', (r) => r.record.requestedBy, 'dump_register.requestedBy'),
        ...auditColumns<Row>((r) => r.record, 'dump_register'),
        ...documentColumns<DumpRegister>({ inventory: true }),
      ],
    }),
    {
      name: 'Dump Items',
      refId: (line: DumpProduct) => line.dumpRegister?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(DumpProduct)
          .createQueryBuilder('line')
          .innerJoin('line.dumpRegister', 'parent')
          .addSelect(['parent.id', 'parent.dumpNo', 'parent.batchNo']);
        joinProductLine(qb, 'line');
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'Dump No', maps: 'dump_register.dumpNo', get: (l: DumpProduct) => l.dumpRegister?.dumpNo },
        { header: 'Dump Record ID', maps: 'dump_register.id', get: (l: DumpProduct) => l.dumpRegister?.id },
        { header: 'Batch No', maps: 'dump_register.batchNo', get: (l: DumpProduct) => l.dumpRegister?.batchNo },
        { header: 'Item ID', maps: 'dump_product.id', get: (l: DumpProduct) => l.id },
        ...productColumns<DumpProduct>((l) => l.productName, (l) => l.variant),
        uomColumn<DumpProduct>('UOM', (l) => l.uom, 'dump_product.uom'),
        { header: 'Dump Quantity', maps: 'dump_product.quantity', type: 'quantity', get: (l: DumpProduct) => l.quantity },
        { header: 'Unit Price', maps: 'dump_product.unitPrice', type: 'amount', get: (l: DumpProduct) => l.unitPrice },
        { header: 'Amount', maps: 'dump_product.amount', type: 'amount', get: (l: DumpProduct) => l.amount },
        ...auditColumns<DumpProduct>((l) => l, 'dump_product'),
      ],
    },
    approvalSheet({ numberHeader: 'Dump No', sources: [{ entity: DumpRegister, numberColumn: 'dumpNo' }] }),
  ],
};
