/**
 * AQR (arrival quality report) Excel export: header, quality parameters and
 * approval history.
 *
 * Field map (from the entities):
 *   aqr                      -> AQR sheet (one product per AQR)
 *   aqr_parameter            -> AQR Quality Parameters sheet; parameters are stored
 *                               dynamically per AQR, so every stored row is exported
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * AQR links to a delivery challan; it has no GRN or inward-register relation.
 */

import { Aqr } from '../entity/aqr.entity';
import { AqrParameter } from '../entity/aqrQuality.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  CATEGORY_COLUMNS,
  COMPANY_COLUMNS,
  FARMER_COLUMNS,
  PRODUCT_COLUMNS,
  USER_COLUMNS,
  VARIANT_COLUMNS,
  VENDOR_COLUMNS,
  joinSelect,
} from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  auditColumns,
  branchColumn,
  companyColumns,
  farmerColumns,
  productColumns,
  userColumns,
  vendorColumns,
} from '../../excel/export/commonColumns';

type Row = DocumentRow<Aqr>;

export const AQR_EXPORT: ExportDefinition = {
  fileStem: 'AQR',
  sheets: [
    documentHeaderSheet<Aqr>({
      name: 'AQR',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(Aqr).createQueryBuilder('aqr');
        joinSelect(qb, 'aqr.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'aqr.location', 'location', BRANCH_COLUMNS);
        joinSelect(qb, 'aqr.fromLocation', 'fromLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'aqr.deliveryChallanNo', 'challan', ['id', 'challanNo']);
        joinSelect(qb, 'aqr.selectedVendor', 'vendor', VENDOR_COLUMNS);
        joinSelect(qb, 'aqr.selectedFarmer', 'farmer', FARMER_COLUMNS);
        joinSelect(qb, 'aqr.product', 'product', PRODUCT_COLUMNS);
        joinSelect(qb, 'product.category', 'category', CATEGORY_COLUMNS);
        joinSelect(qb, 'aqr.variant', 'variant', VARIANT_COLUMNS);
        joinSelect(qb, 'aqr.purchaseBy', 'purchaseBy', USER_COLUMNS);
        joinSelect(qb, 'aqr.receivedBy', 'receivedBy', USER_COLUMNS);
        joinSelect(qb, 'aqr.qcCheckBy', 'qcCheckBy', USER_COLUMNS);
        joinSelect(qb, 'aqr.verifiedBy', 'verifiedBy', USER_COLUMNS);
        return qb.where('aqr.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'AQR No', maps: 'aqr.aqrNo', get: (r) => r.record.aqrNo },
        { header: 'AQR Record ID', maps: 'aqr.id', get: (r) => r.record.id },
        { header: 'AQR For', maps: 'aqr.aqrFor', get: (r) => r.record.aqrFor },
        { header: 'Source', maps: 'aqr.source', get: (r) => r.record.source },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Location', (r) => r.record.location, 'aqr.location'),
        branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'aqr.fromLocation'),
        { header: 'Delivery Challan No', maps: 'aqr.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
        ...vendorColumns<Row>((r) => r.record.selectedVendor),
        ...farmerColumns<Row>((r) => r.record.selectedFarmer),
        ...productColumns<Row>((r) => r.record.product, (r) => r.record.variant, 'aqr.product -> product'),
        { header: 'Arrival Date', maps: 'aqr.arrivalDate', type: 'date', get: (r) => r.record.arrivalDate },
        { header: 'Arrived Qty', maps: 'aqr.arrivedQty (text column)', get: (r) => r.record.arrivedQty },
        { header: 'Sampling Qty', maps: 'aqr.samplingQty (text column)', get: (r) => r.record.samplingQty },
        { header: 'Total Qty', maps: 'aqr.totalQty', type: 'quantity', get: (r) => r.record.totalQty },
        { header: 'Total Percent', maps: 'aqr.totalpercent', type: 'percent', get: (r) => r.record.totalpercent },
        ...userColumns<Row>('Purchase By', (r) => r.record.purchaseBy, 'aqr.purchaseBy'),
        ...userColumns<Row>('Received By', (r) => r.record.receivedBy, 'aqr.receivedBy'),
        ...userColumns<Row>('QC Check By', (r) => r.record.qcCheckBy, 'aqr.qcCheckBy'),
        ...userColumns<Row>('Verified By', (r) => r.record.verifiedBy, 'aqr.verifiedBy'),
        { header: 'Remark', maps: 'aqr.remark', get: (r) => r.record.remark },
        ...auditColumns<Row>((r) => r.record, 'aqr'),
        ...documentColumns<Aqr>(),
      ],
    }),
    {
      name: 'AQR Quality Parameters',
      refId: (p: AqrParameter) => p.aqr?.id,
      load: async (ctx) =>
        ctx.manager
          .getRepository(AqrParameter)
          .createQueryBuilder('param')
          .innerJoin('param.aqr', 'parent')
          .addSelect(['parent.id', 'parent.aqrNo'])
          .where('parent.id IN (:...ids)', { ids: ctx.ids })
          .orderBy('param.createdAt', 'ASC')
          .getMany(),
      columns: [
        { header: 'AQR No', maps: 'aqr.aqrNo', get: (p: AqrParameter) => p.aqr?.aqrNo },
        { header: 'AQR Record ID', maps: 'aqr.id', get: (p: AqrParameter) => p.aqr?.id },
        { header: 'Parameter Row ID', maps: 'aqr_parameter.id', get: (p: AqrParameter) => p.id },
        { header: 'Quality Parameter ID', maps: 'aqr_parameter.qualityParameterId', get: (p: AqrParameter) => p.qualityParameterId },
        { header: 'Quality Parameter', maps: 'aqr_parameter.qualityParameterName', get: (p: AqrParameter) => p.qualityParameterName },
        { header: 'Parameter Type', maps: 'aqr_parameter.qualityParameterType', get: (p: AqrParameter) => p.qualityParameterType },
        { header: 'Quantity', maps: 'aqr_parameter.quantity', type: 'quantity', get: (p: AqrParameter) => p.quantity },
        { header: 'Percentage', maps: 'aqr_parameter.percentage', type: 'percent', get: (p: AqrParameter) => p.percentage },
        ...auditColumns<AqrParameter>((p) => p, 'aqr_parameter'),
      ],
    },
    approvalSheet({ numberHeader: 'AQR No', sources: [{ entity: Aqr, numberColumn: 'aqrNo' }] }),
  ],
};
