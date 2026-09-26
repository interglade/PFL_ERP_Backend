/**
 * Customer Delivery Challan Excel export: header, line items and approval history.
 *
 * Field map (from the entities):
 *   delivery_challan_purchase (type customer_delivery_challan) -> Customer DC sheet
 *   invoices / return_by_customer raised against the challan   -> reference columns
 *   item                                                       -> Customer DC Items sheet
 *   documents + approval_stage_info                            -> status columns + Approvals sheet
 *
 * Discount and tax are charged on the Final Invoice, not stored on challan lines.
 */

import { CustomerDeliveryChallan } from '../entity/customerDeliveryChallan.entity';
import { ExportDefinition } from '../../../excel/export/exportTypes';
import { ADDRESS_COLUMNS, BRANCH_COLUMNS, CUSTOMER_COLUMNS, joinSelect } from '../../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
import { addressColumn, branchColumn, customerColumns } from '../../../excel/export/commonColumns';
import { challanBaseColumns, challanItemsSheet, joinChallanBase } from '../../deliverychllan/excel/deliveryChallanCommon.export';

type Row = DocumentRow<CustomerDeliveryChallan>;

export const CUSTOMER_DELIVERY_CHALLAN_EXPORT: ExportDefinition = {
  fileStem: 'Customer_Delivery_Challan',
  sheets: [
    documentHeaderSheet<CustomerDeliveryChallan>({
      name: 'Customer DC',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(CustomerDeliveryChallan).createQueryBuilder('challan');
        joinChallanBase(qb, 'challan');
        joinSelect(qb, 'challan.customerName', 'customer', CUSTOMER_COLUMNS);
        joinSelect(qb, 'challan.fromLocation', 'fromLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'challan.billingAddress', 'billingAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'challan.deliveryAddress', 'deliveryAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'challan.currentShippingAddress', 'currentShippingAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'challan.invoices', 'invoice', ['id', 'invoiceNo']);
        joinSelect(qb, 'challan.returns', 'rbc', ['id', 'rbcNo']);
        return qb.where('challan.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Challan No', maps: 'delivery_challan_purchase.challanNo', get: (r) => r.record.challanNo },
        { header: 'Challan Record ID', maps: 'delivery_challan_purchase.id', get: (r) => r.record.id },
        ...customerColumns<Row>((r) => r.record.customerName),
        { header: 'PO Number', maps: 'delivery_challan_purchase.poNumber', get: (r) => r.record.poNumber },
        branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'delivery_challan_purchase.branch_id'),
        addressColumn<Row>('Billing Address', (r) => r.record.billingAddress, 'delivery_challan_purchase.billingAddres_id'),
        addressColumn<Row>('Delivery Address', (r) => r.record.deliveryAddress, 'delivery_challan_purchase.deliveryAddres_id'),
        addressColumn<Row>('Current Shipping Address', (r) => r.record.currentShippingAddress, 'delivery_challan_purchase.currentshippingAddres_id'),
        { header: 'Invoice Created', maps: 'delivery_challan_purchase.isInvoiceCreated', type: 'boolean', get: (r) => r.record.isInvoiceCreated },
        { header: 'Invoice Nos', maps: 'invoices.invoiceNo', get: (r) => (r.record.invoices ?? []).map((i) => i.invoiceNo) },
        { header: 'Return By Customer Created', maps: 'delivery_challan_purchase.isReturnByCustomerCreated', type: 'boolean', get: (r) => r.record.isReturnByCustomerCreated },
        { header: 'Return By Customer Nos', maps: 'return_by_customer.rbcNo', get: (r) => (r.record.returns ?? []).map((ret) => ret.rbcNo) },
        ...challanBaseColumns<CustomerDeliveryChallan>(),
        ...documentColumns<CustomerDeliveryChallan>({ inventory: true }),
      ],
    }),
    challanItemsSheet('Customer DC Items'),
    approvalSheet({ numberHeader: 'Challan No', sources: [{ entity: CustomerDeliveryChallan, numberColumn: 'challanNo' }] }),
  ],
};
