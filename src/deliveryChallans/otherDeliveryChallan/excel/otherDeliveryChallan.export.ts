/**
 * Other Delivery Challan Excel export: header, line items and approval history.
 *
 * Field map (from the entities):
 *   delivery_challan_purchase (type other-delivery-challan) -> Other DC sheet
 *   item                                                    -> Other DC Items sheet
 *   documents + approval_stage_info                         -> status columns + Approvals sheet
 *
 * The party on an Other DC is free text (`other_customer_*`), not a customer record.
 */

import { OtherDeliveryChallan } from '../entity/otherDeliveryChallan.entity';
import { ExportDefinition } from '../../../excel/export/exportTypes';
import { ADDRESS_COLUMNS, BRANCH_COLUMNS, joinSelect, withoutColumns } from '../../../excel/export/exportQuery';
import { APPROVAL_ID_AND_STAGE_COLUMNS, DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
import { addressColumn, branchColumn } from '../../../excel/export/commonColumns';
import { challanBaseColumns, challanItemsSheet, joinChallanBase } from '../../deliverychllan/excel/deliveryChallanCommon.export';

type Row = DocumentRow<OtherDeliveryChallan>;

export const OTHER_DELIVERY_CHALLAN_EXPORT: ExportDefinition = {
  fileStem: 'Other_Delivery_Challan',
  sheets: [
    documentHeaderSheet<OtherDeliveryChallan>({
      name: 'Other DC',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(OtherDeliveryChallan).createQueryBuilder('challan');
        joinChallanBase(qb, 'challan');
        joinSelect(qb, 'challan.fromLocation', 'fromLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'challan.billingAddress', 'billingAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'challan.shippingAddress', 'shippingAddress', ADDRESS_COLUMNS);
        return qb.where('challan.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Challan No', maps: 'delivery_challan_purchase.challanNo', get: (r) => r.record.challanNo },
        branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'delivery_challan_purchase.other_from_location_id_for_other'),
        { header: 'Party Name', maps: 'delivery_challan_purchase.other_customer_name', get: (r) => r.record.customer },
        { header: 'Customer Type', maps: 'delivery_challan_purchase.other_customer_type', get: (r) => r.record.customerType },
        { header: 'Party Contact No', maps: 'delivery_challan_purchase.other_customer_contact_no', get: (r) => r.record.customerContactNo },
        { header: 'Alternate Contact No', maps: 'delivery_challan_purchase.other_customer_alt_contact_no', get: (r) => r.record.customerAltContactNo },
        { header: 'Party Email', maps: 'delivery_challan_purchase.other_customer_email', get: (r) => r.record.customerEmail },
        { header: 'PAN No', maps: 'delivery_challan_purchase.other_customer_pan_no', get: (r) => r.record.customerPanNo },
        addressColumn<Row>('Billing Address', (r) => r.record.billingAddress, 'delivery_challan_purchase.other_billing_address_id'),
        // The address the goods went to: the billing address when "same as billing".
        addressColumn<Row>(
          'Shipping Address',
          (r) => (r.record.shipToSameAsBilling === false ? r.record.shippingAddress : r.record.billingAddress),
          'delivery_challan_purchase.other_shipping_address_id',
        ),
        { header: 'Place of Supply', maps: 'delivery_challan_purchase.other_place_of_supply', get: (r) => r.record.placeOfSupply },
        ...challanBaseColumns<OtherDeliveryChallan>(),
        ...documentColumns<OtherDeliveryChallan>(),
      ],
    }),
    challanItemsSheet('Other DC Items'),
    withoutColumns(approvalSheet({ numberHeader: 'Challan No', sources: [{ entity: OtherDeliveryChallan, numberColumn: 'challanNo' }] }), APPROVAL_ID_AND_STAGE_COLUMNS),
  ],
};
