/**
 * AQR (arrival quality report) Excel export: header + product lines, quality
 * parameters and approval history.
 *
 * Field map (from the entities):
 *   aqr + aqr_product        -> AQR sheet, ONE ROW PER PRODUCT LINE with the header
 *                               fields repeated. A legacy AQR without lines yields
 *                               one row built from its header product columns.
 *   aqr_parameter            -> AQR Quality Parameters sheet; parameters are stored
 *                               dynamically per line (legacy: per AQR), so every
 *                               stored row is exported
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * An AQR links to exactly one source: a GRN (purchase), a Stock Transfer DC
 * (transfer) or a Return By Customer (returned-by-customer).
 */

import { Aqr } from '../entity/aqr.entity';
import { AqrProduct } from '../entity/aqrProduct.entity';
import { AqrParameter } from '../entity/aqrQuality.entity';
import { ExportDefinition, ExportSheet } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  CATEGORY_COLUMNS,
  COMPANY_COLUMNS,
  FARMER_COLUMNS,
  PRODUCT_COLUMNS,
  UOM_COLUMNS,
  USER_COLUMNS,
  VARIANT_COLUMNS,
  VENDOR_COLUMNS,
  joinSelect,
  withoutColumns,
} from '../../excel/export/exportQuery';
import { APPROVAL_ID_AND_STAGE_COLUMNS, DocumentRow, approvalSheet, documentColumns, withDocuments } from '../../excel/export/documentMeta';
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

/** One exported row: the AQR, its approval document and one of its lines. */
interface Row extends DocumentRow<Aqr> {
  /** A stored line, or null on a legacy AQR whose product lives on the header. */
  line: AqrProduct | null;
}

const sourceType = (r: Row): string | null => {
  if (r.record.grn) return 'grn';
  if (r.record.deliveryChallanNo) return 'stock-transfer-dc';
  if (r.record.rbc) return 'rbc';
  return null;
};
const sourceNo = (r: Row): string | null =>
  r.record.grn?.grnNo ?? r.record.deliveryChallanNo?.challanNo ?? r.record.rbc?.rbcNo ?? null;

/** Header + one row per line. */
const aqrSheet: ExportSheet<Row> = {
  name: 'AQR',
  refId: (row) => row.record.id,
  load: async (ctx) => {
    const qb = ctx.manager.getRepository(Aqr).createQueryBuilder('aqr');
    joinSelect(qb, 'aqr.companyName', 'company', COMPANY_COLUMNS);
    joinSelect(qb, 'aqr.location', 'location', BRANCH_COLUMNS);
    joinSelect(qb, 'aqr.fromLocation', 'fromLocation', BRANCH_COLUMNS);
    joinSelect(qb, 'aqr.deliveryChallanNo', 'challan', ['id', 'challanNo']);
    joinSelect(qb, 'aqr.grn', 'grn', ['id', 'grnNo']);
    joinSelect(qb, 'aqr.rbc', 'rbc', ['id', 'rbcNo']);
    joinSelect(qb, 'rbc.customerName', 'customer', ['id', 'organisationName', 'customerCode']);
    joinSelect(qb, 'aqr.selectedVendor', 'vendor', VENDOR_COLUMNS);
    joinSelect(qb, 'aqr.selectedFarmer', 'farmer', FARMER_COLUMNS);
    joinSelect(qb, 'aqr.product', 'product', PRODUCT_COLUMNS);
    joinSelect(qb, 'product.category', 'category', CATEGORY_COLUMNS);
    joinSelect(qb, 'aqr.variant', 'variant', VARIANT_COLUMNS);
    joinSelect(qb, 'aqr.products', 'line', ['id', 'receivedQty', 'arrivedQty', 'samplingQty', 'totalQty', 'totalpercent', 'remark', 'createdAt', 'updatedAt']);
    joinSelect(qb, 'line.productName', 'lineProduct', PRODUCT_COLUMNS);
    joinSelect(qb, 'lineProduct.category', 'lineCategory', CATEGORY_COLUMNS);
    joinSelect(qb, 'line.variant', 'lineVariant', VARIANT_COLUMNS);
    joinSelect(qb, 'line.uom', 'lineUom', UOM_COLUMNS);
    joinSelect(qb, 'aqr.purchaseBy', 'purchaseBy', USER_COLUMNS);
    joinSelect(qb, 'aqr.receivedBy', 'receivedBy', USER_COLUMNS);
    joinSelect(qb, 'aqr.qcCheckBy', 'qcCheckBy', USER_COLUMNS);
    joinSelect(qb, 'aqr.verifiedBy', 'verifiedBy', USER_COLUMNS);
    const records = await qb.where('aqr.id IN (:...ids)', { ids: ctx.ids }).orderBy('line.createdAt', 'ASC').getMany();
    const rows = await withDocuments(ctx, records);
    return rows.flatMap((row): Row[] => {
      const lines = row.record.products ?? [];
      if (lines.length === 0) return [{ ...row, line: null }];
      return lines.map((line) => ({ ...row, line }));
    });
  },
  columns: [
    { header: 'AQR No', maps: 'aqr.aqrNo', get: (r) => r.record.aqrNo },
    { header: 'AQR For', maps: 'aqr.aqrFor', get: (r) => r.record.aqrFor },
    { header: 'Source Type', maps: 'aqr.grn / aqr.deliveryChallanNo / aqr.rbc (whichever is set)', get: sourceType },
    { header: 'Source No', maps: 'grns.grnNo / delivery_challan_purchase.challanNo / return_by_customer.rbcNo', get: sourceNo },
    { header: 'GRN No', maps: 'aqr.grn -> grns.grnNo', get: (r) => r.record.grn?.grnNo },
    { header: 'Delivery Challan No', maps: 'aqr.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
    { header: 'RBC No', maps: 'aqr.rbc -> return_by_customer.rbcNo', get: (r) => r.record.rbc?.rbcNo },
    { header: 'Party Source', maps: 'aqr.source', get: (r) => r.record.source },
    ...companyColumns<Row>((r) => r.record.companyName),
    branchColumn<Row>('Location', (r) => r.record.location, 'aqr.location'),
    branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'aqr.fromLocation'),
    ...vendorColumns<Row>((r) => r.record.selectedVendor),
    ...farmerColumns<Row>((r) => r.record.selectedFarmer),
    { header: 'Customer Code', maps: 'aqr.rbc -> return_by_customer.customerName -> customers.customerCode', get: (r) => r.record.rbc?.customerName?.customerCode },
    { header: 'Customer Name', maps: 'aqr.rbc -> return_by_customer.customerName -> customers.organisationName', get: (r) => r.record.rbc?.customerName?.organisationName },
    { header: 'Arrival Date', maps: 'aqr.arrivalDate', type: 'date', get: (r) => r.record.arrivalDate },
    { header: 'Line ID', maps: 'aqr_product.id (empty on a legacy header-only AQR)', get: (r) => r.line?.id },
    ...productColumns<Row>(
      (r) => r.line?.productName ?? r.record.product,
      (r) => r.line?.variant ?? r.record.variant,
      'aqr_product.productName -> product (legacy: aqr.product)',
    ),
    uomColumn<Row>('UOM', (r) => r.line?.uom, 'aqr_product.uom'),
    { header: 'Received Qty (kg)', maps: 'aqr_product.receivedQty', type: 'quantity', get: (r) => r.line?.receivedQty },
    { header: 'Arrived Qty', maps: 'aqr_product.arrivedQty (legacy: aqr.arrivedQty text column)', type: 'quantity', get: (r) => r.line ? r.line.arrivedQty : r.record.arrivedQty },
    { header: 'Sampling Qty', maps: 'aqr_product.samplingQty (legacy: aqr.samplingQty text column)', type: 'quantity', get: (r) => r.line ? r.line.samplingQty : r.record.samplingQty },
    { header: 'Line Total Qty', maps: 'aqr_product.totalQty (legacy: aqr.totalQty)', type: 'quantity', get: (r) => r.line ? r.line.totalQty : r.record.totalQty },
    { header: 'Line Total Percent', maps: 'aqr_product.totalpercent (legacy: aqr.totalpercent)', type: 'percent', get: (r) => r.line ? r.line.totalpercent : r.record.totalpercent },
    { header: 'Line Remark', maps: 'aqr_product.remark', get: (r) => r.line?.remark },
    { header: 'Total Qty', maps: 'aqr.totalQty', type: 'quantity', get: (r) => r.record.totalQty },
    { header: 'Total Percent', maps: 'aqr.totalpercent', type: 'percent', get: (r) => r.record.totalpercent },
    ...userColumns<Row>('Purchase By', (r) => r.record.purchaseBy, 'aqr.purchaseBy'),
    ...userColumns<Row>('Received By', (r) => r.record.receivedBy, 'aqr.receivedBy'),
    ...userColumns<Row>('QC Check By', (r) => r.record.qcCheckBy, 'aqr.qcCheckBy'),
    ...userColumns<Row>('Verified By', (r) => r.record.verifiedBy, 'aqr.verifiedBy'),
    { header: 'Remark', maps: 'aqr.remark', get: (r) => r.record.remark },
    ...documentColumns<Aqr>().map((c) => ({ ...c, get: (r: Row) => c.get(r) })),
  ],
};

/** The AQR a parameter belongs to: through its line on new rows, directly on legacy rows. */
const parameterAqr = (p: AqrParameter): Aqr | undefined => p.aqrProduct?.aqr ?? p.aqr ?? undefined;

export const AQR_EXPORT: ExportDefinition = {
  fileStem: 'AQR',
  sheets: [
    aqrSheet,
    {
      name: 'AQR Quality Parameters',
      refId: (p: AqrParameter) => parameterAqr(p)?.id,
      load: async (ctx) =>
        ctx.manager
          .getRepository(AqrParameter)
          .createQueryBuilder('param')
          .leftJoin('param.aqr', 'parent')
          .addSelect(['parent.id', 'parent.aqrNo'])
          .leftJoin('param.aqrProduct', 'line')
          .addSelect(['line.id'])
          .leftJoin('line.aqr', 'lineParent')
          .addSelect(['lineParent.id', 'lineParent.aqrNo'])
          .leftJoin('line.productName', 'lineProduct')
          .addSelect(['lineProduct.id', 'lineProduct.name', 'lineProduct.productCode'])
          .leftJoin('line.variant', 'lineVariant')
          .addSelect(['lineVariant.id', 'lineVariant.variantName'])
          .where('parent.id IN (:...ids) OR lineParent.id IN (:...ids)', { ids: ctx.ids })
          .orderBy('param.createdAt', 'ASC')
          .getMany(),
      columns: [
        { header: 'AQR No', maps: 'aqr.aqrNo', get: (p: AqrParameter) => parameterAqr(p)?.aqrNo },
        { header: 'AQR Record ID', maps: 'aqr.id', get: (p: AqrParameter) => parameterAqr(p)?.id },
        { header: 'Line ID', maps: 'aqr_parameter.aqr_product_id (empty on legacy rows)', get: (p: AqrParameter) => p.aqrProduct?.id },
        { header: 'Product Code', maps: 'aqr_product.productName -> product.productCode', get: (p: AqrParameter) => p.aqrProduct?.productName?.productCode },
        { header: 'Product Name', maps: 'aqr_product.productName -> product.name', get: (p: AqrParameter) => p.aqrProduct?.productName?.name },
        { header: 'Variant', maps: 'aqr_product.variant -> product_varient.variantName', get: (p: AqrParameter) => p.aqrProduct?.variant?.variantName },
        { header: 'Parameter Row ID', maps: 'aqr_parameter.id', get: (p: AqrParameter) => p.id },
        { header: 'Quality Parameter ID', maps: 'aqr_parameter.qualityParameterId', get: (p: AqrParameter) => p.qualityParameterId },
        { header: 'Quality Parameter', maps: 'aqr_parameter.qualityParameterName', get: (p: AqrParameter) => p.qualityParameterName },
        { header: 'Parameter Type', maps: 'aqr_parameter.qualityParameterType', get: (p: AqrParameter) => p.qualityParameterType },
        { header: 'Quantity', maps: 'aqr_parameter.quantity', type: 'quantity', get: (p: AqrParameter) => p.quantity },
        { header: 'Percentage', maps: 'aqr_parameter.percentage', type: 'percent', get: (p: AqrParameter) => p.percentage },
        ...auditColumns<AqrParameter>((p) => p, 'aqr_parameter'),
      ],
    },
    withoutColumns(approvalSheet({ numberHeader: 'AQR No', sources: [{ entity: Aqr, numberColumn: 'aqrNo' }] }), APPROVAL_ID_AND_STAGE_COLUMNS),
  ],
};
