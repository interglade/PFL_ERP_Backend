/**
 * Deal Slip Excel export: header, line items and approval history.
 *
 * Field map (from the entities):
 *   deal_slips               -> Deal Slip sheet
 *   rfpa (+ payment info)    -> Deal Slip sheet: parties, locations, payment terms
 *   rfpa_product             -> Deal Slip Items sheet
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * A deal slip has no line-item table of its own: it is raised against an RFPA
 * and deals on that RFPA's products and prices, so the items sheet lists the
 * linked RFPA's lines. Discount and tax are not stored for deal slips.
 */

import { DealSlip } from '../entity/dealSlip.entity';
import { RFPAProduct } from '../../rfpa/entity/rfpaProduct.entity';
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

type DealSlipRecord = DealSlip & { lineCount?: number; lineTotal?: number | null };
type Row = DocumentRow<DealSlipRecord>;
/** An RFPA line attributed to the deal slip raised against its RFPA. */
type Line = RFPAProduct & { dealSlipId: string; dealSlipNo: string };

export const DEAL_SLIP_EXPORT: ExportDefinition = {
  fileStem: 'Deal_Slip',
  sheets: [
    documentHeaderSheet<DealSlipRecord>({
      name: 'Deal Slip',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(DealSlip).createQueryBuilder('dealSlip');
        joinSelect(qb, 'dealSlip.createdBy', 'createdBy', USER_COLUMNS);
        qb.leftJoin('dealSlip.rfpa', 'rfpa').addSelect([
          'rfpa.id',
          'rfpa.rfpaId',
          'rfpa.source',
          'rfpa.requestingDepartment',
          'rfpa.otherPurchaseLoc',
          'rfpa.otherPurchaseForSalesLoc',
          'rfpa.deliveryReceivingPerson',
          'rfpa.packingInstruction',
        ]);
        joinSelect(qb, 'rfpa.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'rfpa.purchaseLocation', 'purchaseLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'rfpa.purchaseForSalesLocation', 'purchaseForSalesLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'rfpa.selectedVendor', 'vendor', VENDOR_COLUMNS);
        joinSelect(qb, 'rfpa.selectedFarmer', 'farmer', FARMER_COLUMNS);
        qb.leftJoinAndSelect('rfpa.paymentInfo', 'paymentInfo');
        const records: DealSlipRecord[] = await qb.where('dealSlip.id IN (:...ids)', { ids: ctx.ids }).getMany();

        const rfpaIds = records.map((r) => r.rfpa?.id).filter((id): id is string => Boolean(id));
        const totals = await aggregateLines(ctx.manager, RFPAProduct, 'rfpa', 'amount', rfpaIds);
        for (const record of records) {
          const t = record.rfpa ? totals.get(record.rfpa.id) : undefined;
          record.lineCount = t?.count ?? 0;
          record.lineTotal = t?.total ?? null;
        }
        return records;
      },
      columns: [
        { header: 'Deal Slip No', maps: 'deal_slips.dealSlipNo', get: (r) => r.record.dealSlipNo },
        { header: 'Deal Slip Record ID', maps: 'deal_slips.id', get: (r) => r.record.id },
        { header: 'Lot No', maps: 'deal_slips.lotNo', get: (r) => r.record.lotNo },
        { header: 'RFPA No', maps: 'deal_slips.rfpa -> rfpa.rfpaId', get: (r) => r.record.rfpa?.rfpaId },
        { header: 'RFPA Record ID', maps: 'deal_slips.rfpa -> rfpa.id', get: (r) => r.record.rfpa?.id },
        { header: 'Requesting Department', maps: 'deal_slips.requestingDepartment', get: (r) => r.record.requestingDepartment },
        { header: 'Deal Slip Approval Status', maps: 'deal_slips.approvalStatus', get: (r) => r.record.approvalStatus },
        { header: 'Approval Note', maps: 'deal_slips.approvalNote', get: (r) => r.record.approvalNote },
        { header: 'Loading Location', maps: 'deal_slips.loadingLocation', get: (r) => r.record.loadingLocation },
        { header: 'Special Request', maps: 'deal_slips.specialRequest', get: (r) => r.record.specialRequest },
        { header: 'Remark', maps: 'deal_slips.remark', get: (r) => r.record.remark },
        { header: 'Deal Slip Created At', maps: 'deal_slips.dealSlipCreatedAt', type: 'datetime', get: (r) => r.record.dealSlipCreatedAt },
        { header: 'Deal Slip Approved At', maps: 'deal_slips.dealSlipApprovedAt', type: 'datetime', get: (r) => r.record.dealSlipApprovedAt },
        { header: 'GRN Created', maps: 'deal_slips.isGrnCreated', type: 'boolean', get: (r) => r.record.isGrnCreated },
        { header: 'Source', maps: 'rfpa.source', get: (r) => r.record.rfpa?.source },
        ...companyColumns<Row>((r) => r.record.rfpa?.companyName, 'rfpa.companyName -> company'),
        ...vendorColumns<Row>((r) => r.record.rfpa?.selectedVendor, 'rfpa.selectedVendor -> vendor'),
        ...farmerColumns<Row>((r) => r.record.rfpa?.selectedFarmer, 'rfpa.selectedFarmer -> farmer'),
        branchColumn<Row>('Purchase Location', (r) => r.record.rfpa?.purchaseLocation, 'rfpa.purchaseLocation'),
        { header: 'Other Purchase Location', maps: 'rfpa.otherPurchaseLoc', get: (r) => r.record.rfpa?.otherPurchaseLoc },
        branchColumn<Row>('Purchase For Sales Location', (r) => r.record.rfpa?.purchaseForSalesLocation, 'rfpa.purchaseForSalesLocation'),
        { header: 'Other Purchase For Sales Location', maps: 'rfpa.otherPurchaseForSalesLoc', get: (r) => r.record.rfpa?.otherPurchaseForSalesLoc },
        { header: 'Delivery Receiving Person', maps: 'rfpa.deliveryReceivingPerson', get: (r) => r.record.rfpa?.deliveryReceivingPerson },
        { header: 'Packing Instruction', maps: 'rfpa.packingInstruction', get: (r) => r.record.rfpa?.packingInstruction },
        { header: 'Line Items', maps: 'COUNT(rfpa_product)', type: 'integer', get: (r) => r.record.lineCount },
        { header: 'Items Total Amount', maps: 'SUM(rfpa_product.amount)', type: 'amount', get: (r) => r.record.lineTotal },
        { header: 'Payment Mode', maps: 'payment_info_for_rfpa.paymentMode', get: (r) => r.record.rfpa?.paymentInfo?.paymentMode },
        { header: 'Payment Date', maps: 'payment_info_for_rfpa.paymentDate', type: 'date', get: (r) => r.record.rfpa?.paymentInfo?.paymentDate },
        { header: 'Advance Paid Amount', maps: 'payment_info_for_rfpa.advancePaidAmt', type: 'amount', get: (r) => r.record.rfpa?.paymentInfo?.advancePaidAmt },
        { header: 'Payment Terms', maps: 'payment_info_for_rfpa.paymentTerms', type: 'number', get: (r) => r.record.rfpa?.paymentInfo?.paymentTerms },
        { header: 'Due Date', maps: 'payment_info_for_rfpa.dueDate', type: 'date', get: (r) => r.record.rfpa?.paymentInfo?.dueDate },
        { header: 'Credit Period', maps: 'payment_info_for_rfpa.creditPeriod', type: 'number', get: (r) => r.record.rfpa?.paymentInfo?.creditPeriod },
        { header: 'Validity Of Quote', maps: 'payment_info_for_rfpa.validityOfQuote', get: (r) => r.record.rfpa?.paymentInfo?.validityOfQuote },
        ...userColumns<Row>('Created By', (r) => r.record.createdBy, 'deal_slips.createdBy'),
        ...auditColumns<Row>((r) => r.record, 'deal_slips'),
        ...documentColumns<DealSlipRecord>(),
      ],
    }),
    {
      name: 'Deal Slip Items',
      // One row per (deal slip, RFPA line): lines are attributed to every deal slip
      // in the chunk raised against their RFPA.
      refId: (line: Line) => line.dealSlipId,
      load: async (ctx) => {
        const slips = await ctx.manager
          .getRepository(DealSlip)
          .createQueryBuilder('dealSlip')
          .select(['dealSlip.id', 'dealSlip.dealSlipNo'])
          .innerJoin('dealSlip.rfpa', 'rfpa')
          .addSelect(['rfpa.id'])
          .where('dealSlip.id IN (:...ids)', { ids: ctx.ids })
          .getMany();
        const rfpaIds = Array.from(new Set(slips.map((s) => s.rfpa?.id).filter((id): id is string => Boolean(id))));
        if (!rfpaIds.length) return [];

        const qb = ctx.manager
          .getRepository(RFPAProduct)
          .createQueryBuilder('line')
          .innerJoin('line.rfpa', 'parent')
          .addSelect(['parent.id', 'parent.rfpaId']);
        joinProductLine(qb, 'line');
        const lines = await qb.where('parent.id IN (:...rfpaIds)', { rfpaIds }).orderBy('line.createdAt', 'ASC').getMany();

        const rows: Line[] = [];
        for (const slip of slips) {
          for (const line of lines) {
            if (line.rfpa?.id === slip.rfpa?.id) {
              rows.push({ ...line, dealSlipId: slip.id, dealSlipNo: slip.dealSlipNo } as Line);
            }
          }
        }
        return rows;
      },
      columns: [
        { header: 'Deal Slip No', maps: 'deal_slips.dealSlipNo', get: (l: Line) => l.dealSlipNo },
        { header: 'Deal Slip Record ID', maps: 'deal_slips.id', get: (l: Line) => l.dealSlipId },
        { header: 'RFPA No', maps: 'rfpa.rfpaId', get: (l: Line) => l.rfpa?.rfpaId },
        { header: 'Item ID', maps: 'rfpa_product.id', get: (l: Line) => l.id },
        ...productColumns<Line>((l) => l.productName, (l) => l.variant),
        { header: 'Grade', maps: 'rfpa_product.grade', get: (l: Line) => l.grade },
        { header: 'Count', maps: 'rfpa_product.count', get: (l: Line) => l.count },
        { header: 'Size', maps: 'rfpa_product.size', get: (l: Line) => l.size },
        { header: 'Origin', maps: 'rfpa_product.origin', get: (l: Line) => l.origin },
        { header: 'Variety', maps: 'rfpa_product.variety', get: (l: Line) => l.variety },
        { header: 'Quantity', maps: 'rfpa_product.quantity', type: 'quantity', get: (l: Line) => l.quantity },
        uomColumn<Line>('UOM', (l) => l.uom, 'rfpa_product.uom'),
        { header: 'Unit Price', maps: 'rfpa_product.unitPrice', type: 'amount', get: (l: Line) => l.unitPrice },
        { header: 'Amount', maps: 'rfpa_product.amount', type: 'amount', get: (l: Line) => l.amount },
        { header: 'Purchase Date', maps: 'rfpa_product.purchaseDate', type: 'date', get: (l: Line) => l.purchaseDate },
        { header: 'Expected Harvest Date', maps: 'rfpa_product.expectedHarvestDate', type: 'date', get: (l: Line) => l.expectedHarvestDate },
        { header: 'Dispatch Date', maps: 'rfpa_product.dispatchDate', type: 'date', get: (l: Line) => l.dispatchDate },
        { header: 'Delivery Date', maps: 'rfpa_product.deliveryDate', type: 'date', get: (l: Line) => l.deliveryDate },
      ],
    },
    approvalSheet({ numberHeader: 'Deal Slip No', sources: [{ entity: DealSlip, numberColumn: 'dealSlipNo' }] }),
  ],
};
