/**
 * Vehicle Dispatch Excel export: dispatch details, product lines and approval history.
 *
 * Field map (from the entities):
 *   dispatch                 -> Vehicle Dispatch sheet (one row per dispatch, any register)
 *   dispatch_product         -> Dispatch Items sheet (the source lines copied at creation)
 *   grns / delivery_challan_purchase -> the source document number
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * The commercial columns dropped from the register on 2026-10-13 (payment discussed,
 * transportation bill, advance paid, accounts verification, transporter-owner feedback,
 * net inward qty, rejection, shrinkage, payment terms, client GRN no, supervisor name)
 * are no longer exported; old rows still hold them in the table.
 */

import { VehicleDispatch } from '../entity/vehicleDispatch.entity';
import { DispatchProduct } from '../entity/dispatchProduct.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import { ADDRESS_COLUMNS, BRANCH_COLUMNS, COMPANY_COLUMNS, joinProductLine, joinSelect, withoutColumns } from '../../excel/export/exportQuery';
import { APPROVAL_ID_AND_STAGE_COLUMNS, DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import { addressColumn, branchColumn, companyColumns, productColumns, uomColumn } from '../../excel/export/commonColumns';

type Row = DocumentRow<VehicleDispatch>;

const DISPATCH_TYPE_LABEL: Record<string, string> = {
  purchase: 'Purchase',
  'stock-transfer': 'Stock Transfer',
  sales: 'Sales',
};

export const VEHICLE_DISPATCH_EXPORT: ExportDefinition = {
  fileStem: 'Vehicle_Dispatch',
  sheets: [
    documentHeaderSheet<VehicleDispatch>({
      name: 'Vehicle Dispatch',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(VehicleDispatch).createQueryBuilder('dispatch');
        joinSelect(qb, 'dispatch.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'dispatch.grn', 'grn', ['id', 'grnNo']);
        joinSelect(qb, 'dispatch.deliveryChallanNo', 'challan', ['id', 'challanNo']);
        joinSelect(qb, 'dispatch.fromLocation', 'fromLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'dispatch.toLocation', 'toLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'dispatch.customer', 'customer', ['id', 'organisationName']);
        joinSelect(qb, 'dispatch.toAddress', 'toAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'dispatch.clientAddress', 'clientAddress', ADDRESS_COLUMNS);
        return qb.where('dispatch.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Dispatch No', maps: 'dispatch.vehicleDispatchNo', get: (r) => r.record.vehicleDispatchNo },
        { header: 'Register', maps: 'dispatch.dispatchType', get: (r) => DISPATCH_TYPE_LABEL[r.record.dispatchType] ?? r.record.dispatchType },
        { header: 'Dispatch Date', maps: 'dispatch.date', type: 'date', get: (r) => r.record.date },
        { header: 'Batch No', maps: 'dispatch.batchNo', get: (r) => r.record.batchNo },
        ...companyColumns<Row>((r) => r.record.companyName),
        { header: 'GRN No', maps: 'dispatch.grn -> grns.grnNo', get: (r) => r.record.grn?.grnNo },
        { header: 'Delivery Challan No', maps: 'dispatch.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
        { header: 'Source (Party Type)', maps: 'dispatch.source', get: (r) => r.record.source },
        branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'dispatch.fromLocation'),
        { header: 'From (Other)', maps: 'dispatch.fromText', get: (r) => r.record.fromText },
        branchColumn<Row>('To Location', (r) => r.record.toLocation, 'dispatch.toLocation'),
        { header: 'Customer', maps: 'dispatch.customer -> customers.organisationName', get: (r) => r.record.customer?.organisationName ?? r.record.clientName },
        addressColumn<Row>('Shipping Address', (r) => r.record.toAddress ?? r.record.clientAddress, 'dispatch.toAddress'),
        { header: 'Transporter', maps: 'dispatch.transporterName', get: (r) => r.record.transporterName },
        { header: 'Transporter Contact', maps: 'dispatch.transporterContact', get: (r) => r.record.transporterContact },
        { header: 'Vehicle No', maps: 'dispatch.vehicleNo', get: (r) => r.record.vehicleNo },
        { header: 'Vehicle Type', maps: 'dispatch.vehicleType', get: (r) => r.record.vehicleType },
        { header: 'Vehicle Capacity (kg)', maps: 'dispatch.vehicleCapacityKg', type: 'quantity', get: (r) => r.record.vehicleCapacityKg },
        { header: 'Driver Name', maps: 'dispatch.driverName', get: (r) => r.record.driverName },
        { header: 'Driver Mobile No', maps: 'dispatch.driverMobNo', get: (r) => r.record.driverMobNo },
        { header: 'Driver Licence No', maps: 'dispatch.licenseNo', get: (r) => r.record.licenseNo },
        { header: 'Out Date', maps: 'dispatch.outDate', type: 'date', get: (r) => r.record.outDate },
        { header: 'Out Time', maps: 'dispatch.outTime', type: 'time', get: (r) => r.record.outTime },
        { header: 'Expected Reaching Date', maps: 'dispatch.expectedReachingDate', type: 'date', get: (r) => r.record.expectedReachingDate },
        { header: 'Expected Reaching Time', maps: 'dispatch.reachingTime', type: 'time', get: (r) => r.record.reachingTime },
        { header: 'Arrived At', maps: 'dispatch.arrivedAt', type: 'datetime', get: (r) => r.record.arrivedAt },
        { header: 'Receiving Person', maps: 'dispatch.receivingPerson', get: (r) => r.record.receivingPerson },
        { header: 'Total Quantity', maps: 'dispatch.totalQuantity', type: 'quantity', get: (r) => r.record.totalQuantity },
        { header: 'Total Gross Weight (kg)', maps: 'dispatch.totalGrossWeight', type: 'quantity', get: (r) => r.record.totalGrossWeight },
        { header: 'Total Net Weight (kg)', maps: 'dispatch.totalNetWeight', type: 'quantity', get: (r) => r.record.totalNetWeight },
        { header: 'Total Amount', maps: 'dispatch.totalAmount', type: 'amount', get: (r) => r.record.totalAmount },
        { header: 'Remarks (PFL)', maps: 'dispatch.remarksPFL', get: (r) => r.record.remarksPFL },
        ...documentColumns<VehicleDispatch>(),
      ],
    }),
    {
      name: 'Dispatch Items',
      refId: (line: DispatchProduct) => line.dispatch?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(DispatchProduct)
          .createQueryBuilder('line')
          .innerJoin('line.dispatch', 'parent')
          .addSelect(['parent.id', 'parent.vehicleDispatchNo', 'parent.batchNo']);
        joinProductLine(qb, 'line');
        joinSelect(qb, 'line.packagingMaterial', 'packaging', ['id', 'packagingMaterialName']);
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'Dispatch No', maps: 'dispatch.vehicleDispatchNo', get: (l: DispatchProduct) => l.dispatch?.vehicleDispatchNo },
        { header: 'Batch No', maps: 'dispatch.batchNo', get: (l: DispatchProduct) => l.dispatch?.batchNo },
        ...productColumns<DispatchProduct>((l) => l.productName, (l) => l.variant),
        uomColumn<DispatchProduct>('UOM', (l) => l.uom, 'dispatch_product.uom'),
        { header: 'Quantity', maps: 'dispatch_product.quantity', type: 'quantity', get: (l: DispatchProduct) => l.quantity },
        { header: 'Unit Price', maps: 'dispatch_product.unitPrice', type: 'amount', get: (l: DispatchProduct) => l.unitPrice },
        { header: 'Amount', maps: 'dispatch_product.amount', type: 'amount', get: (l: DispatchProduct) => l.amount },
        { header: 'Packaging Material', maps: 'dispatch_product.packagingMaterial -> post_packaging_material.packagingMaterialName', get: (l: DispatchProduct) => l.packagingMaterial?.packagingMaterialName },
        { header: 'Packaging Weight per Unit (g)', maps: 'dispatch_product.packingMaterialWeight', type: 'quantity', get: (l: DispatchProduct) => l.packingMaterialWeight },
        { header: 'Gross Weight (kg)', maps: 'dispatch_product.grossWeight', type: 'quantity', get: (l: DispatchProduct) => l.grossWeight },
        { header: 'Net Weight (kg)', maps: 'dispatch_product.netWeight', type: 'quantity', get: (l: DispatchProduct) => l.netWeight },
      ],
    },
    withoutColumns(approvalSheet({ numberHeader: 'Dispatch No', sources: [{ entity: VehicleDispatch, numberColumn: 'vehicleDispatchNo' }] }), APPROVAL_ID_AND_STAGE_COLUMNS),
  ],
};
