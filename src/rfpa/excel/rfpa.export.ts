/**
 * RFPA Excel export: header, line items and approval history.
 *
 * Field map (from the entities):
 *   rfpa                     -> RFPA sheet
 *   payment_info_for_rfpa    -> RFPA sheet (payment columns)
 *   rfpa_product             -> RFPA Items sheet
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * RFPA stores one `quantity` per line; there is no separate approved quantity.
 */

import { RFPA } from '../entity/rfpa.entity';
import { RFPAProduct } from '../entity/rfpaProduct.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  FARMER_COLUMNS,
  USER_COLUMNS,
  VENDOR_COLUMNS,
  aggregateLines,
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

type RfpaRecord = RFPA & { lineCount?: number; lineTotal?: number | null };
type Row = DocumentRow<RfpaRecord>;

export const RFPA_EXPORT: ExportDefinition = {
  fileStem: 'RFPA',
  sheets: [
    documentHeaderSheet<RfpaRecord>({
      name: 'RFPA',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(RFPA).createQueryBuilder('rfpa');
        joinSelect(qb, 'rfpa.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'rfpa.purchaseLocation', 'purchaseLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'rfpa.purchaseForSalesLocation', 'purchaseForSalesLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'rfpa.selectedVendor', 'vendor', VENDOR_COLUMNS);
        joinSelect(qb, 'rfpa.selectedFarmer', 'farmer', FARMER_COLUMNS);
        joinSelect(qb, 'rfpa.createdBy', 'createdBy', USER_COLUMNS);
        qb.leftJoinAndSelect('rfpa.paymentInfo', 'paymentInfo');
        const records: RfpaRecord[] = await qb.where('rfpa.id IN (:...ids)', { ids: ctx.ids }).getMany();

        const totals = await aggregateLines(ctx.manager, RFPAProduct, 'rfpa', 'amount', ctx.ids);
        for (const record of records) {
          record.lineCount = totals.get(record.id)?.count ?? 0;
          record.lineTotal = totals.get(record.id)?.total ?? null;
        }
        return records;
      },
      columns: [
        { header: 'RFPA No', maps: 'rfpa.rfpaId', get: (r) => r.record.rfpaId },
        { header: 'RFPA Record ID', maps: 'rfpa.id', get: (r) => r.record.id },
        { header: 'Requesting Department', maps: 'rfpa.requestingDepartment', get: (r) => r.record.requestingDepartment },
        { header: 'Source', maps: 'rfpa.source', get: (r) => r.record.source },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Purchase Location', (r) => r.record.purchaseLocation, 'rfpa.purchaseLocation'),
        { header: 'Other Purchase Location', maps: 'rfpa.otherPurchaseLoc', get: (r) => r.record.otherPurchaseLoc },
        branchColumn<Row>('Purchase For Sales Location', (r) => r.record.purchaseForSalesLocation, 'rfpa.purchaseForSalesLocation'),
        { header: 'Other Purchase For Sales Location', maps: 'rfpa.otherPurchaseForSalesLoc', get: (r) => r.record.otherPurchaseForSalesLoc },
        ...vendorColumns<Row>((r) => r.record.selectedVendor),
        ...farmerColumns<Row>((r) => r.record.selectedFarmer),
        { header: 'Delivery Receiving Person', maps: 'rfpa.deliveryReceivingPerson', get: (r) => r.record.deliveryReceivingPerson },
        { header: 'Packing Instruction', maps: 'rfpa.packingInstruction', get: (r) => r.record.packingInstruction },
        { header: 'Special Requirement', maps: 'rfpa.specialReq', get: (r) => r.record.specialReq },
        { header: 'Remark', maps: 'rfpa.remark', get: (r) => r.record.remark },
        { header: 'Deal Slip Created', maps: 'rfpa.isDealSlipCreated', type: 'boolean', get: (r) => r.record.isDealSlipCreated },
        { header: 'Line Items', maps: 'COUNT(rfpa_product)', type: 'integer', get: (r) => r.record.lineCount },
        { header: 'Items Total Amount', maps: 'SUM(rfpa_product.amount)', type: 'amount', get: (r) => r.record.lineTotal },
        { header: 'Payment Mode', maps: 'payment_info_for_rfpa.paymentMode', get: (r) => r.record.paymentInfo?.paymentMode },
        { header: 'Payment Date', maps: 'payment_info_for_rfpa.paymentDate', type: 'date', get: (r) => r.record.paymentInfo?.paymentDate },
        { header: 'Advance Paid Amount', maps: 'payment_info_for_rfpa.advancePaidAmt', type: 'amount', get: (r) => r.record.paymentInfo?.advancePaidAmt },
        { header: 'Payment Terms', maps: 'payment_info_for_rfpa.paymentTerms', type: 'number', get: (r) => r.record.paymentInfo?.paymentTerms },
        { header: 'Due Date', maps: 'payment_info_for_rfpa.dueDate', type: 'date', get: (r) => r.record.paymentInfo?.dueDate },
        { header: 'Credit Period', maps: 'payment_info_for_rfpa.creditPeriod', type: 'number', get: (r) => r.record.paymentInfo?.creditPeriod },
        { header: 'Validity Of Quote', maps: 'payment_info_for_rfpa.validityOfQuote', get: (r) => r.record.paymentInfo?.validityOfQuote },
        ...userColumns<Row>('Created By', (r) => r.record.createdBy, 'rfpa.createdBy'),
        ...auditColumns<Row>((r) => r.record, 'rfpa'),
        ...documentColumns<RfpaRecord>(),
      ],
    }),
    {
      name: 'RFPA Items',
      refId: (line: RFPAProduct) => line.rfpa?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(RFPAProduct)
          .createQueryBuilder('line')
          .innerJoin('line.rfpa', 'parent')
          .addSelect(['parent.id', 'parent.rfpaId']);
        joinProductLine(qb, 'line');
        return qb.where('parent.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
      },
      columns: [
        { header: 'RFPA No', maps: 'rfpa.rfpaId', get: (l: RFPAProduct) => l.rfpa?.rfpaId },
        { header: 'RFPA Record ID', maps: 'rfpa.id', get: (l: RFPAProduct) => l.rfpa?.id },
        { header: 'Item ID', maps: 'rfpa_product.id', get: (l: RFPAProduct) => l.id },
        ...productColumns<RFPAProduct>((l) => l.productName, (l) => l.variant),
        { header: 'Grade', maps: 'rfpa_product.grade', get: (l: RFPAProduct) => l.grade },
        { header: 'Count', maps: 'rfpa_product.count', get: (l: RFPAProduct) => l.count },
        { header: 'Size', maps: 'rfpa_product.size', get: (l: RFPAProduct) => l.size },
        { header: 'Origin', maps: 'rfpa_product.origin', get: (l: RFPAProduct) => l.origin },
        { header: 'Variety', maps: 'rfpa_product.variety', get: (l: RFPAProduct) => l.variety },
        { header: 'Quantity', maps: 'rfpa_product.quantity', type: 'quantity', get: (l: RFPAProduct) => l.quantity },
        uomColumn<RFPAProduct>('UOM', (l) => l.uom, 'rfpa_product.uom'),
        { header: 'Unit Price', maps: 'rfpa_product.unitPrice', type: 'amount', get: (l: RFPAProduct) => l.unitPrice },
        { header: 'Amount', maps: 'rfpa_product.amount', type: 'amount', get: (l: RFPAProduct) => l.amount },
        { header: 'Purchase Date', maps: 'rfpa_product.purchaseDate', type: 'date', get: (l: RFPAProduct) => l.purchaseDate },
        { header: 'Expected Harvest Date', maps: 'rfpa_product.expectedHarvestDate', type: 'date', get: (l: RFPAProduct) => l.expectedHarvestDate },
        { header: 'Dispatch Date', maps: 'rfpa_product.dispatchDate', type: 'date', get: (l: RFPAProduct) => l.dispatchDate },
        { header: 'Delivery Date', maps: 'rfpa_product.deliveryDate', type: 'date', get: (l: RFPAProduct) => l.deliveryDate },
        ...auditColumns<RFPAProduct>((l) => l, 'rfpa_product'),
      ],
    },
    approvalSheet({ numberHeader: 'RFPA No', sources: [{ entity: RFPA, numberColumn: 'rfpaId' }] }),
  ],
};
