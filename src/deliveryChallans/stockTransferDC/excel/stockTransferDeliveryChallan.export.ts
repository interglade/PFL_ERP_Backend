/**
 * Stock Transfer Delivery Challan Excel export: header, line items and approval
 * history.
 *
 * Field map (from the entities):
 *   delivery_challan_purchase (type stock-transfer-delivery-challan) -> Stock Transfer DC sheet
 *   item                                                             -> Stock Transfer DC Items sheet
 *   documents + approval_stage_info                                  -> status columns + Approvals sheet
 *
 * Source and destination are branches (`from_location_id` / `to_location_id`).
 */

import { StockTransferDeliveryChallan } from '../entity/stockTransferdeliveryChallan.entity';
import { ExportDefinition } from '../../../excel/export/exportTypes';
import { BRANCH_COLUMNS, joinSelect } from '../../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../../excel/export/documentMeta';
import { branchColumn } from '../../../excel/export/commonColumns';
import { challanBaseColumns, challanItemsSheet, joinChallanBase } from '../../deliverychllan/excel/deliveryChallanCommon.export';

type Row = DocumentRow<StockTransferDeliveryChallan>;

export const STOCK_TRANSFER_DELIVERY_CHALLAN_EXPORT: ExportDefinition = {
  fileStem: 'Stock_Transfer_Delivery_Challan',
  sheets: [
    documentHeaderSheet<StockTransferDeliveryChallan>({
      name: 'Stock Transfer DC',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(StockTransferDeliveryChallan).createQueryBuilder('challan');
        joinChallanBase(qb, 'challan');
        joinSelect(qb, 'challan.fromLocation', 'fromLocation', BRANCH_COLUMNS);
        joinSelect(qb, 'challan.toLocation', 'toLocation', BRANCH_COLUMNS);
        return qb.where('challan.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Challan No', maps: 'delivery_challan_purchase.challanNo', get: (r) => r.record.challanNo },
        { header: 'Challan Record ID', maps: 'delivery_challan_purchase.id', get: (r) => r.record.id },
        { header: 'Stock Transfer Type', maps: 'delivery_challan_purchase.stockTransferType', get: (r) => r.record.stockTransferType },
        branchColumn<Row>('Source Location', (r) => r.record.fromLocation, 'delivery_challan_purchase.from_location_id'),
        branchColumn<Row>('Destination Location', (r) => r.record.toLocation, 'delivery_challan_purchase.to_location_id'),
        ...challanBaseColumns<StockTransferDeliveryChallan>(),
        ...documentColumns<StockTransferDeliveryChallan>({ inventory: true }),
      ],
    }),
    challanItemsSheet('Stock Transfer DC Items'),
    approvalSheet({ numberHeader: 'Challan No', sources: [{ entity: StockTransferDeliveryChallan, numberColumn: 'challanNo' }] }),
  ],
};
