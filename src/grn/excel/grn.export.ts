/**
 * GRN Excel export: header, line items, price/quantity revision history and
 * approval history.
 *
 * Field map (from the entities):
 *   grns                     -> GRN sheet
 *   payment_info_for_grn     -> GRN sheet (payment columns)
 *   grn_products             -> GRN Items sheet
 *   grn_product_history      -> GRN History sheet (one row per revision version)
 *   documents + approval_stage_info -> status columns + Approvals sheet
 */

import { GRN } from '../entity/grn.entity';
import { GrnProduct } from '../entity/grnProduct.entity';
import { GrnProductHistory } from '../entity/grnProductHistory.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  FARMER_COLUMNS,
  PRODUCT_COLUMNS,
  USER_COLUMNS,
  VARIANT_COLUMNS,
  VENDOR_COLUMNS,
  joinProductLine,
  joinSelect,
} from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  auditColumns,
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
        joinSelect(qb, 'grn.dealSlipId', 'dealSlip', ['id', 'dealSlipNo', 'lotNo']);
        joinSelect(qb, 'grn.rfpa', 'rfpa', ['id', 'rfpaId']);
        joinSelect(qb, 'grn.purchaseLocation', 'purchaseLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'grn.purchaseForSalesLocation', 'purchaseForSalesLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'grn.location', 'location', BRANCH_COLUMNS);
        joinSelect(qb, 'grn.selectedVendor', 'vendor', VENDOR_COLUMNS);
        joinSelect(qb, 'grn.selectedFarmer', 'farmer', FARMER_COLUMNS);
        joinSelect(qb, 'grn.purchaseInstructionsBy', 'purchaseInstructionsBy', USER_COLUMNS);
        joinSelect(qb, 'grn.purchaseBy', 'purchaseBy', USER_COLUMNS);
        joinSelect(qb, 'grn.createdBy', 'createdBy', USER_COLUMNS);
        joinSelect(qb, 'grn.currentLevel', 'currentLevel', ['id', 'name', 'hierarchy']);
        qb.leftJoinAndSelect('grn.paymentInfo', 'paymentInfo');
        return qb.where('grn.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'GRN No', maps: 'grns.grnNo', get: (r) => r.record.grnNo },
        { header: 'GRN Record ID', maps: 'grns.id', get: (r) => r.record.id },
        { header: 'GRN Type', maps: 'grns.grnType', get: (r) => r.record.grnType },
        { header: 'Purchase Type', maps: 'grns.purchaseType', get: (r) => r.record.purchaseType },
        { header: 'Location Type', maps: 'grns.locationType', get: (r) => r.record.locationType },
        { header: 'Requesting Department', maps: 'grns.requestingDepartment', get: (r) => r.record.requestingDepartment },
        { header: 'Source', maps: 'grns.source', get: (r) => r.record.source },
        ...companyColumns<Row>((r) => r.record.companyName),
        { header: 'Deal Slip No', maps: 'grns.dealSlipId -> deal_slips.dealSlipNo', get: (r) => r.record.dealSlipId?.dealSlipNo },
        { header: 'Deal Slip Lot No', maps: 'grns.dealSlipId -> deal_slips.lotNo', get: (r) => r.record.dealSlipId?.lotNo },
        { header: 'RFPA No', maps: 'grns.rfpa -> rfpa.rfpaId', get: (r) => r.record.rfpa?.rfpaId },
        branchColumn<Row>('Location', (r) => r.record.location, 'grns.location'),
        { header: 'Base Location', maps: 'grns.baseLocation', get: (r) => r.record.baseLocation },
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
        { header: 'Amount Status', maps: 'grns.ammountStatus', get: (r) => r.record.ammountStatus },
        { header: 'Vehicle No', maps: 'grns.vehicleNo', get: (r) => r.record.vehicleNo },
        { header: 'Received Through', maps: 'grns.receivedThrough', get: (r) => r.record.receivedThrough },
        { header: 'Crates In', maps: 'grns.cratesIn', type: 'quantity', get: (r) => r.record.cratesIn },
        { header: 'Delivery Receiving Person', maps: 'grns.deliveryReceivingPerson', get: (r) => r.record.deliveryReceivingPerson },
        { header: 'Security Person', maps: 'grns.securityPerson', get: (r) => r.record.securityPerson },
        { header: 'RMN', maps: 'grns.rmn', get: (r) => r.record.rmn },
        { header: 'Purchased By', maps: 'grns.purchasedBy', get: (r) => r.record.purchasedBy },
        ...userColumns<Row>('Purchase By User', (r) => r.record.purchaseBy, 'grns.purchaseBy'),
        ...userColumns<Row>('Purchase Instructions By', (r) => r.record.purchaseInstructionsBy, 'grns.purchaseInstructionsBy'),
        { header: 'Approval Note', maps: 'grns.approvalNote', get: (r) => r.record.approvalNote },
        { header: 'Special Requirement', maps: 'grns.specialReq', get: (r) => r.record.specialReq },
        { header: 'Current Level', maps: 'grns.currentLevel -> levels.name', get: (r) => r.record.currentLevel?.name },
        { header: 'Remark', maps: 'grns.remark', get: (r) => r.record.remark },
        { header: 'Payment Mode', maps: 'payment_info_for_grn.paymentMode', get: (r) => r.record.paymentInfo?.paymentMode },
        { header: 'Payment Date', maps: 'payment_info_for_grn.paymentDate', type: 'date', get: (r) => r.record.paymentInfo?.paymentDate },
        { header: 'Advance Paid Amount', maps: 'payment_info_for_grn.advancePaidAmt', type: 'amount', get: (r) => r.record.paymentInfo?.advancePaidAmt },
        { header: 'Remaining Amount', maps: 'payment_info_for_grn.remainingAmt', type: 'amount', get: (r) => r.record.paymentInfo?.remainingAmt },
        { header: 'Payment Terms', maps: 'payment_info_for_grn.paymentTerms', get: (r) => r.record.paymentInfo?.paymentTerms },
        { header: 'Due Date', maps: 'payment_info_for_grn.dueDate', type: 'date', get: (r) => r.record.paymentInfo?.dueDate },
        { header: 'Credit Period', maps: 'payment_info_for_grn.creditPeriod', type: 'number', get: (r) => r.record.paymentInfo?.creditPeriod },
        { header: 'AQR Created', maps: 'grns.isAQRCreated', type: 'boolean', get: (r) => r.record.isAQRCreated },
        { header: 'Inward Created', maps: 'grns.isInwardCreated', type: 'boolean', get: (r) => r.record.isInwardCreated },
        { header: 'Dump Created', maps: 'grns.isDumpCreated', type: 'boolean', get: (r) => r.record.isDumpCreated },
        { header: 'Customer DC Created', maps: 'grns.isDCForCustomerCreated', type: 'boolean', get: (r) => r.record.isDCForCustomerCreated },
        { header: 'Multi Cash Voucher Created', maps: 'grns.isMCVoucherCreated', type: 'boolean', get: (r) => r.record.isMCVoucherCreated },
        { header: 'Transport Voucher Created', maps: 'grns.isTPVoucherCreated', type: 'boolean', get: (r) => r.record.isTPVoucherCreated },
        { header: 'Packing Material Voucher Created', maps: 'grns.isPMPVoucherCreated', type: 'boolean', get: (r) => r.record.isPMPVoucherCreated },
        { header: 'Labour Voucher Created', maps: 'grns.isLPVoucherCreated', type: 'boolean', get: (r) => r.record.isLPVoucherCreated },
        ...userColumns<Row>('Created By', (r) => r.record.createdBy, 'grns.createdBy'),
        ...auditColumns<Row>((r) => r.record, 'grns'),
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
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'GRN No', maps: 'grns.grnNo', get: (l: GrnProduct) => l.grn?.grnNo },
        { header: 'GRN Record ID', maps: 'grns.id', get: (l: GrnProduct) => l.grn?.id },
        { header: 'Item ID', maps: 'grn_products.id', get: (l: GrnProduct) => l.id },
        ...productColumns<GrnProduct>((l) => l.productName, (l) => l.variant),
        uomColumn<GrnProduct>('UOM', (l) => l.uom, 'grn_products.uom'),
        { header: 'Quantity', maps: 'grn_products.quantity', type: 'quantity', get: (l: GrnProduct) => l.quantity },
        { header: 'Revised Quantity', maps: 'grn_products.revisedQuantity', type: 'quantity', get: (l: GrnProduct) => l.revisedQuantity },
        { header: 'Unit Price', maps: 'grn_products.unitPrice', type: 'amount', get: (l: GrnProduct) => l.unitPrice },
        { header: 'Revised Rate', maps: 'grn_products.revisedRate', type: 'amount', get: (l: GrnProduct) => l.revisedRate },
        { header: 'Amount', maps: 'grn_products.amount', type: 'amount', get: (l: GrnProduct) => l.amount },
        { header: 'Gross Weight', maps: 'grn_products.grossWeight', type: 'quantity', get: (l: GrnProduct) => l.grossWeight },
        { header: 'Packing Material Weight', maps: 'grn_products.packingMaterialWeight', type: 'quantity', get: (l: GrnProduct) => l.packingMaterialWeight },
        { header: 'Net Weight', maps: 'grn_products.netWeight', type: 'quantity', get: (l: GrnProduct) => l.netWeight },
        { header: 'Return To Vendor', maps: 'grn_products.rtv', type: 'boolean', get: (l: GrnProduct) => l.rtv },
        { header: 'Purchase Date', maps: 'grn_products.purchaseDate', type: 'date', get: (l: GrnProduct) => l.purchaseDate },
        { header: 'Expected Harvest Date', maps: 'grn_products.expectedHarvestDate', type: 'date', get: (l: GrnProduct) => l.expectedHarvestDate },
        { header: 'Dispatch Date', maps: 'grn_products.dispatchDate', type: 'date', get: (l: GrnProduct) => l.dispatchDate },
        { header: 'Delivery Date', maps: 'grn_products.deliveryDate', type: 'date', get: (l: GrnProduct) => l.deliveryDate },
        ...auditColumns<GrnProduct>((l) => l, 'grn_products'),
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
        { header: 'Product ID', maps: 'grn_product_history.product -> product.id', get: (h: GrnProductHistory) => h.product?.id },
        { header: 'Product Code', maps: 'product.productCode', get: (h: GrnProductHistory) => h.product?.productCode },
        { header: 'Product Name', maps: 'product.name', get: (h: GrnProductHistory) => h.product?.name },
        { header: 'Variant', maps: 'product_varient.variantName', get: (h: GrnProductHistory) => h.variant?.variantName },
        { header: 'Old Quantity', maps: 'grn_product_history.oldQuantity', type: 'quantity', get: (h: GrnProductHistory) => h.oldQuantity },
        { header: 'New Quantity', maps: 'grn_product_history.newQuantity', type: 'quantity', get: (h: GrnProductHistory) => h.newQuantity },
        { header: 'Old Rate', maps: 'grn_product_history.oldRate', type: 'amount', get: (h: GrnProductHistory) => h.oldRate },
        { header: 'New Rate', maps: 'grn_product_history.newRate', type: 'amount', get: (h: GrnProductHistory) => h.newRate },
        ...userColumns<GrnProductHistory>('Modified By', (h) => h.modifiedBy, 'grn_product_history.modifiedBy'),
        { header: 'Modified At', maps: 'grn_product_history.modifiedAt', type: 'datetime', get: (h: GrnProductHistory) => h.modifiedAt },
      ],
    },
    approvalSheet({ numberHeader: 'GRN No', sources: [{ entity: GRN, numberColumn: 'grnNo' }] }),
  ],
};
