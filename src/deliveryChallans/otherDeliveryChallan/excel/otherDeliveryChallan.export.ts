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
import { ADDRESS_COLUMNS, BRANCH_COLUMNS, joinSelect } from '../../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
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
        joinSelect(qb, 'challan.customerAddress', 'customerAddress', ADDRESS_COLUMNS);
        return qb.where('challan.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Challan No', maps: 'delivery_challan_purchase.challanNo', get: (r) => r.record.challanNo },
        { header: 'Challan Record ID', maps: 'delivery_challan_purchase.id', get: (r) => r.record.id },
        branchColumn<Row>('From Location', (r) => r.record.fromLocation, 'delivery_challan_purchase.other_from_location_id_for_other'),
        { header: 'Party Name', maps: 'delivery_challan_purchase.other_customer_name', get: (r) => r.record.customer },
        { header: 'Party Contact No', maps: 'delivery_challan_purchase.other_customer_contact_no', get: (r) => r.record.customerContactNo },
        { header: 'Party Email', maps: 'delivery_challan_purchase.other_customer_email', get: (r) => r.record.customerEmail },
        addressColumn<Row>('Party Address', (r) => r.record.customerAddress, 'delivery_challan_purchase.customer_address_for_other'),
        ...challanBaseColumns<OtherDeliveryChallan>(),
        ...documentColumns<OtherDeliveryChallan>({ inventory: true }),
      ],
    }),
    challanItemsSheet('Other DC Items'),
    approvalSheet({ numberHeader: 'Challan No', sources: [{ entity: OtherDeliveryChallan, numberColumn: 'challanNo' }] }),
  ],
};
