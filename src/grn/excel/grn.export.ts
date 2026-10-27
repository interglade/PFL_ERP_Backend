/**
 * GRN Excel export: header, line items, price/quantity revision history and
 * approval history.
 *
 * Field map (from the entities):
 *   grns                     -> GRN sheet
 *   payment_info_for_grn     -> GRN sheet (payment columns)
 *   grn_products             -> GRN Items sheet
 *   grn_product_history      -> GRN History sheet (one row per revision version)
 *   grn_payments             -> GRN Payments sheet (one row per payment, voided ones too)
 *   documents + approval_stage_info -> status columns + Approvals sheet
 */

import { GRN } from '../entity/grn.entity';
import { GrnProduct } from '../entity/grnProduct.entity';
import { GrnProductHistory } from '../entity/grnProductHistory.entity';
import { GrnPayment } from '../entity/grnPayment.entity';
import { grnPaidAndBalance } from '../grnPayment';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  FARMER_COLUMNS,
  PACKING_MATERIAL_COLUMNS,
  PRODUCT_COLUMNS,
  USER_COLUMNS,
  VARIANT_COLUMNS,
  VENDOR_COLUMNS,
  joinProductLine,
  joinSelect,
  withoutColumns,
} from '../../excel/export/exportQuery';
import { APPROVAL_ID_COLUMNS, DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  branchColumn,
  companyColumns,
  farmerColumns,
  productColumns,
  uomColumn,
  userColumns,
  vendorColumns,
} from '../../excel/export/commonColumns';

type Row = DocumentRow<GRN>;

export const GRN_EXPORT: ExportDefinition = {
  fileStem: 'GRN',
  sheets: [
    documentHeaderSheet<GRN>({
      name: 'GRN',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(GRN).createQueryBuilder('grn');
        joinSelect(qb, 'grn.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'grn.purchaseLocation', 'purchaseLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'grn.purchaseForSalesLocation', 'purchaseForSalesLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'grn.selectedVendor', 'vendor', VENDOR_COLUMNS);
        joinSelect(qb, 'grn.selectedFarmer', 'farmer', FARMER_COLUMNS);
        joinSelect(qb, 'grn.purchaseInstructionsBy', 'purchaseInstructionsBy', USER_COLUMNS);
        qb.leftJoinAndSelect('grn.paymentInfo', 'paymentInfo');
        return qb.where('grn.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'GRN No', maps: 'grns.grnNo', get: (r) => r.record.grnNo },
        { header: 'Batch No', maps: 'grns.batchNo', get: (r) => r.record.batchNo },
        { header: 'Total Gross Weight', maps: 'grns.totalGrossWeight', type: 'quantity', get: (r) => r.record.totalGrossWeight },
        { header: 'Total Net Weight', maps: 'grns.totalNetWeight', type: 'quantity', get: (r) => r.record.totalNetWeight },
        { header: 'GRN Type', maps: 'grns.grnType', get: (r) => r.record.grnType },
        { header: 'Purchase Type', maps: 'grns.purchaseType', get: (r) => r.record.purchaseType },
        { header: 'Location Type', maps: 'grns.locationType', get: (r) => r.record.locationType },
        { header: 'Source', maps: 'grns.source', get: (r) => r.record.source },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Purchase Location', (r) => r.record.purchaseLocation, 'grns.purchaseLocation'),
        { header: 'Other Purchase Location', maps: 'grns.otherPurchaseLoc', get: (r) => r.record.otherPurchaseLoc },
        branchColumn<Row>('Purchase For Sales Location', (r) => r.record.purchaseForSalesLocation, 'grns.purchaseForSalesLocation'),
        { header: 'Other Purchase For Sales Location', maps: 'grns.otherPurchaseForSalesLoc', get: (r) => r.record.otherPurchaseForSalesLoc },
        ...vendorColumns<Row>((r) => r.record.selectedVendor),
        ...farmerColumns<Row>((r) => r.record.selectedFarmer),
        { header: 'Bill No', maps: 'grns.billNo', get: (r) => r.record.billNo },
        { header: 'Bill Image', maps: 'grns.billImage', get: (r) => r.record.billImage },
        { header: 'Sub Total Amount', maps: 'grns.subTotalAmt', type: 'amount', get: (r) => r.record.subTotalAmt },
        { header: 'Freight', maps: 'grns.freight', type: 'amount', get: (r) => r.record.freight },
        { header: 'Other Charges', maps: 'grns.otherCharges', type: 'amount', get: (r) => r.record.otherCharges },
        { header: 'Total Amount', maps: 'grns.totalAmt', type: 'amount', get: (r) => r.record.totalAmt },
        { header: 'Amount In Words', maps: 'grns.amtWords', get: (r) => r.record.amtWords },
        { header: 'Amount Status', maps: 'grns.ammountStatus (unpaid | partial | paid)', get: (r) => r.record.ammountStatus },
        { header: 'Paid Amount', maps: 'grns.paid_amount (sum of live payments, advance excluded)', type: 'amount', get: (r) => r.record.paidAmt },
        {
          header: 'Balance Amount',
          maps: 'grns.totalAmt - payment_info_for_grn.advancePaidAmt - grns.paid_amount',
          type: 'amount',
          get: (r) => grnPaidAndBalance(r.record.totalAmt, r.record.paymentInfo?.advancePaidAmt, r.record.paidAmt).balanceAmt,
        },
        { header: 'Crates In', maps: 'grns.cratesIn', type: 'quantity', get: (r) => r.record.cratesIn },
        { header: 'Receiving Person', maps: 'grns.receivingPerson', get: (r) => r.record.receivingPerson },
        { header: 'Security Person', maps: 'grns.securityPerson', get: (r) => r.record.securityPerson },
        { header: 'RMN', maps: 'grns.rmn', get: (r) => r.record.rmn },
        { header: 'Purchased By', maps: 'grns.purchasedBy', get: (r) => r.record.purchasedBy },
        ...userColumns<Row>('Purchase Instructions By', (r) => r.record.purchaseInstructionsBy, 'grns.purchaseInstructionsBy'),
        { header: 'Special Requirement', maps: 'grns.specialReq', get: (r) => r.record.specialReq },
        { header: 'Remark', maps: 'grns.remark', get: (r) => r.record.remark },
        { header: 'Payment Mode', maps: 'payment_info_for_grn.paymentMode', get: (r) => r.record.paymentInfo?.paymentMode },
        { header: 'Payment Date', maps: 'payment_info_for_grn.paymentDate', type: 'date', get: (r) => r.record.paymentInfo?.paymentDate },
        { header: 'Advance Paid Amount', maps: 'payment_info_for_grn.advancePaidAmt', type: 'amount', get: (r) => r.record.paymentInfo?.advancePaidAmt },
        { header: 'Remaining Amount', maps: 'payment_info_for_grn.remainingAmt', type: 'amount', get: (r) => r.record.paymentInfo?.remainingAmt },
        { header: 'Payment Terms', maps: 'payment_info_for_grn.paymentTerms', get: (r) => r.record.paymentInfo?.paymentTerms },
        { header: 'Due Date', maps: 'payment_info_for_grn.dueDate', type: 'date', get: (r) => r.record.paymentInfo?.dueDate },
        { header: 'Credit Period', maps: 'payment_info_for_grn.creditPeriod', type: 'number', get: (r) => r.record.paymentInfo?.creditPeriod },
        ...documentColumns<GRN>(),
      ],
    }),
    {
      name: 'GRN Items',
      refId: (line: GrnProduct) => line.grn?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(GrnProduct)
          .createQueryBuilder('line')
          .innerJoin('line.grn', 'parent')
          .addSelect(['parent.id', 'parent.grnNo']);
        joinProductLine(qb, 'line');
        joinSelect(qb, 'line.packagingMaterial', 'packagingMaterial', PACKING_MATERIAL_COLUMNS);
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'GRN No', maps: 'grns.grnNo', get: (l: GrnProduct) => l.grn?.grnNo },
        ...productColumns<GrnProduct>((l) => l.productName, (l) => l.variant).filter((c) => c.header !== 'Category'),
        { header: 'Grade', maps: 'grn_products.grade', get: (l: GrnProduct) => l.grade },
        uomColumn<GrnProduct>('UOM', (l) => l.uom, 'grn_products.uom'),
        { header: 'Quantity', maps: 'grn_products.quantity', type: 'quantity', get: (l: GrnProduct) => l.quantity },
        { header: 'Unit Price', maps: 'grn_products.unitPrice', type: 'amount', get: (l: GrnProduct) => l.unitPrice },
        { header: 'Amount', maps: 'grn_products.amount', type: 'amount', get: (l: GrnProduct) => l.amount },
        { header: 'Gross Weight', maps: 'grn_products.grossWeight', type: 'quantity', get: (l: GrnProduct) => l.grossWeight },
        { header: 'Packaging Material', maps: 'grn_products.packagingMaterial -> packing_material.packagingMaterialName', get: (l: GrnProduct) => l.packagingMaterial?.packagingMaterialName },
        { header: 'Packing Material Weight', maps: 'grn_products.packingMaterialWeight', type: 'quantity', get: (l: GrnProduct) => l.packingMaterialWeight },
        { header: 'Net Weight', maps: 'grn_products.netWeight', type: 'quantity', get: (l: GrnProduct) => l.netWeight },
        { header: 'Return To Vendor', maps: 'grn_products.rtv', type: 'boolean', get: (l: GrnProduct) => l.rtv },
        { header: 'Purchase Date', maps: 'grn_products.purchaseDate', type: 'date', get: (l: GrnProduct) => l.purchaseDate },
        { header: 'Expected Harvest Date', maps: 'grn_products.expectedHarvestDate', type: 'date', get: (l: GrnProduct) => l.expectedHarvestDate },
        { header: 'Dispatch Date', maps: 'grn_products.dispatchDate', type: 'date', get: (l: GrnProduct) => l.dispatchDate },
        { header: 'Delivery Date', maps: 'grn_products.deliveryDate', type: 'date', get: (l: GrnProduct) => l.deliveryDate },
      ],
    },
    {
      name: 'GRN History',
      refId: (h: GrnProductHistory) => h.grn?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(GrnProductHistory)
          .createQueryBuilder('history')
          .innerJoin('history.grn', 'parent')
          .addSelect(['parent.id', 'parent.grnNo']);
        joinSelect(qb, 'history.grnProduct', 'grnProduct', ['id']);
        joinSelect(qb, 'history.product', 'product', PRODUCT_COLUMNS);
        joinSelect(qb, 'history.variant', 'variant', VARIANT_COLUMNS);
        joinSelect(qb, 'history.modifiedBy', 'modifiedBy', USER_COLUMNS);
        joinSelect(qb, 'history.oldUom', 'oldUom', ['id', 'unit']);
        joinSelect(qb, 'history.newUom', 'newUom', ['id', 'unit']);
        joinSelect(qb, 'history.oldPackagingMaterial', 'oldPackaging', ['id', 'packagingMaterialName']);
        joinSelect(qb, 'history.newPackagingMaterial', 'newPackaging', ['id', 'packagingMaterialName']);
        return qb
          .where('parent.id IN (:...ids)', { ids: ctx.ids })
          .orderBy('history.modifiedAt', 'ASC')
          .addOrderBy('history.version', 'ASC')
          .getMany();
      },
      columns: [
        { header: 'GRN No', maps: 'grns.grnNo', get: (h: GrnProductHistory) => h.grn?.grnNo },
        { header: 'GRN Record ID', maps: 'grns.id', get: (h: GrnProductHistory) => h.grn?.id },
        { header: 'GRN Item ID', maps: 'grn_product_history.grnProduct', get: (h: GrnProductHistory) => h.grnProduct?.id },
        { header: 'Version', maps: 'grn_product_history.version', type: 'integer', get: (h: GrnProductHistory) => h.version },
        { header: 'Change', maps: 'grn_product_history.changeType (added | updated | removed)', get: (h: GrnProductHistory) => h.changeType },
        { header: 'Product ID', maps: 'grn_product_history.product -> product.id', get: (h: GrnProductHistory) => h.product?.id },
        { header: 'Product Code', maps: 'product.productCode', get: (h: GrnProductHistory) => h.product?.productCode },
        { header: 'Product Name', maps: 'product.name', get: (h: GrnProductHistory) => h.product?.name },
        { header: 'Variant', maps: 'product_varient.variantName', get: (h: GrnProductHistory) => h.variant?.variantName },
        { header: 'Old Quantity', maps: 'grn_product_history.oldQuantity', type: 'quantity', get: (h: GrnProductHistory) => h.oldQuantity },
        { header: 'New Quantity', maps: 'grn_product_history.newQuantity', type: 'quantity', get: (h: GrnProductHistory) => h.newQuantity },
        { header: 'Old Rate', maps: 'grn_product_history.oldRate', type: 'amount', get: (h: GrnProductHistory) => h.oldRate },
        { header: 'New Rate', maps: 'grn_product_history.newRate', type: 'amount', get: (h: GrnProductHistory) => h.newRate },
        { header: 'Old UOM', maps: 'grn_product_history.oldUom -> uom.unit', get: (h: GrnProductHistory) => h.oldUom?.unit },
        { header: 'New UOM', maps: 'grn_product_history.newUom -> uom.unit', get: (h: GrnProductHistory) => h.newUom?.unit },
        { header: 'Old Gross Weight', maps: 'grn_product_history.oldGrossWeight', type: 'quantity', get: (h: GrnProductHistory) => h.oldGrossWeight },
        { header: 'New Gross Weight', maps: 'grn_product_history.newGrossWeight', type: 'quantity', get: (h: GrnProductHistory) => h.newGrossWeight },
        { header: 'Old Packing Material Weight', maps: 'grn_product_history.oldPackingMaterialWeight', type: 'quantity', get: (h: GrnProductHistory) => h.oldPackingMaterialWeight },
        { header: 'New Packing Material Weight', maps: 'grn_product_history.newPackingMaterialWeight', type: 'quantity', get: (h: GrnProductHistory) => h.newPackingMaterialWeight },
        { header: 'Old Net Weight', maps: 'grn_product_history.oldNetWeight', type: 'quantity', get: (h: GrnProductHistory) => h.oldNetWeight },
        { header: 'New Net Weight', maps: 'grn_product_history.newNetWeight', type: 'quantity', get: (h: GrnProductHistory) => h.newNetWeight },
        { header: 'Old Purchase Date', maps: 'grn_product_history.oldPurchaseDate', type: 'date', get: (h: GrnProductHistory) => h.oldPurchaseDate },
        { header: 'New Purchase Date', maps: 'grn_product_history.newPurchaseDate', type: 'date', get: (h: GrnProductHistory) => h.newPurchaseDate },
        { header: 'Old Dispatch Date', maps: 'grn_product_history.oldDispatchDate', type: 'date', get: (h: GrnProductHistory) => h.oldDispatchDate },
        { header: 'New Dispatch Date', maps: 'grn_product_history.newDispatchDate', type: 'date', get: (h: GrnProductHistory) => h.newDispatchDate },
        { header: 'Old Delivery Date', maps: 'grn_product_history.oldDeliveryDate', type: 'date', get: (h: GrnProductHistory) => h.oldDeliveryDate },
        { header: 'New Delivery Date', maps: 'grn_product_history.newDeliveryDate', type: 'date', get: (h: GrnProductHistory) => h.newDeliveryDate },
        { header: 'Old Expected Harvest Date', maps: 'grn_product_history.oldExpectedHarvestDate', type: 'date', get: (h: GrnProductHistory) => h.oldExpectedHarvestDate },
        { header: 'New Expected Harvest Date', maps: 'grn_product_history.newExpectedHarvestDate', type: 'date', get: (h: GrnProductHistory) => h.newExpectedHarvestDate },
        { header: 'Old Packaging Material', maps: 'grn_product_history.oldPackagingMaterial -> packagingMaterialName', get: (h: GrnProductHistory) => h.oldPackagingMaterial?.packagingMaterialName },
        { header: 'New Packaging Material', maps: 'grn_product_history.newPackagingMaterial -> packagingMaterialName', get: (h: GrnProductHistory) => h.newPackagingMaterial?.packagingMaterialName },
        ...userColumns<GrnProductHistory>('Modified By', (h) => h.modifiedBy, 'grn_product_history.modifiedBy'),
        { header: 'Modified At', maps: 'grn_product_history.modifiedAt', type: 'datetime', get: (h: GrnProductHistory) => h.modifiedAt },
      ],
    },
    {
      name: 'GRN Payments',
      refId: (p: GrnPayment) => p.grn?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(GrnPayment)
          .createQueryBuilder('payment')
          .innerJoin('payment.grn', 'parent')
          .addSelect(['parent.id', 'parent.grnNo']);
        joinSelect(qb, 'payment.recordedBy', 'recordedBy', USER_COLUMNS);
        joinSelect(qb, 'payment.voidedBy', 'voidedBy', USER_COLUMNS);
        return qb
          .where('parent.id IN (:...ids)', { ids: ctx.ids })
          .andWhere('payment.isDeleted = false')
          .orderBy('parent.grnNo', 'ASC')
          .addOrderBy('payment.paymentNo', 'ASC')
          .getMany();
      },
      columns: [
        { header: 'GRN No', maps: 'grns.grnNo', get: (p: GrnPayment) => p.grn?.grnNo },
        { header: 'Payment No', maps: 'grn_payments.payment_no', type: 'integer', get: (p: GrnPayment) => p.paymentNo },
        { header: 'Payment Date', maps: 'grn_payments.payment_date', type: 'date', get: (p: GrnPayment) => p.paymentDate },
        { header: 'Amount', maps: 'grn_payments.amount', type: 'amount', get: (p: GrnPayment) => p.amount },
        { header: 'Partial / Full', maps: 'grn_payments.payment_type', get: (p: GrnPayment) => (p.voidedAt ? null : p.paymentType) },
        { header: 'Payment Mode', maps: 'grn_payments.payment_mode', get: (p: GrnPayment) => p.paymentMode },
        { header: 'Paid To Account No', maps: 'grn_payments.paid_to_account_no', get: (p: GrnPayment) => p.paidToAccountNo },
        { header: 'Paid To IFSC', maps: 'grn_payments.paid_to_ifsc', get: (p: GrnPayment) => p.paidToIfsc },
        { header: 'Paid To Bank', maps: 'grn_payments.paid_to_bank_name', get: (p: GrnPayment) => p.paidToBankName },
        { header: 'Reference No', maps: 'grn_payments.reference_no', get: (p: GrnPayment) => p.referenceNo },
        { header: 'Remarks', maps: 'grn_payments.remarks', get: (p: GrnPayment) => p.remarks },
        { header: 'Balance After', maps: 'grn_payments.balance_after', type: 'amount', get: (p: GrnPayment) => (p.voidedAt ? null : p.balanceAfter) },
        ...userColumns<GrnPayment>('Recorded By', (p) => p.recordedBy, 'grn_payments.recordedBy'),
        { header: 'Recorded At', maps: 'grn_payments.createdAt', type: 'datetime', get: (p: GrnPayment) => p.createdAt },
        { header: 'Voided', maps: 'grn_payments.voided_at IS NOT NULL', type: 'boolean', get: (p: GrnPayment) => !!p.voidedAt },
        { header: 'Voided At', maps: 'grn_payments.voided_at', type: 'datetime', get: (p: GrnPayment) => p.voidedAt },
        ...userColumns<GrnPayment>('Voided By', (p) => p.voidedBy, 'grn_payments.voidedBy'),
        { header: 'Void Reason', maps: 'grn_payments.void_reason', get: (p: GrnPayment) => p.voidReason },
      ],
    },
    withoutColumns(approvalSheet({ numberHeader: 'GRN No', sources: [{ entity: GRN, numberColumn: 'grnNo' }] }), APPROVAL_ID_COLUMNS),
  ],
};
