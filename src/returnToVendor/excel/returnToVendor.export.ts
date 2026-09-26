/**
 * Return to Vendor Excel export: header, returned items and approval history.
 *
 * Field map (from the entities):
 *   return_to_vendor         -> Return To Vendor sheet
 *   return_to_vendor_product -> RTV Items sheet (reason is stored per line)
 *   documents + approval_stage_info -> status columns + Approvals sheet
 */

import { ReturnToVendor } from '../entity/returnToVendor.entity';
import { ProductReturnToVendor } from '../entity/productReturnToVendor.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  USER_COLUMNS,
  VENDOR_COLUMNS,
  joinProductLine,
  joinSelect,
} from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  auditColumns,
  branchColumn,
  companyColumns,
  productColumns,
  uomColumn,
  userColumns,
  vendorColumns,
} from '../../excel/export/commonColumns';

type Row = DocumentRow<ReturnToVendor>;

export const RETURN_TO_VENDOR_EXPORT: ExportDefinition = {
  fileStem: 'Return_To_Vendor',
  sheets: [
    documentHeaderSheet<ReturnToVendor>({
      name: 'Return To Vendor',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(ReturnToVendor).createQueryBuilder('rtv');
        joinSelect(qb, 'rtv.grnNo', 'grn', ['id', 'grnNo', 'billNo']);
        joinSelect(qb, 'rtv.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'rtv.location', 'location', BRANCH_COLUMNS);
        joinSelect(qb, 'rtv.selectedVendor', 'vendor', VENDOR_COLUMNS);
        joinSelect(qb, 'rtv.createdBy', 'createdBy', USER_COLUMNS);
        return qb.where('rtv.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Return No', maps: 'return_to_vendor.rtvNo', get: (r) => r.record.rtvNo },
        { header: 'Return Record ID', maps: 'return_to_vendor.id', get: (r) => r.record.id },
        { header: 'Return Date', maps: 'return_to_vendor.returnDate', type: 'date', get: (r) => r.record.returnDate },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Location', (r) => r.record.location, 'return_to_vendor.location'),
        ...vendorColumns<Row>((r) => r.record.selectedVendor),
        { header: 'Original GRN No', maps: 'return_to_vendor.grnNo -> grns.grnNo', get: (r) => r.record.grnNo?.grnNo },
        { header: 'Original Bill No', maps: 'grns.billNo', get: (r) => r.record.grnNo?.billNo },
        { header: 'Returned Gross Weight', maps: 'return_to_vendor.returnedGrossWeight', type: 'quantity', get: (r) => r.record.returnedGrossWeight },
        { header: 'Returned Net Weight', maps: 'return_to_vendor.returnedNetWeight', type: 'quantity', get: (r) => r.record.returnedNetWeight },
        { header: 'Total Amount', maps: 'return_to_vendor.totalAmt', type: 'amount', get: (r) => r.record.totalAmt },
        { header: 'Amount In Words', maps: 'return_to_vendor.amtWords', get: (r) => r.record.amtWords },
        { header: 'Remark', maps: 'return_to_vendor.remark', get: (r) => r.record.remark },
        ...userColumns<Row>('Created By', (r) => r.record.createdBy, 'return_to_vendor.createdBy'),
        ...auditColumns<Row>((r) => r.record, 'return_to_vendor'),
        ...documentColumns<ReturnToVendor>({ inventory: true }),
      ],
    }),
    {
      name: 'RTV Items',
      refId: (line: ProductReturnToVendor) => line.returnToVendor?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(ProductReturnToVendor)
          .createQueryBuilder('line')
          .innerJoin('line.returnToVendor', 'parent')
          .addSelect(['parent.id', 'parent.rtvNo']);
        joinProductLine(qb, 'line');
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'Return No', maps: 'return_to_vendor.rtvNo', get: (l: ProductReturnToVendor) => l.returnToVendor?.rtvNo },
        { header: 'Return Record ID', maps: 'return_to_vendor.id', get: (l: ProductReturnToVendor) => l.returnToVendor?.id },
        { header: 'Item ID', maps: 'return_to_vendor_product.id', get: (l: ProductReturnToVendor) => l.id },
        ...productColumns<ProductReturnToVendor>((l) => l.productName, (l) => l.variant),
        uomColumn<ProductReturnToVendor>('UOM', (l) => l.uom, 'return_to_vendor_product.uom'),
        { header: 'Return Quantity', maps: 'return_to_vendor_product.quantity', type: 'quantity', get: (l: ProductReturnToVendor) => l.quantity },
        { header: 'Unit Price', maps: 'return_to_vendor_product.unitPrice', type: 'amount', get: (l: ProductReturnToVendor) => l.unitPrice },
        { header: 'Amount', maps: 'return_to_vendor_product.amount', type: 'amount', get: (l: ProductReturnToVendor) => l.amount },
        { header: 'Gross Weight', maps: 'return_to_vendor_product.grossWeight', type: 'quantity', get: (l: ProductReturnToVendor) => l.grossWeight },
        { header: 'Packing Material Weight', maps: 'return_to_vendor_product.packingMaterialWeight', type: 'quantity', get: (l: ProductReturnToVendor) => l.packingMaterialWeight },
        { header: 'Net Weight', maps: 'return_to_vendor_product.netWeight', type: 'quantity', get: (l: ProductReturnToVendor) => l.netWeight },
        { header: 'Return Reason', maps: 'return_to_vendor_product.reason', get: (l: ProductReturnToVendor) => l.reason },
        { header: 'RTV Line', maps: 'return_to_vendor_product.rtv', type: 'boolean', get: (l: ProductReturnToVendor) => l.rtv },
        { header: 'Purchase Date', maps: 'return_to_vendor_product.purchaseDate', type: 'date', get: (l: ProductReturnToVendor) => l.purchaseDate },
        { header: 'Dispatch Date', maps: 'return_to_vendor_product.dispatchDate', type: 'date', get: (l: ProductReturnToVendor) => l.dispatchDate },
        { header: 'Delivery Date', maps: 'return_to_vendor_product.deliveryDate', type: 'date', get: (l: ProductReturnToVendor) => l.deliveryDate },
        { header: 'Delivery Location', maps: 'return_to_vendor_product.deliveryLocation', get: (l: ProductReturnToVendor) => l.deliveryLocation },
        ...auditColumns<ProductReturnToVendor>((l) => l, 'return_to_vendor_product'),
      ],
    },
    approvalSheet({ numberHeader: 'Return No', sources: [{ entity: ReturnToVendor, numberColumn: 'rtvNo' }] }),
  ],
};
