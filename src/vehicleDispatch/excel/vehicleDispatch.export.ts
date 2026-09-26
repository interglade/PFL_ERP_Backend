/**
 * Vehicle Dispatch Excel export: dispatch details and approval history.
 *
 * Field map (from the entities):
 *   dispatch                 -> Vehicle Dispatch sheet
 *   delivery_challan_purchase (+ its invoices) -> linked document references
 *   documents + approval_stage_info -> status columns + Approvals sheet
 *
 * A dispatch links to one delivery challan; invoices raised against that challan
 * are listed as further references. Transporter, customer and vendor are not
 * separate relations - the client is stored as `clientName`/`clientAddress`.
 * The `sku` table is not exported: its relation from `dispatch` is commented out
 * in the entity and no service writes it.
 */

import { VehicleDispatch } from '../entity/vehicleDispatch.entity';
import { ExportDefinition } from '../../excel/export/exportTypes';
import { ADDRESS_COLUMNS, COMPANY_COLUMNS, joinSelect } from '../../excel/export/exportQuery';
import { DocumentRow, approvalSheet, documentColumns, documentHeaderSheet } from '../../excel/export/documentMeta';
import { addressColumn, auditColumns, companyColumns } from '../../excel/export/commonColumns';

type Row = DocumentRow<VehicleDispatch>;

export const VEHICLE_DISPATCH_EXPORT: ExportDefinition = {
  fileStem: 'Vehicle_Dispatch',
  sheets: [
    documentHeaderSheet<VehicleDispatch>({
      name: 'Vehicle Dispatch',
      loadRecords: async (ctx) => {
        const qb = ctx.manager.getRepository(VehicleDispatch).createQueryBuilder('dispatch');
        joinSelect(qb, 'dispatch.companyName', 'company', COMPANY_COLUMNS);
        joinSelect(qb, 'dispatch.clientAddress', 'clientAddress', ADDRESS_COLUMNS);
        joinSelect(qb, 'dispatch.deliveryChallanNo', 'challan', ['id', 'challanNo', 'vehicleNo']);
        joinSelect(qb, 'challan.invoices', 'invoice', ['id', 'invoiceNo']);
        return qb.where('dispatch.id IN (:...ids)', { ids: ctx.ids }).getMany();
      },
      columns: [
        { header: 'Dispatch No', maps: 'dispatch.vehicleDispatchNo', get: (r) => r.record.vehicleDispatchNo },
        { header: 'Dispatch Record ID', maps: 'dispatch.id', get: (r) => r.record.id },
        { header: 'Dispatch Date', maps: 'dispatch.date', type: 'date', get: (r) => r.record.date },
        ...companyColumns<Row>((r) => r.record.companyName),
        { header: 'Vehicle Type', maps: 'dispatch.vehicleType', get: (r) => r.record.vehicleType },
        { header: 'Vehicle No', maps: 'dispatch.vehicleNo', get: (r) => r.record.vehicleNo },
        { header: 'Driver Name', maps: 'dispatch.driverName', get: (r) => r.record.driverName },
        { header: 'Driver Mobile No', maps: 'dispatch.driverMobNo', get: (r) => r.record.driverMobNo },
        { header: 'Reaching Time', maps: 'dispatch.reachingTime', type: 'time', get: (r) => r.record.reachingTime },
        { header: 'Out Time', maps: 'dispatch.outTime', type: 'time', get: (r) => r.record.outTime },
        { header: 'Client Name', maps: 'dispatch.clientName', get: (r) => r.record.clientName },
        addressColumn<Row>('Client Address', (r) => r.record.clientAddress, 'dispatch.clientAddress'),
        { header: 'Receiving Person', maps: 'dispatch.receivingPerson', get: (r) => r.record.receivingPerson },
        { header: 'Supervisor Name', maps: 'dispatch.supervisorName', get: (r) => r.record.supervisorName },
        { header: 'Delivery Challan No', maps: 'dispatch.deliveryChallanNo -> delivery_challan_purchase.challanNo', get: (r) => r.record.deliveryChallanNo?.challanNo },
        { header: 'Delivery Challan Invoice Nos', maps: 'delivery_challan_purchase.invoices -> invoices.invoiceNo', get: (r) => (r.record.deliveryChallanNo?.invoices ?? []).map((i) => i.invoiceNo) },
        { header: 'Client GRN No', maps: 'dispatch.clientGRNNo', get: (r) => r.record.clientGRNNo },
        { header: 'Net Inward Qty', maps: 'dispatch.netInwardQty', type: 'quantity', get: (r) => r.record.netInwardQty },
        { header: 'Rejection', maps: 'dispatch.rejection', get: (r) => r.record.rejection },
        { header: 'Shrinkage / Dump', maps: 'dispatch.shrinkageDump', get: (r) => r.record.shrinkageDump },
        { header: 'Payment Discussed', maps: 'dispatch.paymentDiscussed', type: 'amount', get: (r) => r.record.paymentDiscussed },
        { header: 'Transportation Bill Amount', maps: 'dispatch.transportationBillAmt', type: 'amount', get: (r) => r.record.transportationBillAmt },
        { header: 'Advance Paid', maps: 'dispatch.advancePaid', type: 'amount', get: (r) => r.record.advancePaid },
        { header: 'Payment Terms', maps: 'dispatch.paymentTerms', get: (r) => r.record.paymentTerms },
        { header: 'Accounts Dept Verification', maps: 'dispatch.accDeptVerification', get: (r) => r.record.accDeptVerification },
        { header: 'Remarks (PFL)', maps: 'dispatch.remarksPFL', get: (r) => r.record.remarksPFL },
        { header: 'Feedback By Transporter Owner', maps: 'dispatch.feedbackbyTransporterOwner', get: (r) => r.record.feedbackbyTransporterOwner },
        ...auditColumns<Row>((r) => r.record, 'dispatch'),
        ...documentColumns<VehicleDispatch>(),
      ],
    }),
    approvalSheet({ numberHeader: 'Dispatch No', sources: [{ entity: VehicleDispatch, numberColumn: 'vehicleDispatchNo' }] }),
  ],
};
