/**
 * Pieces shared by the three delivery-challan exports (customer, stock transfer,
 * other). All three are single-table-inheritance children of
 * `delivery_challan_purchase` and share its line table `item`.
 */

import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { DeliveryChallanPurchase } from '../entity/deliveryChallan.entity';
import { Item } from '../entity/dItem.entity';
import { ExportColumn, ExportSheet } from '../../../excel/export/exportTypes';
import {
  COMPANY_COLUMNS,
  PACKING_MATERIAL_COLUMNS,
  UOM_COLUMNS,
  USER_COLUMNS,
  joinProductLine,
  joinSelect,
} from '../../../excel/export/exportQuery';
import { DocumentRow } from '../../../excel/export/documentMeta';
import { auditColumns, companyColumns, productColumns, uomColumn, userColumns } from '../../../excel/export/commonColumns';

/** Joins the base-table relations every challan header sheet shows. */
export function joinChallanBase<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
  joinSelect(qb, `${alias}.companyName`, 'company', COMPANY_COLUMNS);
  joinSelect(qb, `${alias}.offices`, 'office', ['id', 'name']);
  joinSelect(qb, `${alias}.grnNo`, 'grn', ['id', 'grnNo']);
  joinSelect(qb, `${alias}.createdBy`, 'createdBy', USER_COLUMNS);
  return qb;
}

/** Header columns from `delivery_challan_purchase`, placed after the type-specific identity columns. */
export function challanBaseColumns<T extends DeliveryChallanPurchase>(): ExportColumn<DocumentRow<T>>[] {
  type Row = DocumentRow<T>;
  const t = 'delivery_challan_purchase';
  return [
    ...companyColumns<Row>((r) => r.record.companyName),
    { header: 'Office', maps: `${t}.offices -> offices.name`, get: (r) => r.record.offices?.name },
    { header: 'GRN No', maps: `${t}.grnNo -> grns.grnNo`, get: (r) => r.record.grnNo?.grnNo },
    { header: 'Requesting Department', maps: `${t}.requestingDepartment`, get: (r) => r.record.requestingDepartment },
    { header: 'Challan Approval Status', maps: `${t}.approval_status`, get: (r) => r.record.approvalStatus },
    { header: 'Transit Insurance No', maps: `${t}.transitInsuranceNo`, get: (r) => r.record.transitInsuranceNo },
    { header: 'Vehicle No', maps: `${t}.vehicleNo`, get: (r) => r.record.vehicleNo },
    { header: 'Driver Name', maps: `${t}.driverName`, get: (r) => r.record.driverName },
    { header: 'Driver License No', maps: `${t}.licenseNo`, get: (r) => r.record.licenseNo },
    { header: 'Contact No', maps: `${t}.contactNo`, get: (r) => r.record.contactNo },
    { header: 'Alternate Contact No', maps: `${t}.altContactNo`, get: (r) => r.record.altContactNo },
    { header: 'RMN', maps: `${t}.rmn`, get: (r) => r.record.rmn },
    { header: 'Receiver Name', maps: `${t}.receiverName`, get: (r) => r.record.receiverName },
    { header: 'Total Product Amount', maps: `${t}.totalProductAmount`, type: 'amount', get: (r) => r.record.totalProductAmount },
    { header: 'Net Product Weight', maps: `${t}.netProductWeight`, type: 'quantity', get: (r) => r.record.netProductWeight },
    { header: 'Net Packaging Material Weight', maps: `${t}.netPackagingMaterialWeight`, type: 'quantity', get: (r) => r.record.netPackagingMaterialWeight },
    { header: 'Total Packaging Material Amount', maps: `${t}.totalPackagingMaterialAmount`, type: 'amount', get: (r) => r.record.totalPackagingMaterialAmount },
    { header: 'Total Amount In Words', maps: `${t}."amount in words"`, get: (r) => r.record.totalAmtInWords },
    { header: 'Returned', maps: `${t}.isReturned`, type: 'boolean', get: (r) => r.record.isReturned },
    { header: 'Attachments', maps: `${t}.anyAttachment`, get: (r) => r.record.anyAttachment },
    { header: 'Remark', maps: `${t}.remark`, get: (r) => r.record.remark },
    ...userColumns<Row>('Created By', (r) => r.record.createdBy, `${t}.created_by`),
    ...auditColumns<Row>((r) => r.record, t),
  ];
}

/** Line-item sheet over `item`, shared by every challan type. */
export function challanItemsSheet(name: string): ExportSheet<Item> {
  return {
    name,
    refId: (line) => line.deliveryChallan?.id,
    load: async (ctx) => {
      const qb = ctx.manager
        .getRepository(Item)
        .createQueryBuilder('line')
        .innerJoin('line.deliveryChallan', 'parent')
        .addSelect(['parent.id', 'parent.challanNo']);
      joinProductLine(qb, 'line', { product: 'productName', variant: 'variant', uom: 'uom', saleUoM: 'saleUoM' });
      joinSelect(qb, 'line.packagingMaterial', 'packagingMaterial', PACKING_MATERIAL_COLUMNS);
      joinSelect(qb, 'line.packagingMaterialUoM', 'packagingMaterialUoM', UOM_COLUMNS);
      return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
    },
    columns: [
      { header: 'Challan No', maps: 'delivery_challan_purchase.challanNo', get: (l) => l.deliveryChallan?.challanNo },
      { header: 'Challan Record ID', maps: 'delivery_challan_purchase.id', get: (l) => l.deliveryChallan?.id },
      { header: 'Item ID', maps: 'item.id', get: (l) => l.id },
      ...productColumns<Item>((l) => l.productName, (l) => l.variant),
      uomColumn<Item>('UOM', (l) => l.uom, 'item.uom'),
      uomColumn<Item>('Sale UOM', (l) => l.saleUoM, 'item.saleUoM'),
      { header: 'Quantity', maps: 'item.quantity', type: 'quantity', get: (l) => l.quantity },
      { header: 'Accepted Qty', maps: 'item.acceptedQty', type: 'quantity', get: (l) => l.acceptedQty },
      { header: 'Rejected Qty', maps: 'item.rejectedQty', type: 'quantity', get: (l) => l.rejectedQty },
      { header: 'Returned Qty', maps: 'item.returnedQty', type: 'quantity', get: (l) => l.returnedQty },
      { header: 'Changed Qty', maps: 'item.changedQty', type: 'quantity', get: (l) => l.changedQty },
      { header: 'Unit Price', maps: 'item.unitPrice', type: 'amount', get: (l) => l.unitPrice },
      { header: 'Changed Price', maps: 'item.changedPrice', type: 'amount', get: (l) => l.changedPrice },
      { header: 'Amount', maps: 'item.amount', type: 'amount', get: (l) => l.amount },
      { header: 'Gross Weight', maps: 'item.grossWeight', type: 'quantity', get: (l) => l.grossWeight },
      { header: 'Packing Material Weight', maps: 'item.packingMaterialWeight', type: 'quantity', get: (l) => l.packingMaterialWeight },
      { header: 'Net Weight', maps: 'item.netWeight', type: 'quantity', get: (l) => l.netWeight },
      { header: 'Packing Material Quantity', maps: 'item.packingMaterialQuantity', type: 'quantity', get: (l) => l.packingMaterialQuantity },
      { header: 'Packaging Material', maps: 'item.packagingMaterial -> packing_material.packagingMaterialName', get: (l) => l.packagingMaterial?.packagingMaterialName },
      uomColumn<Item>('Packaging Material UOM', (l) => l.packagingMaterialUoM, 'item.packagingMaterialUoM'),
      { header: 'Packaging Material Quantity', maps: 'item.packagingMaterialQuantity', type: 'quantity', get: (l) => l.packagingMaterialQuantity },
      { header: 'Packaging Material Unit Price', maps: 'item.packagingMaterialUnitPrice', type: 'amount', get: (l) => l.packagingMaterialUnitPrice },
      { header: 'Packaging Material Amount', maps: 'item.packagingMaterialAmount', type: 'amount', get: (l) => l.packagingMaterialAmount },
      { header: 'Packaging Material Total Weight', maps: 'item.packagingMaterialTotalWeight', type: 'quantity', get: (l) => l.packagingMaterialTotalWeight },
      ...auditColumns<Item>((l) => l, 'item'),
    ],
  };
}
