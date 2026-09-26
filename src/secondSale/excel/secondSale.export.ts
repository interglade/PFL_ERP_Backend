/**
 * Second Sale Excel export: header, line items and approval history.
 *
 * Field map (from the entities):
 *   second_sale_document     -> Second Sale sheet
 *   second_sale_product      -> Second Sale Items sheet
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * The buyer on a second sale is free text, not a customer record, and the
 * table has no created-by column: the document creator is shown instead.
 */

import { SecondSale } from '../entity/secondSale.entity';
import { SecondSaleProduct } from '../entity/secondSaleProduct.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  ADDRESS_COLUMNS,
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  PACKING_MATERIAL_COLUMNS,
  UOM_COLUMNS,
  joinProductLine,
  joinSelect,
} from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  addressColumn,
  auditColumns,
  branchColumn,
  companyColumns,
  productColumns,
  uomColumn,
} from '../../excel/export/commonColumns';

type Row = DocumentRow<SecondSale>;

export const SECOND_SALE_EXPORT: ExportDefinition = {
  fileStem: 'Second_Sale',
  sheets: [
    documentHeaderSheet<SecondSale>({
      name: 'Second Sale',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(SecondSale).createQueryBuilder('sale');
        joinSelect(qb, 'sale.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'sale.location', 'location', BRANCH_COLUMNS);
        joinSelect(qb, 'sale.deliveryChallanNo', 'challan', ['id', 'challanNo']);
        joinSelect(qb, 'sale.customerAddress', 'customerAddress', ADDRESS_COLUMNS);
        return qb.where('sale.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Second Sale No', maps: 'second_sale_document.secondSaleNo', get: (r) => r.record.secondSaleNo },
        { header: 'Second Sale Record ID', maps: 'second_sale_document.id', get: (r) => r.record.id },
        { header: 'Sale Date', maps: 'second_sale_document.saleDate', type: 'date', get: (r) => r.record.saleDate },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Location', (r) => r.record.location, 'second_sale_document.location'),
        { header: 'Source Delivery Challan No', maps: 'second_sale_document.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
        { header: 'Customer Name', maps: 'second_sale_document.customerName', get: (r) => r.record.customerName },
        { header: 'Customer Contact No', maps: 'second_sale_document.customerContactNo', get: (r) => r.record.customerContactNo },
        { header: 'Customer Email', maps: 'second_sale_document.customerEmail', get: (r) => r.record.customerEmail },
        addressColumn<Row>('Customer Address', (r) => r.record.customerAddress, 'second_sale_document.customerAddress'),
        { header: 'Reason For Sale', maps: 'second_sale_document.reasonForSale', get: (r) => r.record.reasonForSale },
        { header: 'Total Net Weight', maps: 'second_sale_document.totalNetWeight', type: 'quantity', get: (r) => r.record.totalNetWeight },
        { header: 'Total Gross Weight', maps: 'second_sale_document.totalGrossWeight', type: 'quantity', get: (r) => r.record.totalGrossWeight },
        { header: 'Total Amount', maps: 'second_sale_document.totalAmt', type: 'amount', get: (r) => r.record.totalAmt },
        { header: 'Total Amount In Words', maps: 'second_sale_document.totalAmtInWords', get: (r) => r.record.totalAmtInWords },
        { header: 'Paid Amount', maps: 'second_sale_document.paidAmount', type: 'amount', get: (r) => r.record.paidAmount },
        { header: 'Pending Amount', maps: 'second_sale_document.pendingAmt', type: 'amount', get: (r) => r.record.pendingAmt },
        { header: 'Payment Mode', maps: 'second_sale_document.paymentMode', get: (r) => r.record.paymentMode },
        { header: 'Remarks', maps: 'second_sale_document.remarks', get: (r) => r.record.remarks },
        ...auditColumns<Row>((r) => r.record, 'second_sale_document'),
        ...documentColumns<SecondSale>(),
      ],
    }),
    {
      name: 'Second Sale Items',
      refId: (line: SecondSaleProduct) => line.secondSaleRegister?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(SecondSaleProduct)
          .createQueryBuilder('line')
          .innerJoin('line.secondSaleRegister', 'parent')
          .addSelect(['parent.id', 'parent.secondSaleNo']);
        joinProductLine(qb, 'line', { product: 'productName', variant: 'variant', saleUoM: 'saleUoM' });
        joinSelect(qb, 'line.packagingMaterial', 'packagingMaterial', PACKING_MATERIAL_COLUMNS);
        joinSelect(qb, 'line.packagingMaterialUoM', 'packagingMaterialUoM', UOM_COLUMNS);
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'Second Sale No', maps: 'second_sale_document.secondSaleNo', get: (l: SecondSaleProduct) => l.secondSaleRegister?.secondSaleNo },
        { header: 'Second Sale Record ID', maps: 'second_sale_document.id', get: (l: SecondSaleProduct) => l.secondSaleRegister?.id },
        { header: 'Item ID', maps: 'second_sale_product.id', get: (l: SecondSaleProduct) => l.id },
        ...productColumns<SecondSaleProduct>((l) => l.productName, (l) => l.variant),
        uomColumn<SecondSaleProduct>('Sale UOM', (l) => l.saleUoM, 'second_sale_product.saleUoM'),
        { header: 'Quantity', maps: 'second_sale_product.quantity', type: 'quantity', get: (l: SecondSaleProduct) => l.quantity },
        { header: 'Unit Price', maps: 'second_sale_product.unitPrice', type: 'amount', get: (l: SecondSaleProduct) => l.unitPrice },
        { header: 'Amount', maps: 'second_sale_product.amount', type: 'amount', get: (l: SecondSaleProduct) => l.amount },
        { header: 'Gross Weight', maps: 'second_sale_product.grossWeight', type: 'quantity', get: (l: SecondSaleProduct) => l.grossWeight },
        { header: 'Packaging Material Weight', maps: 'second_sale_product.packagingMaterialWeight', type: 'quantity', get: (l: SecondSaleProduct) => l.packagingMaterialWeight },
        { header: 'Net Weight', maps: 'second_sale_product.netWeight', type: 'quantity', get: (l: SecondSaleProduct) => l.netWeight },
        { header: 'Packaging Material', maps: 'second_sale_product.packagingMaterial -> packing_material.packagingMaterialName', get: (l: SecondSaleProduct) => l.packagingMaterial?.packagingMaterialName },
        uomColumn<SecondSaleProduct>('Packaging Material UOM', (l) => l.packagingMaterialUoM, 'second_sale_product.packagingMaterialUoM'),
        { header: 'Packaging Material Quantity', maps: 'second_sale_product.packagingMaterialQuantity', type: 'quantity', get: (l: SecondSaleProduct) => l.packagingMaterialQuantity },
        { header: 'Packaging Material Unit Price', maps: 'second_sale_product.packagingMaterialUnitPrice', type: 'amount', get: (l: SecondSaleProduct) => l.packagingMaterialUnitPrice },
        { header: 'Packaging Material Amount', maps: 'second_sale_product.packagingMaterialAmount', type: 'amount', get: (l: SecondSaleProduct) => l.packagingMaterialAmount },
        { header: 'Packaging Material Total Weight', maps: 'second_sale_product.packagingMaterialTotalWeight', type: 'quantity', get: (l: SecondSaleProduct) => l.packagingMaterialTotalWeight },
        ...auditColumns<SecondSaleProduct>((l) => l, 'second_sale_product'),
      ],
    },
    approvalSheet({ numberHeader: 'Second Sale No', sources: [{ entity: SecondSale, numberColumn: 'secondSaleNo' }] }),
  ],
};
