/**
 * Return by Customer Excel export: header, returned items and approval history.
 *
 * Field map (from the entities):
 *   return_by_customer             -> Return By Customer sheet
 *   returned_products_by_customer  -> Returned Items sheet
 *   item (the challan's lines)     -> Returned Items: original/accepted quantities
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * A return line only stores what came back. The original dispatched quantity and
 * the accepted quantity live on the delivery-challan line for the same product
 * and variant, so they are looked up there.
 */

import { PostReturnByCustomer } from '../entity/postReturnByCustomer.entity';
import { ReturnedProducts } from '../entity/returnProduct.entity';
import { Item } from '../../deliveryChallans/deliverychllan/entity/dItem.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import {
  BRANCH_COLUMNS,
  COMPANY_COLUMNS,
  CUSTOMER_COLUMNS,
  USER_COLUMNS,
  aggregateLines,
  joinProductLine,
  joinSelect,
} from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import {
  auditColumns,
  branchColumn,
  companyColumns,
  customerColumns,
  productColumns,
  uomColumn,
  userColumns,
} from '../../excel/export/commonColumns';

type ReturnRecord = PostReturnByCustomer & {
  returnedTotal?: number | null;
  rejectedTotal?: number | null;
  lineCount?: number;
};
type Row = DocumentRow<ReturnRecord>;
type ReturnLine = ReturnedProducts & { challanLine?: Item | null };

const lineKey = (challanId?: string, productId?: string, variantId?: string | null) =>
  `${challanId ?? ''}|${productId ?? ''}|${variantId ?? ''}`;

export const RETURN_BY_CUSTOMER_EXPORT: ExportDefinition = {
  fileStem: 'Return_By_Customer',
  sheets: [
    documentHeaderSheet<ReturnRecord>({
      name: 'Return By Customer',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(PostReturnByCustomer).createQueryBuilder('rbc');
        joinSelect(qb, 'rbc.deliveryChallanNo', 'challan', ['id', 'challanNo']);
        joinSelect(qb, 'rbc.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'rbc.location', 'location', BRANCH_COLUMNS);
        joinSelect(qb, 'rbc.customerName', 'customer', CUSTOMER_COLUMNS);
        joinSelect(qb, 'rbc.createdBy', 'createdBy', USER_COLUMNS);
        const records: ReturnRecord[] = await qb.where('rbc.id IN (:...ids)', { ids: ctx.ids }).getMany();

        const [returned, rejected] = await Promise.all([
          aggregateLines(ctx.manager, ReturnedProducts, 'postReturn', 'returnedQtyAmt', ctx.ids),
          aggregateLines(ctx.manager, ReturnedProducts, 'postReturn', 'rejectedQtyAmt', ctx.ids),
        ]);
        for (const record of records) {
          record.lineCount = returned.get(record.id)?.count ?? 0;
          record.returnedTotal = returned.get(record.id)?.total ?? null;
          record.rejectedTotal = rejected.get(record.id)?.total ?? null;
        }
        return records;
      },
      columns: [
        { header: 'Return No', maps: 'return_by_customer.rbcNo', get: (r) => r.record.rbcNo },
        { header: 'Return Record ID', maps: 'return_by_customer.id', get: (r) => r.record.id },
        { header: 'Return Date', maps: 'return_by_customer.date', type: 'date', get: (r) => r.record.date },
        ...companyColumns<Row>((r) => r.record.companyName),
        branchColumn<Row>('Location', (r) => r.record.location, 'return_by_customer.location'),
        ...customerColumns<Row>((r) => r.record.customerName),
        { header: 'Original Delivery Challan No', maps: 'return_by_customer.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
        { header: 'Line Items', maps: 'COUNT(returned_products_by_customer)', type: 'integer', get: (r) => r.record.lineCount },
        { header: 'Returned Amount', maps: 'SUM(returned_products_by_customer.returnedQtyAmt)', type: 'amount', get: (r) => r.record.returnedTotal },
        { header: 'Rejected Amount', maps: 'SUM(returned_products_by_customer.rejectedQtyAmt)', type: 'amount', get: (r) => r.record.rejectedTotal },
        { header: 'Remark', maps: 'return_by_customer.remark', get: (r) => r.record.remark },
        ...userColumns<Row>('Created By', (r) => r.record.createdBy, 'return_by_customer.createdBy'),
        ...auditColumns<Row>((r) => r.record, 'return_by_customer'),
        ...documentColumns<ReturnRecord>(),
      ],
    }),
    {
      name: 'Returned Items',
      refId: (line: ReturnLine) => line.postReturn?.id,
      load: async (ctx) => {
        const qb = ctx.manager
          .getRepository(ReturnedProducts)
          .createQueryBuilder('line')
          .innerJoin('line.postReturn', 'parent')
          .addSelect(['parent.id', 'parent.rbcNo']);
        joinSelect(qb, 'parent.deliveryChallanNo', 'challan', ['id', 'challanNo']);
        joinProductLine(qb, 'line', { product: 'productName', variant: 'variant', saleUoM: 'saleUoM' });
        const lines: ReturnLine[] = await qb
          .where('parent.id IN (:...ids)', { ids: ctx.ids })
          .orderBy('line.createdAt', 'ASC')
          .getMany();

        const challanIds = Array.from(
          new Set(lines.map((l) => l.postReturn?.deliveryChallanNo?.id).filter((id): id is string => Boolean(id))),
        );
        if (challanIds.length) {
          const challanLines = await ctx.manager
            .getRepository(Item)
            .createQueryBuilder('item')
            .select(['item.id', 'item.quantity', 'item.acceptedQty', 'item.rejectedQty', 'item.returnedQty'])
            .innerJoin('item.deliveryChallan', 'challan')
            .addSelect('challan.id')
            .leftJoin('item.productName', 'product')
            .addSelect('product.id')
            .leftJoin('item.variant', 'variant')
            .addSelect('variant.id')
            .where('challan.id IN (:...challanIds)', { challanIds })
            .getMany();
          const byKey = new Map(
            challanLines.map((i) => [lineKey(i.deliveryChallan?.id, i.productName?.id, i.variant?.id ?? null), i]),
          );
          for (const line of lines) {
            line.challanLine =
              byKey.get(lineKey(line.postReturn?.deliveryChallanNo?.id, line.productName?.id, line.variant?.id ?? null)) ?? null;
          }
        }
        return lines;
      },
      columns: [
        { header: 'Return No', maps: 'return_by_customer.rbcNo', get: (l: ReturnLine) => l.postReturn?.rbcNo },
        { header: 'Return Record ID', maps: 'return_by_customer.id', get: (l: ReturnLine) => l.postReturn?.id },
        { header: 'Original Delivery Challan No', maps: 'delivery_challan_purchase.challanNo', get: (l: ReturnLine) => l.postReturn?.deliveryChallanNo?.challanNo },
        { header: 'Item ID', maps: 'returned_products_by_customer.id', get: (l: ReturnLine) => l.id },
        ...productColumns<ReturnLine>((l) => l.productName, (l) => l.variant),
        uomColumn<ReturnLine>('Sale UOM', (l) => l.saleUoM, 'returned_products_by_customer.saleUoM'),
        { header: 'Original DC Quantity', maps: 'item.quantity (same challan, product, variant)', type: 'quantity', get: (l: ReturnLine) => l.challanLine?.quantity },
        { header: 'DC Accepted Qty', maps: 'item.acceptedQty', type: 'quantity', get: (l: ReturnLine) => l.challanLine?.acceptedQty },
        { header: 'Unit Price', maps: 'returned_products_by_customer.unitPrice', type: 'amount', get: (l: ReturnLine) => l.unitPrice },
        { header: 'Returned Qty', maps: 'returned_products_by_customer.returnedQty', type: 'quantity', get: (l: ReturnLine) => l.returnedQty },
        { header: 'Returned Amount', maps: 'returned_products_by_customer.returnedQtyAmt', type: 'amount', get: (l: ReturnLine) => l.returnedQtyAmt },
        { header: 'Returned Gross Weight', maps: 'returned_products_by_customer.returnedGrossWt', type: 'quantity', get: (l: ReturnLine) => l.returnedGrossWt },
        { header: 'Returned Packing Material Weight', maps: 'returned_products_by_customer.returnedPackingMaterialWt', type: 'quantity', get: (l: ReturnLine) => l.returnedPackingMaterialWt },
        { header: 'Returned Net Weight', maps: 'returned_products_by_customer.returnedNetWt', type: 'quantity', get: (l: ReturnLine) => l.returnedNetWt },
        { header: 'Rejected Qty', maps: 'returned_products_by_customer.rejectedQty', type: 'quantity', get: (l: ReturnLine) => l.rejectedQty },
        { header: 'Rejected Amount', maps: 'returned_products_by_customer.rejectedQtyAmt', type: 'amount', get: (l: ReturnLine) => l.rejectedQtyAmt },
        { header: 'Rejected Gross Weight', maps: 'returned_products_by_customer.rejectedGrossWt', type: 'quantity', get: (l: ReturnLine) => l.rejectedGrossWt },
        { header: 'Rejected Packing Material Weight', maps: 'returned_products_by_customer.rejectedPackingMaterialWt', type: 'quantity', get: (l: ReturnLine) => l.rejectedPackingMaterialWt },
        { header: 'Rejected Net Weight', maps: 'returned_products_by_customer.rejectedNetWt', type: 'quantity', get: (l: ReturnLine) => l.rejectedNetWt },
        { header: 'Changed', maps: 'returned_products_by_customer.isChanged', type: 'boolean', get: (l: ReturnLine) => l.isChanged },
        ...auditColumns<ReturnLine>((l) => l, 'returned_products_by_customer'),
      ],
    },
    approvalSheet({ numberHeader: 'Return No', sources: [{ entity: PostReturnByCustomer, numberColumn: 'rbcNo' }] }),
  ],
};
