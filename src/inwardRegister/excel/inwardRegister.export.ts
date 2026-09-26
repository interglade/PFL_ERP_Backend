/**
 * Inward Register Excel export: header, line items and approval history.
 *
 * Field map (from the entities):
 *   inward_register          -> Inward Register sheet
 *   inwardProduct            -> Inward Items sheet
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * Accepted/rejected quantities and quality data are not stored on inward lines;
 * they live on AQR (quality) and the delivery-challan lines.
 */

import { InwardRegister } from '../entity/inwardRegister.entity';
import { InwardProduct } from '../entity/inwardProduct.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  CUSTOMER_COLUMNS,
  FARMER_COLUMNS,
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
  customerColumns,
  farmerColumns,
  productColumns,
  uomColumn,
  userColumns,
  vendorColumns,
} from '../../excel/export/commonColumns';

type Row = DocumentRow<InwardRegister>;

export const INWARD_REGISTER_EXPORT: ExportDefinition = {
  fileStem: 'Inward_Register',
  sheets: [
    documentHeaderSheet<InwardRegister>({
      name: 'Inward Register',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(InwardRegister).createQueryBuilder('inward');
        joinSelect(qb, 'inward.grnNo', 'grn', ['id', 'grnNo']);
        joinSelect(qb, 'inward.deliveryChallanNo', 'challan', ['id', 'challanNo']);
        joinSelect(qb, 'inward.rbcNo', 'rbc', ['id', 'rbcNo']);
        joinSelect(qb, 'inward.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'inward.location', 'location', BRANCH_COLUMNS);
        joinSelect(qb, 'inward.fromLocation', 'fromLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'inward.selectedVendor', 'vendor', VENDOR_COLUMNS);
        joinSelect(qb, 'inward.selectedFarmer', 'farmer', FARMER_COLUMNS);
        joinSelect(qb, 'inward.customerName', 'customer', CUSTOMER_COLUMNS);
        joinSelect(qb, 'inward.purchasedBy', 'purchasedBy', USER_COLUMNS);
        joinSelect(qb, 'inward.inwardBy', 'inwardBy', USER_COLUMNS);
        return qb.where('inward.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Inward No', maps: 'inward_register.inwardNo', get: (r) => r.record.inwardNo },
        { header: 'Inward Record ID', maps: 'inward_register.id', get: (r) => r.record.id },
        { header: 'Inward Type', maps: 'inward_register.inwardType', get: (r) => r.record.inwardType },
        { header: 'Inward Date', maps: 'inward_register.date', type: 'date', get: (r) => r.record.date },
        { header: 'Batch No', maps: 'inward_register.batchNo', get: (r) => r.record.batchNo },
        { header: 'Source', maps: 'inward_register.source', get: (r) => r.record.source },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Location', (r) => r.record.location, 'inward_register.location'),
        branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'inward_register.fromLocation'),
        { header: 'GRN No', maps: 'inward_register.grnNo -> grns.grnNo', get: (r) => r.record.grnNo?.grnNo },
        { header: 'Delivery Challan No', maps: 'inward_register.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
        { header: 'Return By Customer No', maps: 'inward_register.rbcNo -> return_by_customer.rbcNo', get: (r) => r.record.rbcNo?.rbcNo },
        ...vendorColumns<Row>((r) => r.record.selectedVendor),
        ...farmerColumns<Row>((r) => r.record.selectedFarmer),
        ...customerColumns<Row>((r) => r.record.customerName),
        { header: 'Incoming Gross Qty', maps: 'inward_register.incomingGrossQty', type: 'quantity', get: (r) => r.record.incomingGrossQty },
        { header: 'Incoming Net Qty', maps: 'inward_register.incomingNetQty', type: 'quantity', get: (r) => r.record.incomingNetQty },
        { header: 'Inward Gross Qty', maps: 'inward_register.inwardGrossQty', type: 'quantity', get: (r) => r.record.inwardGrossQty },
        { header: 'Inward Net Qty', maps: 'inward_register.inwardNetQty', type: 'quantity', get: (r) => r.record.inwardNetQty },
        { header: 'Total Weight (Kg)', maps: 'inward_register.totalWeightInKg', type: 'quantity', get: (r) => r.record.totalWeightInKg },
        { header: 'Inward Cost', maps: 'inward_register.inwardCost', type: 'amount', get: (r) => r.record.inwardCost },
        { header: 'Remarks', maps: 'inward_register.remarks', get: (r) => r.record.remarks },
        ...userColumns<Row>('Purchased By', (r) => r.record.purchasedBy, 'inward_register.purchasedBy'),
        ...userColumns<Row>('Inward By', (r) => r.record.inwardBy, 'inward_register.inwardBy'),
        ...auditColumns<Row>((r) => r.record, 'inward_register'),
        ...documentColumns<InwardRegister>({ inventory: true }),
      ],
    }),
    {
      name: 'Inward Items',
      refId: (line: InwardProduct) => line.inwardRegister?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(InwardProduct)
          .createQueryBuilder('line')
          .innerJoin('line.inwardRegister', 'parent')
          .addSelect(['parent.id', 'parent.inwardNo', 'parent.batchNo']);
        joinProductLine(qb, 'line');
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'Inward No', maps: 'inward_register.inwardNo', get: (l: InwardProduct) => l.inwardRegister?.inwardNo },
        { header: 'Inward Record ID', maps: 'inward_register.id', get: (l: InwardProduct) => l.inwardRegister?.id },
        { header: 'Batch No', maps: 'inward_register.batchNo', get: (l: InwardProduct) => l.inwardRegister?.batchNo },
        { header: 'Item ID', maps: 'inwardProduct.id', get: (l: InwardProduct) => l.id },
        ...productColumns<InwardProduct>((l) => l.productName, (l) => l.variant),
        uomColumn<InwardProduct>('UOM', (l) => l.uom, 'inwardProduct.uom'),
        { header: 'Quantity', maps: 'inwardProduct.quantity', type: 'quantity', get: (l: InwardProduct) => l.quantity },
        { header: 'Weight', maps: 'inwardProduct.weight', type: 'quantity', get: (l: InwardProduct) => l.weight },
        { header: 'Packing Material Weight', maps: 'inwardProduct.packingMaterialWeight', type: 'quantity', get: (l: InwardProduct) => l.packingMaterialWeight },
        { header: 'Gross Weight', maps: 'inwardProduct.grossWeight', type: 'quantity', get: (l: InwardProduct) => l.grossWeight },
        { header: 'Net Weight', maps: 'inwardProduct.netWeight', type: 'quantity', get: (l: InwardProduct) => l.netWeight },
        { header: 'Unit Price', maps: 'inwardProduct.unitPrice', type: 'amount', get: (l: InwardProduct) => l.unitPrice },
        { header: 'Amount', maps: 'inwardProduct.amount', type: 'amount', get: (l: InwardProduct) => l.amount },
        ...auditColumns<InwardProduct>((l) => l, 'inwardProduct'),
      ],
    },
    approvalSheet({ numberHeader: 'Inward No', sources: [{ entity: InwardRegister, numberColumn: 'inwardNo' }] }),
  ],
};
