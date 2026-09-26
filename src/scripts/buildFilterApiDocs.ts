/**
 * Generates docs/FILTER_EXPORT_IMPORT_API_DOCUMENTATION.md.
 *
 *   npm run docs:filters
 *
 * Parameter tables, sortable keys and export sheets/columns are read from the code
 * (filter definitions and export definitions), so they cannot drift from the
 * implementation. Routes, pagination behaviour, response envelopes and row fields
 * are described in MODULES below; they were taken from the controllers/services and
 * verified against the running API. `src/test/service/filterApiDocs.spec.ts` fails
 * whenever the committed document differs from this generator's output.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

import { getModuleFilterDefinition } from '../global/filters/documentFilter.definitions';
import { COMMON_FILTERS, PRODUCT_FILTERS } from '../global/filters/documentFilter.parser';
import { FieldFilter, ModuleFilterDefinition } from '../global/filters/documentFilter.types';
import { DocumentStatus } from '../approvalFlow/entity/docuemnt.entity';
import { ExportDefinition, ExportCellType } from '../excel/export/exportTypes';
import { RFPA_EXPORT } from '../rfpa/excel/rfpa.export';
import { DEAL_SLIP_EXPORT } from '../dealSlip/excel/dealSlip.export';
import { GRN_EXPORT } from '../grn/excel/grn.export';
import { INWARD_REGISTER_EXPORT } from '../inwardRegister/excel/inwardRegister.export';
import { AQR_EXPORT } from '../aqr/excel/aqr.export';
import { DUMP_REGISTER_EXPORT } from '../dumpRegister/excel/dumpRegister.export';
import { CUSTOMER_DELIVERY_CHALLAN_EXPORT } from '../deliveryChallans/customerDeliveryChllan/excel/customerDeliveryChallan.export';
import { STOCK_TRANSFER_DELIVERY_CHALLAN_EXPORT } from '../deliveryChallans/stockTransferDC/excel/stockTransferDeliveryChallan.export';
import { OTHER_DELIVERY_CHALLAN_EXPORT } from '../deliveryChallans/otherDeliveryChallan/excel/otherDeliveryChallan.export';
import { FINAL_INVOICE_EXPORT } from '../invoice/excel/finalInvoice.export';
import { RETURN_BY_CUSTOMER_EXPORT } from '../returnByCustomer/excel/returnByCustomer.export';
import { RETURN_TO_VENDOR_EXPORT } from '../returnToVendor/excel/returnToVendor.export';
import { SECOND_SALE_EXPORT } from '../secondSale/excel/secondSale.export';
import { VEHICLE_DISPATCH_EXPORT } from '../vehicleDispatch/excel/vehicleDispatch.export';
import { MULTI_CASH_VOUCHER_EXPORT } from '../vouchers/multiCashV/excel/multiCashVoucher.export';
import { LABOUR_PAYMENT_VOUCHER_EXPORT } from '../vouchers/labourPaymentV/excel/labourPaymentVoucher.export';
import { TRANSPORT_PAYMENT_VOUCHER_EXPORT } from '../vouchers/tranportPaymentV/excel/transportPaymentVoucher.export';
import { PACKING_MATERIAL_VOUCHER_EXPORT } from '../vouchers/paymentMaterialV/excel/packingMaterialVoucher.export';
import { ALL_VOUCHERS_EXPORT } from '../vouchers/excel/allVouchers.export';
import { VOUCHER_KINDS } from '../vouchers/excel/voucherCommon.export';

export const DOC_RELATIVE_PATH = 'docs/FILTER_EXPORT_IMPORT_API_DOCUMENTATION.md';

// ─── Facts taken from the controllers and services ───────────────────────────

type Visibility = 'documentb' | 'double' | 'single' | 'invoice';
type Paging = 'controller' | 'service' | 'sql' | 'none' | 'both';
type Envelope = 'standard' | 'meta' | 'rtv';
type Field = [name: string, type: string, description: string];

interface ModuleDoc {
  section: string;
  documentType: string;
  listPath: string;
  source: string;
  visibility: Visibility;
  paging: Paging;
  envelope: Envelope;
  emptyStatus: 200 | 404;
  emptyMessage?: string;
  rowFields: Field[];
  nested?: Record<string, Field[]>;
  exportDef: ExportDefinition;
  example: Record<string, string>;
}

const COMMON_ROW: Field[] = [
  ['id', 'string (uuid)', 'Record id of the module document'],
  ['documentId', 'string (uuid)', 'Approval document id (`documents.id`), used by the `/view/:docid` endpoints'],
  ['overAllStatus', 'string', 'Document workflow status (`documents.status`)'],
  ['createdBy', 'string', "Document creator's name"],
  ['createdDate', 'string', 'Creation date, `YYYY-MM-DD`'],
  ['createdTime', 'string', 'Creation time, `hh:mm A`'],
];

const ADDRESS_FIELDS: Field[] = [
  ['id', 'string (uuid)', 'Address id'],
  ['address1', 'string', 'Address line 1'],
  ['address2', 'string \\| null', 'Address line 2'],
  ['location', 'string \\| null', 'Locality'],
  ['city', 'string', 'City'],
  ['state', 'string', 'State'],
  ['pincode', 'string', 'PIN code'],
];

const dec = (d: string) => `${d} (decimal, serialised as a string)`;

const VOUCHER_ROW_BASE: Field[] = [
  ...COMMON_ROW,
  ['voucherNo', 'string', 'Voucher number'],
  ['companyName', 'string \\| null', 'Company name'],
  ['location', 'string \\| null', 'Location (branch) name'],
  ['grnNo', 'string \\| null', 'Linked GRN number'],
  ['debitCreditTo', 'string', 'Debit / credit to'],
  ['payReceivedFrom', 'string', 'Pay / received from'],
  ['paymentMode', 'string', 'Payment mode'],
  ['receiverName', 'string', 'Receiver name'],
  ['amtWords', 'string', 'Amount in words'],
  ['remark', 'string \\| null', 'Remark'],
];

const MODULES: ModuleDoc[] = [
  {
    section: 'RFPA',
    documentType: 'rfpa',
    listPath: '/rfpa',
    source: 'RfpaController.getAllRfpa → RfpaService.getAllRfpa',
    visibility: 'single',
    paging: 'controller',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['rfpaId', 'string', 'RFPA number'],
      ['source', 'string', 'vendor or farmer'],
      ['companyName', 'string \\| null', 'Company name'],
      ['purchaseLocation', 'string \\| null', 'Purchase location name'],
      ['purchaseForSalesLocation', 'string \\| null', 'Purchase-for-sales location name'],
      ['deliveryReceivingPerson', 'string \\| null', 'Delivery receiving person'],
      ['packingInstruction', 'string \\| null', 'Packing instruction'],
      ['remark', 'string \\| null', 'Remark'],
      ['paymentInfo', 'object \\| null', 'Payment terms (see below)'],
    ],
    nested: {
      paymentInfo: [
        ['paymentMode', 'string \\| null', 'Payment mode'],
        ['paymentDate', 'string \\| null', 'Payment date'],
        ['advancePaidAmt', 'string \\| null', dec('Advance paid')],
        ['paymentTerms', 'string \\| null', 'Payment terms'],
        ['dueDate', 'string \\| null', 'Due date'],
        ['creditPeriod', 'number \\| null', 'Credit period'],
        ['validityOfQuote', 'string \\| null', 'Validity of quote'],
      ],
    },
    exportDef: RFPA_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', status: 'COMPLETE', vendorId: '9b2d4c1e-5f6a-4b7c-8d9e-0a1b2c3d4e5f', productName: 'Tomato' },
  },
  {
    section: 'Deal Slip',
    documentType: 'deal-slip',
    listPath: '/dealSlip',
    source: 'DealSlipController.getAllDealSlips → DealSlipService.getAllDealSlips',
    visibility: 'single',
    paging: 'controller',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['dealSlipNo', 'string', 'Deal slip number'],
      ['rfpa', 'string \\| null', 'Linked RFPA number'],
      ['lotNo', 'string \\| null', 'Lot number'],
      ['loadingLocation', 'string \\| null', 'Loading location'],
      ['specialRequest', 'string \\| null', 'Special request'],
      ['remark', 'string \\| null', 'Remark'],
    ],
    exportDef: DEAL_SLIP_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', approvalStatus: 'approved', rfpaNo: 'RFPA2026', vendorId: '9b2d4c1e-5f6a-4b7c-8d9e-0a1b2c3d4e5f' },
  },
  {
    section: 'GRN',
    documentType: 'grn',
    listPath: '/grns',
    source: 'GrnController.getAllGrns → GrnService.getAllGrns',
    visibility: 'documentb',
    paging: 'service',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['grnNo', 'string', 'GRN number'],
      ['grnType', 'string', 'transfer or purchase'],
      ['purchaseType', 'string \\| null', 'Purchase type'],
      ['locationType', 'string \\| null', 'cc or dc'],
      ['source', 'string \\| null', 'vendor or farmer'],
      ['companyName', 'string \\| null', 'Company name'],
      ['purchaseLocation', 'string \\| null', 'Purchase location name'],
      ['purchaseForSalesLocation', 'string \\| null', 'Purchase-for-sales location name'],
      ['billNo', 'string \\| null', 'Bill number'],
      ['subTotalAmt', 'string \\| null', dec('Sub total')],
      ['freight', 'string \\| null', dec('Freight')],
      ['otherCharges', 'string \\| null', dec('Other charges')],
      ['totalAmt', 'string \\| null', dec('Total amount')],
      ['amtWords', 'string \\| null', 'Amount in words'],
      ['cratesIn', 'number \\| null', 'Crates in'],
      ['purchasedBy', 'string \\| null', 'Purchased by'],
      ['receivedThrough', 'string \\| null', 'Received through'],
      ['vehicleNo', 'string \\| null', 'Vehicle number'],
      ['timeIn', 'string \\| null', 'Time in'],
      ['securityPerson', 'string \\| null', 'Security person'],
      ['deliveryReceivingPerson', 'string \\| null', 'Delivery receiving person'],
      ['rmn', 'string \\| null', 'RMN'],
      ['remark', 'string \\| null', 'Remark'],
      ['paymentInfo', 'object \\| null', 'Payment terms (see below)'],
    ],
    nested: {
      paymentInfo: [
        ['id', 'string (uuid)', 'Payment info id'],
        ['paymentMode', 'string \\| null', 'Payment mode'],
        ['paymentDate', 'string \\| null', 'Payment date'],
        ['advancePaidAmt', 'string \\| null', dec('Advance paid')],
        ['paymentTerms', 'string \\| null', 'Payment terms'],
        ['dueDate', 'string \\| null', 'Due date'],
        ['creditPeriod', 'number \\| null', 'Credit period'],
      ],
    },
    exportDef: GRN_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', status: 'COMPLETE', vendorId: '9b2d4c1e-5f6a-4b7c-8d9e-0a1b2c3d4e5f', warehouseId: '4c7e1a2b-3d4e-4f5a-8b6c-7d8e9f0a1b2c', productId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b' },
  },
  {
    section: 'Inward Register',
    documentType: 'inward-register',
    listPath: '/inwardRegister',
    source: 'InwardRegisterController.getAllInwardRegisters → InwardRegisterService.getAllInwardRegisters',
    visibility: 'single',
    paging: 'none',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['inwardNo', 'string', 'Inward number'],
      ['inwardType', 'string', 'purchase, transferred or returned-by-customer'],
      ['date', 'string \\| null', 'Inward date'],
      ['batchNo', 'string \\| null', 'Batch number'],
      ['source', 'string \\| null', 'vendor or farmer'],
      ['companyName', 'string \\| null', 'Company name'],
      ['location', 'string \\| null', 'Location name'],
      ['grnNo', 'string \\| null', 'Linked GRN number'],
      ['deliveryChallanNo', 'string \\| null', 'Linked delivery challan number'],
      ['rbcNo', 'string \\| null', 'Linked return by customer number'],
      ['vendorName', 'string \\| null', 'Vendor name'],
      ['farmerName', 'string \\| null', 'Farmer name'],
      ['incomingGrossQty', 'string \\| null', dec('Incoming gross quantity')],
      ['incomingNetQty', 'string \\| null', dec('Incoming net quantity')],
      ['inwardGrossQty', 'string \\| null', dec('Inward gross quantity')],
      ['inwardNetQty', 'string \\| null', dec('Inward net quantity')],
      ['inwardCost', 'string \\| null', dec('Inward cost')],
      ['totalWeightInKg', 'string \\| null', dec('Total weight (kg)')],
      ['remarks', 'string \\| null', 'Remarks'],
      ['purchasedBy', 'string \\| null', 'Purchased by (name)'],
      ['inwardBy', 'string \\| null', 'Inward by (name)'],
    ],
    exportDef: INWARD_REGISTER_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', inwardType: 'purchase', locationId: '4c7e1a2b-3d4e-4f5a-8b6c-7d8e9f0a1b2c', productName: 'Onion' },
  },
  {
    section: 'AQR',
    documentType: 'aqr',
    listPath: '/aqr',
    source: 'AqrController (GET /) → AqrService.getAllAqrs',
    visibility: 'single',
    paging: 'none',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['aqrNo', 'string', 'AQR number'],
      ['aqrFor', 'string', 'purchase or transfer'],
      ['source', 'string \\| null', 'vendor or farmer'],
      ['companyName', 'string \\| null', 'Company name'],
      ['location', 'string \\| null', 'Location name'],
      ['fromLocation', 'string \\| null', 'From location name'],
      ['deliveryChallanNo', 'string \\| null', 'Linked delivery challan number'],
      ['selectedParty', 'string \\| null', 'Vendor or farmer name'],
      ['product', 'string \\| null', 'Product name'],
      ['variant', 'string \\| null', 'Variant name'],
      ['arrivalDate', 'string \\| null', 'Arrival date'],
      ['arrivedQty', 'string \\| null', 'Arrived quantity (text column)'],
      ['samplingQty', 'string \\| null', 'Sampling quantity (text column)'],
      ['totalQty', 'string \\| null', dec('Total quantity')],
      ['totalpercent', 'string \\| null', dec('Total percent')],
      ['purchaseBy', 'string \\| null', 'Purchase by (name)'],
      ['receivedBy', 'string \\| null', 'Received by (name)'],
      ['qcCheckBy', 'string \\| null', 'QC check by (name)'],
      ['verifiedBy', 'string \\| null', 'Verified by (name)'],
      ['remark', 'string \\| null', 'Remark'],
    ],
    exportDef: AQR_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', aqrFor: 'purchase', supplierName: 'Agro', productId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b' },
  },
  {
    section: 'Dump Register',
    documentType: 'dump-register',
    listPath: '/dumpRegister',
    source: 'DumpRegisterController (GET /) → DumpRegisterService.getAllDumpRegisters',
    visibility: 'double',
    paging: 'sql',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['dumpNo', 'string', 'Dump number'],
      ['dumpType', 'string', 'purchase, transferred or returned-by-customer'],
      ['date', 'string \\| null', 'Dump date'],
      ['batchNo', 'string \\| null', 'Batch number'],
      ['companyName', 'string \\| null', 'Company name'],
      ['location', 'string \\| null', 'Location name'],
      ['grn', 'string \\| null', 'Linked GRN number'],
      ['deliveryChallanNo', 'string \\| null', 'Linked delivery challan number'],
      ['rbcNo', 'string \\| null', 'Linked return by customer number'],
      ['totalQty', 'number \\| null', 'Total dump quantity'],
      ['totalDumpCost', 'number \\| null', 'Total dump cost'],
      ['totalCostInWords', 'string \\| null', 'Total cost in words'],
      ['remark', 'string \\| null', 'Remark'],
    ],
    exportDef: DUMP_REGISTER_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', dumpType: 'purchase', locationId: '4c7e1a2b-3d4e-4f5a-8b6c-7d8e9f0a1b2c', minAmount: '1000' },
  },
  {
    section: 'Delivery Challan – Customer',
    documentType: 'DC_TYPE_CUSTOMER',
    listPath: '/customer-delivery-challan',
    source: 'CustomerDeliveryChallanController (GET /) → CustomerDeliveryChallanService.getAllCustomerDeliveryChallans',
    visibility: 'double',
    paging: 'sql',
    envelope: 'standard',
    emptyStatus: 404,
    emptyMessage: 'No customer delivery challans found',
    rowFields: [
      ...COMMON_ROW,
      ['challanNo', 'string', 'Challan number'],
      ['poNumber', 'string \\| null', 'PO number'],
      ['customerName', 'string \\| null', 'Customer name'],
      ['companyName', 'object \\| null', '`{ id, name }` of the company'],
      ['fromLocation', 'object \\| null', '`{ id, name }` of the dispatch location'],
      ['billingAddress', 'object \\| null', 'Address (see below)'],
      ['deliveryAddress', 'object \\| null', 'Address (see below)'],
      ['currentShippingAddress', 'object \\| null', 'Address (see below)'],
      ['office', 'string \\| null', 'Office name'],
      ['grnNo', 'string \\| null', 'Linked GRN number'],
      ['transitInsuranceNo', 'string \\| null', 'Transit insurance number'],
      ['totalProductAmount', 'string \\| null', dec('Total product amount')],
      ['netProductWeight', 'string \\| null', dec('Net product weight')],
      ['netPackagingMaterialWeight', 'string \\| null', dec('Net packaging material weight')],
      ['totalPackagingMaterialAmount', 'string \\| null', dec('Total packaging material amount')],
      ['totalAmtInWords', 'string \\| null', 'Total amount in words'],
      ['driverName', 'string \\| null', 'Driver name'],
      ['licenseNo', 'string \\| null', 'Driver license number'],
      ['contactNo', 'string \\| null', 'Contact number'],
      ['altContactNo', 'string \\| null', 'Alternate contact number'],
      ['vehicleNo', 'string \\| null', 'Vehicle number'],
      ['receiverName', 'string \\| null', 'Receiver name'],
      ['rmn', 'string \\| null', 'RMN'],
      ['remark', 'string \\| null', 'Remark'],
      ['anyAttachment', 'string[] \\| null', 'Attachment URLs'],
      ['deliveryChallanProducts', 'object[]', 'Challan lines (see below)'],
    ],
    nested: {
      'billingAddress / deliveryAddress / currentShippingAddress': ADDRESS_FIELDS,
      deliveryChallanProducts: [
        ['id', 'string (uuid)', 'Line id'],
        ['unitPrice', 'string', dec('Unit price')],
        ['amount', 'string', dec('Amount')],
        ['grossWeight', 'string', dec('Gross weight')],
        ['netWeight', 'string', dec('Net weight')],
        ['packagingMaterialQuantity', 'number \\| null', 'Packaging material quantity'],
        ['packagingMaterialUnitPrice', 'number \\| null', 'Packaging material unit price'],
        ['packagingMaterialAmount', 'number \\| null', 'Packaging material amount'],
        ['packagingMaterialTotalWeight', 'number \\| null', 'Packaging material total weight'],
      ],
    },
    exportDef: CUSTOMER_DELIVERY_CHALLAN_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', customerId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', vehicleNo: 'MH12', productName: 'Tomato' },
  },
  {
    section: 'Delivery Challan – Stock Transfer',
    documentType: 'DC_TYPE_STOCK_TRANSFER',
    listPath: '/tranfer-delivery-challan',
    source: 'StockTransferDeliveryChallanController (GET /) → StockTransferDeliveryChallanService.getAll',
    visibility: 'double',
    paging: 'sql',
    envelope: 'meta',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['challanNo', 'string', 'Challan number'],
      ['stockTransferType', 'string', 'Stock transfer type'],
      ['approvalStatus', 'string \\| null', 'Challan approval status'],
      ['requestingDepartment', 'string \\| null', 'Requesting department'],
      ['companyName', 'string \\| null', 'Company name'],
      ['fromLocation', 'string \\| null', 'Source location name'],
      ['toLocation', 'string \\| null', 'Destination location name'],
      ['transitInsuranceNo', 'string \\| null', 'Transit insurance number'],
      ['totalProductAmount', 'string \\| null', dec('Total product amount')],
      ['netProductWeight', 'string \\| null', dec('Net product weight')],
      ['netPackagingMaterialWeight', 'string \\| null', dec('Net packaging material weight')],
      ['totalPackagingMaterialAmount', 'string \\| null', dec('Total packaging material amount')],
      ['totalAmtInWords', 'string \\| null', 'Total amount in words'],
      ['driverName', 'string \\| null', 'Driver name'],
      ['licenseNo', 'string \\| null', 'Driver license number'],
      ['contactNo', 'string \\| null', 'Contact number'],
      ['altContactNo', 'string \\| null', 'Alternate contact number'],
      ['vehicleNo', 'string \\| null', 'Vehicle number'],
      ['receiverName', 'string \\| null', 'Receiver name'],
      ['rmn', 'string \\| null', 'RMN'],
      ['remark', 'string \\| null', 'Remark'],
      ['anyAttachment', 'string[] \\| null', 'Attachment URLs'],
    ],
    exportDef: STOCK_TRANSFER_DELIVERY_CHALLAN_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', stockTransferType: 'cc-dc stock transfer', sourceLocationId: '4c7e1a2b-3d4e-4f5a-8b6c-7d8e9f0a1b2c' },
  },
  {
    section: 'Other Delivery Challan',
    documentType: 'DC_TYPE_OTHER',
    listPath: '/other-delivery-challan',
    source: 'OtherDeliveryChallanController (GET /) → OtherDeliveryChallanService.getAll',
    visibility: 'double',
    paging: 'sql',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['challanNo', 'string', 'Challan number'],
      ['approvalStatus', 'string \\| null', 'Challan approval status'],
      ['requestingDepartment', 'string \\| null', 'Requesting department'],
      ['companyName', 'string \\| null', 'Company name'],
      ['office', 'string \\| null', 'Office name'],
      ['grnNo', 'string \\| null', 'Linked GRN number'],
      ['fromLocation', 'string \\| null', 'From location name'],
      ['customer', 'string \\| null', 'Party name (free text)'],
      ['customerContactNo', 'string \\| null', 'Party contact number'],
      ['customerEmail', 'string \\| null', 'Party email'],
      ['customerAddress', 'string \\| null', 'Party address (formatted)'],
      ['transitInsuranceNo', 'string \\| null', 'Transit insurance number'],
      ['totalProductAmount', 'string \\| null', dec('Total product amount')],
      ['netProductWeight', 'string \\| null', dec('Net product weight')],
      ['netPackagingMaterialWeight', 'string \\| null', dec('Net packaging material weight')],
      ['totalPackagingMaterialAmount', 'string \\| null', dec('Total packaging material amount')],
      ['totalAmtInWords', 'string \\| null', 'Total amount in words'],
      ['driverName', 'string \\| null', 'Driver name'],
      ['licenseNo', 'string \\| null', 'Driver license number'],
      ['contactNo', 'string \\| null', 'Contact number'],
      ['altContactNo', 'string \\| null', 'Alternate contact number'],
      ['vehicleNo', 'string \\| null', 'Vehicle number'],
      ['receiverName', 'string \\| null', 'Receiver name'],
      ['rmn', 'string \\| null', 'RMN'],
      ['remark', 'string \\| null', 'Remark'],
      ['anyAttachment', 'string[] \\| null', 'Attachment URLs'],
    ],
    exportDef: OTHER_DELIVERY_CHALLAN_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', customerName: 'Traders', vehicleNo: 'MH12' },
  },
  {
    section: 'Final Invoice',
    documentType: 'final-invoice',
    listPath: '/final-invoice',
    source: 'FinalInvoiceController (GET /) → FinalInvoiceService.getAll',
    visibility: 'invoice',
    paging: 'sql',
    envelope: 'standard',
    emptyStatus: 404,
    emptyMessage: 'No final invoices found',
    rowFields: [
      ...COMMON_ROW,
      ['invoiceNo', 'string', 'Invoice number'],
      ['invoiceDate', 'string \\| null', 'Invoice date'],
      ['ammountStatus', 'string \\| null', 'Payment status: paid or unpaid'],
      ['companyName', 'string \\| null', 'Company name'],
      ['customerName', 'string \\| null', 'Customer name'],
      ['deliveryChallan', 'string \\| null', 'Linked delivery challan number'],
      ['poNumber', 'string \\| null', 'PO number'],
      ['vehicleNo', 'string \\| null', 'Vehicle number'],
      ['fromLocation', 'string \\| null', 'From location name'],
      ['billingAddress', 'string \\| null', 'Billing address (formatted)'],
      ['deliveryAddress', 'string \\| null', 'Delivery address (formatted)'],
      ['totalProductAmount', 'string \\| null', dec('Total product amount')],
      ['netProductWeight', 'string \\| null', dec('Net product weight')],
      ['grossProductWeight', 'number', 'Sum of line gross weights'],
      ['totalAmount', 'string \\| null', dec('Grand total')],
    ],
    exportDef: FINAL_INVOICE_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', paymentStatus: 'unpaid', customerId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', minAmount: '5000' },
  },
  {
    section: 'Return by Customer',
    documentType: 'return-by-customer',
    listPath: '/returns',
    source: 'PostReturnByCustomerController (GET /) → PostReturnByCustomerService.getAllPostReturnByCustomer',
    visibility: 'double',
    paging: 'sql',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['rbcNo', 'string', 'Return number'],
      ['date', 'string \\| null', 'Return date'],
      ['companyName', 'string \\| null', 'Company name'],
      ['deliveryChallanNo', 'string \\| null', 'Original delivery challan number'],
      ['remark', 'string \\| null', 'Remark'],
      ['returnedProducts', 'object[]', 'Returned lines (see below)'],
    ],
    nested: {
      returnedProducts: [
        ['id', 'string (uuid)', 'Line id'],
        ['productName', 'string \\| null', 'Product name'],
        ['saleUoM', 'string \\| null', 'Sale UOM'],
        ['unitPrice', 'string', dec('Unit price')],
      ],
    },
    exportDef: RETURN_BY_CUSTOMER_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', customerId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', deliveryChallanNo: 'CN2026' },
  },
  {
    section: 'Return to Vendor',
    documentType: 'return-to-vendor',
    listPath: '/return-to-vendor',
    source: 'ReturnToVendorController (GET /) → ReturnToVendorService.getAll',
    visibility: 'double',
    paging: 'controller',
    envelope: 'rtv',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['rtvNo', 'string', 'Return number'],
      ['returnDate', 'string \\| null', 'Return date'],
      ['grnNo', 'string \\| null', 'Original GRN number'],
      ['companyName', 'string \\| null', 'Company name'],
      ['location', 'string \\| null', 'Location name'],
      ['selectedVendor', 'string \\| null', 'Vendor name'],
      ['returnedGrossWeight', 'string \\| null', dec('Returned gross weight')],
      ['returnedNetWeight', 'string \\| null', dec('Returned net weight')],
      ['totalAmt', 'string \\| null', dec('Total amount')],
      ['amtWords', 'string \\| null', 'Amount in words'],
      ['remark', 'string \\| null', 'Remark'],
    ],
    exportDef: RETURN_TO_VENDOR_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', vendorId: '9b2d4c1e-5f6a-4b7c-8d9e-0a1b2c3d4e5f', returnReason: 'damaged' },
  },
  {
    section: 'Second Sale',
    documentType: 'second-sale',
    listPath: '/secondSales',
    source: 'SecondSaleController (GET /) → SecondSaleService.getAllSecondSales',
    visibility: 'double',
    paging: 'sql',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['secondSaleNo', 'string', 'Second sale number'],
      ['saleDate', 'string \\| null', 'Sale date'],
      ['companyName', 'string \\| null', 'Company name'],
      ['location', 'string \\| null', 'Location name'],
      ['customerName', 'string \\| null', 'Customer name (free text)'],
      ['customerContactNo', 'string \\| null', 'Customer contact number'],
      ['customerEmail', 'string \\| null', 'Customer email'],
      ['reasonForSale', 'string \\| null', 'Reason for sale'],
      ['totalNetWeight', 'string \\| null', dec('Total net weight')],
      ['totalGrossWeight', 'string \\| null', dec('Total gross weight')],
      ['totalAmt', 'string \\| null', dec('Total amount')],
      ['totalAmtInWords', 'string \\| null', 'Total amount in words'],
      ['paidAmount', 'string \\| null', dec('Paid amount')],
      ['pendingAmt', 'string \\| null', dec('Pending amount')],
      ['paymentMode', 'string \\| null', 'Payment mode'],
      ['remarks', 'string \\| null', 'Remarks'],
    ],
    exportDef: SECOND_SALE_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', paymentMode: 'cash', locationId: '4c7e1a2b-3d4e-4f5a-8b6c-7d8e9f0a1b2c' },
  },
  {
    section: 'Vehicle Dispatch',
    documentType: 'vehicle-dispatch-register',
    listPath: '/vehicleDispatches',
    source: 'VehicleDispatchController (GET /) → VehicleDispatchService.getAllvehicalDispatch',
    visibility: 'single',
    paging: 'none',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...COMMON_ROW,
      ['date', 'string \\| null', 'Dispatch date'],
      ['vehicleType', 'string \\| null', 'Vehicle type'],
      ['vehicleNo', 'string \\| null', 'Vehicle number'],
      ['driverName', 'string \\| null', 'Driver name'],
      ['driverMobNo', 'string \\| null', 'Driver mobile number'],
      ['reachingTime', 'string \\| null', 'Reaching time'],
      ['outTime', 'string \\| null', 'Out time'],
      ['clientName', 'string \\| null', 'Client name'],
      ['clientAddress', 'object \\| null', 'Client address entity (includes its audit fields)'],
      ['receivingPerson', 'string \\| null', 'Receiving person'],
      ['supervisorName', 'string \\| null', 'Supervisor name'],
      ['companyName', 'string \\| null', 'Company name'],
      ['deliveryChallanNo', 'string \\| null', 'Linked delivery challan number'],
      ['clientGRNNo', 'string \\| null', 'Client GRN number'],
      ['paymentDiscussed', 'number \\| null', 'Payment discussed'],
      ['transportationBillAmt', 'number \\| null', 'Transportation bill amount'],
      ['advancePaid', 'number \\| null', 'Advance paid'],
      ['paymentTerms', 'string \\| null', 'Payment terms'],
      ['accDeptVerification', 'string \\| null', 'Accounts department verification'],
      ['netInwardQty', 'number \\| null', 'Net inward quantity'],
      ['rejection', 'string \\| null', 'Rejection'],
      ['shrinkageDump', 'string \\| null', 'Shrinkage / dump'],
      ['remarksPFL', 'string \\| null', 'Remarks (PFL)'],
      ['feedbackbyTransporterOwner', 'string \\| null', 'Feedback by transporter owner'],
    ],
    exportDef: VEHICLE_DISPATCH_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', vehicleNo: 'MH12', driverName: 'Ramesh' },
  },
  {
    section: 'Multi Cash Voucher',
    documentType: 'multi-cash-voucher',
    listPath: '/multiCashVoucher',
    source: 'MultiCashVoucherController (GET /) → MultiCashVoucherService.getAllVouchers',
    visibility: 'documentb',
    paging: 'both',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...VOUCHER_ROW_BASE,
      ['challanNo', 'string \\| null', 'Linked delivery challan number'],
      ['totalAmt', 'string \\| null', dec('Total amount')],
    ],
    exportDef: MULTI_CASH_VOUCHER_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', approvalStatus: 'pending', paymentMode: 'cash' },
  },
  {
    section: 'Labour Payment Voucher',
    documentType: 'labor-payment-voucher',
    listPath: '/lpvoucher',
    source: 'LPVoucherController (GET /) → LabourPaymentVoucherService.getLPVouchers',
    visibility: 'documentb',
    paging: 'both',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...VOUCHER_ROW_BASE,
      ['approvalStatus', 'string \\| null', 'Voucher approval status'],
      ['requestingDepartment', 'string \\| null', 'Requesting department'],
      ['loadingDate', 'string \\| null', 'Loading date'],
      ['noOfLabours', 'number \\| null', 'Number of labours'],
      ['ratePerLabour', 'string \\| null', dec('Rate per labour')],
      ['totalAmt', 'string \\| null', dec('Total amount')],
      ['products', 'string \\| null', 'Products (free text)'],
      ['contactNo', 'string \\| null', 'Contact number'],
      ['altContactNo', 'string \\| null', 'Alternate contact number'],
      ['kyc', 'boolean \\| null', 'KYC done'],
      ['anyAttachment', 'string[] \\| null', 'Attachment URLs'],
      ['createdAt', 'string', 'Record created timestamp (ISO 8601)'],
      ['updatedAt', 'string', 'Record updated timestamp (ISO 8601)'],
      ['deletionScheduledAt', 'string \\| null', 'Scheduled deletion timestamp'],
      ['isDeleted', 'boolean', 'Soft-delete flag'],
      ['deletedAt', 'string \\| null', 'Soft-delete timestamp'],
    ],
    exportDef: LABOUR_PAYMENT_VOUCHER_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', status: 'hold', grnNo: 'GRN2026' },
  },
  {
    section: 'Transport Payment Voucher',
    documentType: 'transport-payment-voucher',
    listPath: '/tpvoucher',
    source: 'TPVoucherController (GET /) → TPVoucherService.getAllTPVouchers',
    visibility: 'documentb',
    paging: 'both',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...VOUCHER_ROW_BASE,
      ['vehicleNo', 'string \\| null', 'Vehicle number'],
      ['driverName', 'string \\| null', 'Driver name'],
      ['contactNo', 'string \\| null', 'Contact number'],
      ['altContactNo', 'string \\| null', 'Alternate contact number'],
      ['dispatchLocation', 'string \\| null', 'Dispatch location'],
      ['destinationLocation', 'string \\| null', 'Destination location'],
      ['freightAmt', 'string \\| null', dec('Freight amount')],
      ['totalAmt', 'string \\| null', dec('Total amount')],
      ['kyc', 'boolean \\| null', 'KYC done'],
    ],
    exportDef: TRANSPORT_PAYMENT_VOUCHER_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', vehicleNo: 'MH12', minAmount: '500', maxAmount: '5000' },
  },
  {
    section: 'Packing Material Voucher',
    documentType: 'packaging-material-voucher',
    listPath: '/pmpvoucher',
    source: 'PMPVoucherController (GET /) → PMPVoucherService.getAllVouchers',
    visibility: 'documentb',
    paging: 'both',
    envelope: 'standard',
    emptyStatus: 200,
    rowFields: [
      ...VOUCHER_ROW_BASE,
      ['approvalStatus', 'string \\| null', 'Voucher approval status'],
      ['requestingDepartment', 'string \\| null', 'Requesting department'],
      ['sellerName', 'string \\| null', 'Seller name'],
      ['address', 'object \\| null', 'Seller address (fields as below, without id)'],
      ['contactNo', 'string \\| null', 'Contact number'],
      ['altContactNo', 'string \\| null', 'Alternate contact number'],
      ['purpose', 'string \\| null', 'Purpose'],
      ['totalAmt', 'string \\| null', dec('Total amount')],
      ['kyc', 'boolean \\| null', 'KYC done'],
    ],
    nested: { address: ADDRESS_FIELDS.filter(([n]) => n !== 'id') },
    exportDef: PACKING_MATERIAL_VOUCHER_EXPORT,
    example: { startDate: '2026-09-01', endDate: '2026-09-15', sellerName: 'Packaging', approvalStatus: 'approved' },
  },
];

const VISIBILITY_TEXT: Record<Visibility, string> = {
  single: 'the document creator, or a user in the approval flow’s **level-1 approver** block (any status)',
  double: 'the document creator, or a user in the **level-1 or level-2 approver** block (any status)',
  documentb:
    'the document creator (any status); a **verifier** when the status is hold, VERIFIED, approved, FINALIZING, COMPLETE or REJECT; an **approver (levels 1–6)** when VERIFIED, approved, FINALIZING, COMPLETE or REJECT; a **first finalizer** when approved, FINALIZING (not yet first-finalized), COMPLETE or REJECT; a **second finalizer** when FINALIZING (already first-finalized), COMPLETE or REJECT',
  invoice: 'the document creator, or a user in the **level-1 or level-2 approver** block (invoice not deleted)',
};

const VISIBILITY_SOURCE: Record<Visibility, string> = {
  single: '`DocSingalApproverService.getAllSingleApprovalDocumentsByUserId`',
  double: '`DocDoubleApproverService.getAllDocumentByUserIdForDoubleApprover`',
  documentb: '`DocumentbService.getAllDocumentByUserId`',
  invoice: '`FinalInvoiceService.getAll` (own query)',
};

const PAGING_TEXT: Record<Paging, { applied: boolean; text: string }> = {
  controller: { applied: true, text: '`page` defaults to 1 and `limit` to 10 in the controller; always paginated.' },
  service: { applied: true, text: 'When absent, the service uses page 1 and limit 10; always paginated.' },
  sql: { applied: true, text: 'When absent, page 1 and limit 10 are used (SQL `OFFSET`/`LIMIT`); always paginated.' },
  none: {
    applied: false,
    text: 'Not applied (pre-existing behaviour): every filtered row is returned. `page` is echoed and `totalPages` is computed with `limit` (default 10).',
  },
  both: { applied: true, text: 'Applied only when **both** `page` and `limit` are given; otherwise every filtered row is returned (`totalPages` = 1).' },
};

// ─── Rendering helpers ───────────────────────────────────────────────────────

const BASE = 'http://localhost:4000';
/** Table cell: one line, and a bare `|` (even inside a code span) must be escaped. */
const cell = (s: string) => s.replace(/\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');
const code = (s: string) => `\`${s}\``;
/** `table.column (note)` → `` `table.column` (note) `` */
const dateSource = (def: ModuleFilterDefinition) => {
  const [column, ...note] = def.businessDate.source.split(' ');
  return [code(column), ...note].join(' ');
};
const SEARCH_LABELS: Record<string, string> = {
  'company.name': 'company name', 'vendor.companyName': 'vendor name', 'vendor.vendorCode': 'vendor code',
  'customer.organisationName': 'customer name', 'customer.customerCode': 'customer code', 'grn.grnNo': 'GRN number',
  'challan.challanNo': 'delivery challan number', 'rbc.rbcNo': 'return by customer number', 'rfpa.rfpaId': 'RFPA number',
  'dealSlip.dealSlipNo': 'deal slip number', 'product.name': 'product name', 'product.productCode': 'product code',
};
/** Search expression → readable label (`rec.vehicleNo` → `vehicleNo`, joined names → "location name"). */
const searchLabel = (expr: string) => {
  if (SEARCH_LABELS[expr]) return SEARCH_LABELS[expr];
  if (/^CONCAT_WS/.test(expr)) return `${expr.match(/(\w+)\.\w+/)?.[1] ?? 'person'} name`;
  const [alias, column] = expr.split('.');
  if (alias === 'rec') return code(column);
  if (column === 'name') return `${alias.replace(/([A-Z])/g, ' $1').toLowerCase()} name`;
  return code(expr);
};
/** Drops a trailing "(partial)" that the matching column already states. */
const fieldDescription = (field: FieldFilter) =>
  field.kind === 'text' ? field.description.replace(/ \(partial\)$/, '') : field.description;
const anchor = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 –-]/g, '')
    .trim()
    .replace(/[ –]+/g, '-');

function table(headers: string[], rows: string[][]): string {
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

function exampleFor(param: string, field?: FieldFilter): string {
  const byName: Record<string, string> = {
    startDate: '2026-09-01', endDate: '2026-09-15', dateFrom: '2026-09-01', dateTo: '2026-09-15', approvalStartDate: '2026-09-01', approvalEndDate: '2026-09-15',
    status: 'COMPLETE,hold', search: 'ABC', documentNo: '0012', createdBy: 'Asha', approvedBy: 'Ravi', sort: 'createdAt:DESC', sortBy: 'createdAt', sortOrder: 'DESC',
    page: '1', limit: '20', vendorName: 'Agro Traders', vendorCode: 'VEN001', farmerName: 'Suresh Patil', farmerCode: 'FAR001', customerName: 'ABC Foods',
    customerCode: 'CUST001', company: 'Prime Fresh', location: 'Pune', warehouse: 'Pune', vehicleNo: 'MH12AB1234', driverName: 'Ramesh', productName: 'Tomato',
    productCode: 'PRD001', variant: 'Hybrid', category: 'Vegetables', minAmount: '1000', maxAmount: '50000', minQuantity: '10', maxQuantity: '500',
    batchNo: 'BATCH01', grnNo: 'GRN2026', dealSlipNo: 'DS2026', rfpaNo: 'RFPA2026', deliveryChallanNo: 'CN2026', rbcNo: 'RBC2026', poNumber: 'PO-778',
    returnReason: 'damaged', paymentMode: 'cash', companyName: 'Prime Fresh', supplierName: 'Agro', arrivalDate: '2026-09-10', billNo: 'B-101',
  };
  if (byName[param]) return byName[param];
  if (field?.kind === 'id' || /Id$/.test(param)) return '4c7e1a2b-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
  if (field?.kind === 'enum') return (field.values ?? [])[0];
  if (field?.kind === 'boolean') return 'true';
  if (field?.kind === 'min') return '0';
  if (field?.kind === 'max') return '100000';
  if (field?.kind === 'day') return '2026-09-10';
  return 'abc';
}

function kindType(field: FieldFilter): string {
  switch (field.kind) {
    case 'id': return field.nameExprs ? 'uuid or string' : 'uuid (comma-separated)';
    case 'enum': return 'enum (comma-separated)';
    case 'iexact': return 'string (comma-separated)';
    case 'boolean': return 'boolean';
    case 'min':
    case 'max': return 'number';
    case 'day': return 'date `YYYY-MM-DD`';
    default: return 'string';
  }
}

function kindMatch(field: FieldFilter): string {
  switch (field.kind) {
    case 'id': return field.nameExprs ? 'UUID: exact id; otherwise partial, case-insensitive name' : 'Exact match; any of the ids';
    case 'enum': return `Exact match; any of: ${(field.values ?? []).map(code).join(', ')}`;
    case 'iexact': return 'Exact, case-insensitive; any of the values';
    case 'boolean': return '`true` / `false` (also `1`/`0`, `yes`/`no`)';
    case 'min': return 'Inclusive lower bound';
    case 'max': return 'Inclusive upper bound';
    case 'day': return 'Exact day';
    default: return 'Partial, case-insensitive';
  }
}

const COMMON_TYPES: Record<string, string> = {
  startDate: 'date `YYYY-MM-DD`', endDate: 'date `YYYY-MM-DD`', status: 'enum (comma-separated)', search: 'string', documentNo: 'string',
  createdById: 'uuid (comma-separated)', createdBy: 'string', approvedById: 'uuid (comma-separated)', approvedBy: 'string',
  approvalStartDate: 'date `YYYY-MM-DD`', approvalEndDate: 'date `YYYY-MM-DD`', sort: 'string `field:ASC|DESC`',
};

function queryParamRows(mod: ModuleDoc | null, def: ModuleFilterDefinition, opts: { exportApi: boolean }): string[][] {
  const rows: string[][] = [];
  if (!opts.exportApi) {
    const paging = mod ? PAGING_TEXT[mod.paging] : PAGING_TEXT.both;
    rows.push(['`page`', 'number', 'No', `Page number. ${paging.text}`, '`1`']);
    rows.push(['`limit`', 'number', 'No', 'Records per page (see `page`).', '`20`']);
  } else {
    rows.push(['`page`, `limit`', 'number', 'No', '**Ignored** — the export always contains every matching record.', '—']);
  }
  for (const f of COMMON_FILTERS) {
    const type = COMMON_TYPES[f.param] ?? 'string';
    const desc =
      f.param === 'status'
        ? `Document workflow status. Exact; any of: ${Object.values(DocumentStatus).map(code).join(', ')}`
        : f.param === 'startDate' || f.param === 'endDate'
          ? `${f.description}. Filters on ${dateSource(def)}`
          : f.description;
    rows.push([code(f.param), type, 'No', desc, code(exampleFor(f.param))]);
  }
  rows.push(['`sortBy`, `sortOrder`', 'string', 'No', 'Alternative to `sort` (`sortOrder` = `ASC` or `DESC`)', '`createdAt`, `DESC`']);
  for (const field of def.fields) {
    rows.push([code(field.param), kindType(field), 'No', `${fieldDescription(field)}. ${kindMatch(field)}`, code(exampleFor(field.param, field))]);
  }
  if (def.fields.some((f) => f.param === 'locationId')) {
    rows.push(['`warehouseId`, `warehouse`', 'uuid / string', 'No', 'Aliases of `locationId` / `location` (branches are the storage locations)', '—']);
  }
  if (def.lineItems || def.headerProduct) {
    const where = def.headerProduct ? 'the product on the record' : 'any line item (the document is returned once)';
    for (const f of PRODUCT_FILTERS) {
      rows.push([code(f.param), f.kind === 'id' ? 'uuid (comma-separated)' : 'string', 'No', `${f.description.replace('on any line', `on ${where}`).replace(/ \(partial\)$/, '')}${f.kind === 'text' ? '. Partial, case-insensitive' : ''}`, code(exampleFor(f.param))]);
    }
  }
  for (const f of def.lineItems?.textFields ?? []) {
    rows.push([code(f.param), 'string', 'No', f.description, code(exampleFor(f.param))]);
  }
  return rows;
}

function exampleValue(type: string, name: string): unknown {
  if (/uuid/.test(type)) return '3f6c1e2a-7b8d-4c9e-a1f2-3b4c5d6e7f80';
  if (name === 'createdDate') return '2026-09-15';
  if (name === 'createdTime') return '10:30 AM';
  if (name === 'overAllStatus') return 'hold';
  if (type.startsWith('object[]')) return [];
  if (type.startsWith('string[]')) return [];
  if (type.startsWith('object')) return {};
  if (type.startsWith('number')) return 0;
  if (type.startsWith('boolean')) return false;
  if (/decimal/.test(name)) return '0.00';
  return 'string';
}

function exampleRow(fields: Field[], nested?: Record<string, Field[]>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [name, type, desc] of fields) {
    let value = exampleValue(type, name);
    if (/decimal/.test(desc)) value = '0.00';
    const nestedKey = nested && Object.keys(nested).find((k) => k.split(' / ').includes(name));
    if (nestedKey && type.startsWith('object')) {
      const child = exampleRow(nested![nestedKey]);
      value = type.startsWith('object[]') ? [child] : child;
    }
    row[name] = value;
  }
  return row;
}

function envelopeRows(env: Envelope): string[][] {
  if (env === 'meta') {
    return [
      ['`status`', 'string', '`"success"`'],
      ['`data`', 'object[]', 'The records (fields below)'],
      ['`meta.total`', 'number', 'Total matching records'],
      ['`meta.page`', 'number', 'Current page'],
      ['`meta.totalPages`', 'number', 'Total pages'],
    ];
  }
  return [
    ['`status`', 'string', '`"success"`'],
    ['`data`', 'object[]', 'The records (fields below)'],
    [env === 'rtv' ? '`totalRecords`' : '`allRecords`', 'number', 'Total matching records'],
    ['`totalPages`', 'number', 'Total pages'],
    ['`page`', 'number', 'Current page'],
    ...(env === 'rtv' ? [['`message`', 'string', '`"Return to vendor records fetched successfully"`']] : []),
  ];
}

function envelopeExample(env: Envelope, row: Record<string, unknown>): Record<string, unknown> {
  if (env === 'meta') return { status: 'success', data: [row], meta: { total: 1, page: 1, totalPages: 1 } };
  const body: Record<string, unknown> = { status: 'success', data: [row] };
  body[env === 'rtv' ? 'totalRecords' : 'allRecords'] = 1;
  body.totalPages = 1;
  body.page = 1;
  if (env === 'rtv') body.message = 'Return to vendor records fetched successfully';
  return body;
}

function curlQuery(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`).join('&');
}

const CELL_FORMAT: Record<ExportCellType, string> = {
  text: 'Text', integer: 'Number `0`', number: 'Number `#,##0.####`', amount: 'Number `#,##0.00`', quantity: 'Number `#,##0.###`',
  percent: 'Number `0.00"%"` (12.5 means 12.5%)', date: 'Date `dd-mm-yyyy`', datetime: 'Date-time in IST `dd-mm-yyyy hh:mm AM/PM`',
  time: 'Text (`HH:mm[:ss]`)', boolean: 'Text `Yes` / `No`',
};

function sheetsSection(def: ExportDefinition): string {
  const rows = def.sheets.map((s) => [code(s.name), String(s.columns.length), s.columns.map((c) => c.header).join(', ')]);
  return table(['Sheet', 'Columns', 'Column headers (in order)'], rows);
}

// ─── Document ────────────────────────────────────────────────────────────────

export function buildFilterApiDocs(): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  const defs = MODULES.map((m) => ({ mod: m, def: getModuleFilterDefinition(m.documentType)! }));
  for (const { mod, def } of defs) {
    if (!def) throw new Error(`No filter definition for ${mod.documentType}`);
  }

  push(
    '# Filter, Export & Import API Documentation',
    '',
    '> **Generated file — do not edit by hand.** Run `npm run docs:filters` after changing a filter definition, an export definition or a document list endpoint. `src/test/service/filterApiDocs.spec.ts` fails when this file is out of date.',
    '',
    'Get All (list) and Excel Export APIs for the 15 transaction modules, and the common filtering they share.',
    '',
    `- **Base URL:** \`${BASE}\` (no global route prefix; the port comes from \`PORT\`), as in [\`excel-import-export-api.md\`](excel-import-export-api.md)`,
    '- **Authentication:** `Authorization: Bearer <access_token>` (or the `access_token` cookie). Get a token from `POST /auth/login` — see [excel-import-export-api.md § 1](excel-import-export-api.md#1-get-an-access-token-first).',
    '- **Filter implementation:** `src/global/filters/` · **Export implementation:** `src/excel/export/` and `<module>/excel/*.export.ts`',
    '',
    '## Contents',
    '',
    '1. [API summary](#1-api-summary)',
    '2. [Filter summary](#2-filter-summary)',
    '3. [Authentication and authorization](#3-authentication-and-authorization)',
    '4. [Common filtering behaviour](#4-common-filtering-behaviour)',
    '5. [Error responses](#5-error-responses)',
    '6. [Export file format](#6-export-file-format)',
    '7. [Import APIs](#7-import-apis)',
    '8. [Modules](#8-modules)',
    ...MODULES.map((m, i) => `   ${i + 1}. [${m.section}](#8${i + 1}-${anchor(m.section)})`),
    `   ${MODULES.length + 1}. [All Vouchers](#8${MODULES.length + 1}-all-vouchers)`,
    '',
    '---',
    '',
    '## 1. API summary',
    '',
  );

  const summaryRows: string[][] = [];
  for (const { mod } of defs) {
    const paged = PAGING_TEXT[mod.paging].applied ? 'Yes' : 'No (returns all rows)';
    summaryRows.push([mod.section, 'GET', code(mod.listPath), 'Get records (list)', 'Yes', paged]);
    summaryRows.push([mod.section, 'GET', code(`${mod.listPath}/export/excel`), 'Export Excel', 'Yes', 'No']);
  }
  summaryRows.push(['All Vouchers', 'GET', '`/vouchers`', 'Get records of all voucher types', 'Yes', 'Yes (when page and limit are given)']);
  summaryRows.push(['All Vouchers', 'GET', '`/vouchers/export/excel`', 'Export Excel (all voucher types)', 'Yes', 'No']);
  push(table(['Module', 'Method', 'Endpoint', 'Purpose', 'Filters', 'Pagination'], summaryRows), '');
  push('No import, import-preview, import-validation, import-result or import-history API exists for these modules — see [§ 7](#7-import-apis).', '', '---', '', '## 2. Filter summary', '');

  const filterRows: string[][] = [];
  for (const { mod, def } of defs) {
    const has = (p: string) => def.fields.some((f) => f.param === p);
    const grouped = new Set([
      'companyId', 'company', 'customerId', 'customerCode', 'customerName', 'vendorId', 'vendorCode', 'vendorName', 'farmerId', 'farmerCode', 'farmerName',
      'locationId', 'location', 'approvalStatus', 'minAmount', 'maxAmount',
    ]);
    const other = def.fields.filter((f) => !grouped.has(f.param)).map((f) => f.param);
    if (def.lineItems?.textFields) other.push(...def.lineItems.textFields.map((f) => f.param));
    filterRows.push([
      mod.section,
      code(def.businessDate.source.split(' ')[0]),
      'Yes',
      'Yes',
      has('approvalStatus') ? 'Yes' : '—',
      has('customerId') ? 'id, code, name' : has('customerName') ? 'name (free text)' : '—',
      has('vendorId') ? 'id, code, name' : '—',
      has('farmerId') ? 'id, code, name' : '—',
      has('locationId') ? 'Yes' : '—',
      def.lineItems || def.headerProduct ? 'Yes' : '—',
      has('minAmount') ? 'Yes' : '—',
      other.length ? other.map(code).join(', ') : '—',
    ]);
  }
  filterRows.push(['All Vouchers', '`createdAt`', 'Yes', 'Yes', 'Yes', '—', '—', '—', 'Yes', 'Transport vouchers only', 'Yes', '`voucherType` + every voucher filter']);
  push(
    table(['Module', 'Date field', 'Search', 'Status', 'Approval status', 'Customer', 'Vendor', 'Farmer', 'Location / warehouse', 'Product', 'Amount range', 'Other filters'], filterRows),
    '',
    'Every module also supports: `documentNo`, `createdById`, `createdBy`, `approvedById`, `approvedBy`, `approvalStartDate`, `approvalEndDate`, `sort` (see [§ 4](#4-common-filtering-behaviour)).',
    '',
    '---',
    '',
    '## 3. Authentication and authorization',
    '',
    '### Authentication',
    '',
    'Every endpoint in this document is registered on a controller with the `deserializeUser` and `requireUser` middleware:',
    '',
    '- Send `Authorization: Bearer <access_token>`, or the `access_token` cookie set by `POST /auth/login`.',
    '- Missing token → `401 {"status":"fail","message":"You are not logged in"}`.',
    '- Invalid, expired or blacklisted token, or unknown user → `401 {"status":"fail","message":"You need to re-authenticate. Please log in."}`.',
    '',
    '### Authorization',
    '',
    'No role or permission middleware (`checkPermission`) is applied to these routes. Access is controlled by **row visibility**: each list returns only the documents the logged-in user may see, and every filter is applied **inside** that set in SQL — a filter can narrow what a user sees, never widen it. The Export uses exactly the same visibility.',
    '',
    table(
      ['Modules', 'A document is visible to', 'Implemented in'],
      (['single', 'double', 'documentb', 'invoice'] as Visibility[]).map((v) => [
        defs.filter(({ mod }) => mod.visibility === v).map(({ mod }) => mod.section).join(', '),
        VISIBILITY_TEXT[v],
        VISIBILITY_SOURCE[v],
      ]),
    ),
    '',
    'Soft-deleted documents (`documents.isDeleted` / `deletedAt`) are never listed or exported.',
    '',
    '---',
    '',
    '## 4. Common filtering behaviour',
    '',
    '### 4.1 One filter implementation for Get All and Export',
    '',
    '```text',
    'Get All  ─┐',
    '          ├─ applyDocumentListFilters()  →  parseDocumentFilters()  →  applyDocumentFilters() (SQL)',
    'Export   ─┘',
    '```',
    '',
    'Both endpoints of a module build their options through `applyDocumentListFilters` (`src/global/filters/documentListOptions.ts`) with the same query string, so the same parameters always select the same records. The only difference:',
    '',
    table(['', 'Get All', 'Export'], [
      ['Filters, search', 'Yes', 'Yes — identical'],
      ['Sorting', 'Yes', 'Yes — identical order'],
      ['Pagination (`page`, `limit`)', 'Yes (see each module)', '**No** — every matching record is exported'],
      ['Response', 'JSON', '`.xlsx` file'],
    ]),
    '',
    'Order of operations, in the database: **visibility → filters → search → sort → pagination (Get All only)**.',
    '',
    '### 4.2 Date filters',
    '',
    '- `startDate` and `endDate` take a calendar day, `YYYY-MM-DD`. `dateFrom` / `dateTo` are accepted as aliases.',
    '- Both bounds are **inclusive**. `endDate=2026-09-15` includes the whole day, up to 23:59:59.999.',
    '- Days are India Standard Time (Asia/Kolkata), like every date the application shows.',
    '- Either bound may be used alone; with neither, no date restriction applies.',
    '- A malformed or impossible date (`15-09-2026`, `2026-02-30`) → `400`.',
    '- `startDate` after `endDate` → `400`. The same rules apply to `approvalStartDate` / `approvalEndDate`.',
    '- Each module filters on its business date (below). Modules without a document-date column use the record creation date.',
    '',
    table(['Module', 'startDate / endDate filter on'], defs.map(({ mod, def }) => [mod.section, dateSource(def)])),
    '',
    'Deal Slip uses `deal_slips.createdAt` when `dealSlipCreatedAt` is empty. Date columns are compared as calendar days; timestamp columns (`createdAt`, `dealSlipCreatedAt`) are compared against the IST day bounds.',
    '',
    '### 4.3 Combining filters',
    '',
    'All filters are combined with **AND**:',
    '',
    '```text',
    'startDate AND endDate AND status AND vendorId AND locationId AND productId AND ...',
    '```',
    '',
    'Inside a single filter, OR applies only where the parameter itself says so:',
    '',
    '- a comma-separated list (`status=COMPLETE,hold`, `vendorId=<id1>,<id2>`) matches any of the values;',
    '- `locationId` / `location` match any of the module’s location fields (e.g. GRN `location`, `purchaseLocation`, `purchaseForSalesLocation`);',
    '- product filters match when **at least one** line item matches — the parent document is returned once, however many lines match.',
    '',
    '### 4.4 Value formats',
    '',
    table(['Kind', 'Format', 'Matching'], [
      ['Date', '`YYYY-MM-DD`', 'Inclusive whole day (IST)'],
      ['ID', 'UUID; comma-separated for several', 'Exact, on the foreign key (a record still matches an id whose related row was later soft-deleted)'],
      ['Enum', 'Allowed value; comma-separated for several', 'Exact (value case is normalised); unknown value → `400` listing the allowed values'],
      ['Text', 'Any text', 'Partial, case-insensitive; `%` and `_` are matched literally'],
      ['Case-insensitive list', 'Comma-separated', 'Exact, case-insensitive'],
      ['Boolean', '`true`/`false`, `1`/`0`, `yes`/`no`', 'Exact; other values → `400`'],
      ['Number', 'Number', '`minX` ≥, `maxX` ≤; non-number → `400`; `minX` > `maxX` → `400`'],
    ]),
    '',
    '- An absent or empty parameter (`?status=`) applies no filter.',
    '- Parameters a module does not support are ignored, as unknown query parameters always have been.',
    '',
    '### 4.5 Search',
    '',
    '`search` is a partial, case-insensitive match, applied in SQL before pagination. It matches if **any** of these contain the text: the module’s document number, the document creator’s name, the document status, the module’s search fields (listed per module), and — for modules with products — any line’s product name or product code.',
    '',
    '### 4.6 Sorting',
    '',
    '`sort=<field>:ASC|DESC` is the existing convention; `sortBy` + `sortOrder` are accepted as an alternative.',
    '',
    '- Fields listed as **sortable** for a module order the query in the database, so they decide which rows land on which page.',
    '- Any other field is never interpolated into SQL; the query falls back to its default order (newest document first).',
    '- A direction other than `ASC` / `DESC` → `400`.',
    '',
    '### 4.7 Pagination',
    '',
    table(['Module', 'Get All pagination'], defs.map(({ mod }) => [mod.section, PAGING_TEXT[mod.paging].text])),
    '',
    'Export ignores `page` and `limit` in every module.',
    '',
    '### 4.8 Parameters every module supports',
    '',
    table(['Parameter', 'Type', 'Description', 'Example'], [
      ...COMMON_FILTERS.map((f) => [code(f.param), COMMON_TYPES[f.param] ?? 'string', f.description, code(exampleFor(f.param))]),
      ['`sortBy`, `sortOrder`', 'string', 'Alternative to `sort`', '`createdAt`, `DESC`'],
      ['`dateFrom`, `dateTo`', 'date', 'Aliases of `startDate`, `endDate`', '`2026-09-01`'],
    ]),
    '',
    '`status` values (`documents.status`): ' + Object.values(DocumentStatus).map(code).join(', ') + '.',
    '',
    '`approvedById` / `approvedBy` / `approvalStartDate` / `approvalEndDate` match documents where a user **approved or verified** at any stage (verifier, approver levels 1–3, finalizer levels 1–2), using the recorded approval stages. All four combine on the same stage action.',
    '',
    '### 4.9 Product parameters',
    '',
    'Available on every module with line items (and on AQR, whose product is on the record):',
    '',
    table(['Parameter', 'Type', 'Description', 'Example'], PRODUCT_FILTERS.map((f) => [code(f.param), f.kind === 'id' ? 'uuid (comma-separated)' : 'string', f.description, code(exampleFor(f.param))])),
    '',
    '---',
    '',
    '## 5. Error responses',
    '',
    'All errors use the application’s standard body, produced by the global error handler in `src/app.ts`:',
    '',
    '```json',
    '{ "status": "fail", "message": "..." }',
    '```',
    '',
    '`status` is `"fail"` for 4xx and `"error"` for 5xx.',
    '',
    table(['Status', 'When', 'Example message'], [
      ['`400`', 'Invalid date, date range, id, enum, boolean, number, range or sort order (Get All **and** Export)', '`Invalid range: startDate (2026-09-15) is greater than endDate (2026-09-01)`'],
      ['`400`', 'Invalid `voucherType` (All Vouchers)', "`Invalid voucherType 'petty'. Allowed values: multi-cash-voucher, labour-payment-voucher, transport-payment-voucher, packing-material-voucher`"],
      ['`401`', 'Missing token', '`You are not logged in`'],
      ['`401`', 'Invalid or expired token', '`You need to re-authenticate. Please log in.`'],
      ['`403`', 'Not returned by these endpoints (no role/permission checks; see § 3)', '—'],
      ['`404`', 'Get All with no matching records — **Customer DC and Final Invoice only** (other lists return `200` with an empty `data`)', '`No customer delivery challans found`'],
      ['`404`', 'Export with no matching records (every module)', '`No records found for the given filters`'],
      ['`500`', 'Unexpected server error', '`Internal Server Error`'],
    ]),
    '',
    'Validation messages by filter kind: `Invalid <param> \'<value>\'. Expected a date in YYYY-MM-DD format` · `Expected a UUID` · `Expected a number` · `Expected true or false` · `Allowed values: ...` · `Invalid sort order \'<value>\'. Expected ASC or DESC`.',
    '',
    'If an export fails **after** the file has started streaming, the headers are already sent, so no JSON error is possible: the connection is closed and the download fails rather than delivering a truncated file.',
    '',
    '---',
    '',
    '## 6. Export file format',
    '',
    table(['Response header', 'Value'], [
      ['`Content-Type`', '`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`'],
      ['`Content-Disposition`', '`attachment; filename="<Stem>_<YYYY-MM-DD>.xlsx"; filename*=UTF-8\'\'<Stem>_<YYYY-MM-DD>.xlsx`'],
      ['`Cache-Control`', '`no-store`'],
      ['`X-Export-Record-Count`', 'Number of documents in the file'],
      ['`Access-Control-Expose-Headers`', '`Content-Disposition, X-Export-Record-Count`'],
    ]),
    '',
    '- The file name date is today in IST, e.g. `GRN_2026-09-15.xlsx`.',
    '- Format: `.xlsx`, streamed in chunks of 500 documents, so large exports use bounded memory and no `Content-Length` is sent.',
    '- Every sheet has a bold, frozen header row and an auto-filter.',
    '- Documents appear in the Get All order, and line items follow their document.',
    '- A sheet that would exceed Excel’s 1,048,575 data rows continues on `<Sheet> (2)`.',
    '- Every document export ends with an **Approvals** sheet: one row per approval action (stage, action, user, reason, date).',
    '- Every document sheet includes the approval summary columns: Document ID, Overall Status, last approval stage/action/user/date, approved by/date, rejected by/date/reason, document creator and timestamps.',
    '',
    'Cell formats:',
    '',
    table(['Column type', 'Excel format'], (Object.keys(CELL_FORMAT) as ExportCellType[]).map((t) => [code(t), CELL_FORMAT[t]])),
    '',
    '---',
    '',
    '## 7. Import APIs',
    '',
    'None of the 15 modules in this document has an import API. There are no import-preview, import-validation, import-result or import-history endpoints for them in the backend.',
    '',
    '- The only Excel import endpoints in the project are for master data: products, farmers, customers and vendors. They are documented in [`excel-import-export-api.md`](excel-import-export-api.md).',
    '- The file uploads on these modules (`uploadAttachments` on the delivery challans, `billImage` on GRN) attach files while creating or updating one document; they are not imports.',
    '- Because filters only make sense for listing, no filter parameters were added to any upload endpoint. The filter definitions and parser are reusable (`parseDocumentFilters`, `applyDocumentListFilters`) if an import preview, validation or result listing is added later.',
    '',
    '---',
    '',
    '## 8. Modules',
    '',
  );

  defs.forEach(({ mod, def }, index) => {
    const n = `8.${index + 1}`;
    const exportPath = `${mod.listPath}/export/excel`;
    const params = queryParamRows(mod, def, { exportApi: false });
    const exportParams = queryParamRows(mod, def, { exportApi: true });
    const exampleQuery = curlQuery({ ...mod.example, ...(PAGING_TEXT[mod.paging].applied ? { page: '1', limit: '20' } : {}) });
    const exportQuery = curlQuery(mod.example);
    const row = exampleRow(mod.rowFields, mod.nested);

    push(`### ${n} ${mod.section}`, '', `Document type \`${mod.documentType}\` · Record table: \`${def.businessDate.source.split('.')[0]}\` · Document number: \`${def.numberColumn}\``, '');

    // Get All
    push(
      `#### Get All ${mod.section}`,
      '',
      table(['', ''], [
        ['**Method**', 'GET'],
        ['**Endpoint**', code(mod.listPath)],
        ['**Purpose**', `Lists the ${mod.section} documents visible to the user, filtered, searched, sorted and paginated.`],
        ['**Authentication**', 'Bearer token (or `access_token` cookie)'],
        ['**Authorization**', `No role check. Visible to ${VISIBILITY_TEXT[mod.visibility]}.`],
        ['**Implemented in**', code(mod.source)],
        ['**Path parameters**', 'None'],
      ]),
      '',
      '**Query parameters** (all optional)',
      '',
      table(['Parameter', 'Type', 'Required', 'Description', 'Example'], params),
      '',
      `**Search fields** (\`search\`): document number (\`${def.numberColumn}\`), creator name, document status, ${def.search.map(searchLabel).join(', ')}${(def.lineItems || def.headerProduct) && !def.search.includes('product.name') ? ', product name / code' : ''}.`,
      '',
      `**Sortable in the database** (\`sort\`): ${Object.keys(def.sortable).map(code).join(', ')}.`,
      '',
      '**Example request**',
      '',
      '```http',
      `GET ${mod.listPath}?${exampleQuery}`,
      'Authorization: Bearer <token>',
      '```',
      '',
      '```bash',
      'curl -X GET \\',
      `  "${BASE}${mod.listPath}?${exampleQuery}" \\`,
      '  -H "Authorization: Bearer <token>"',
      '```',
      '',
      '**Response `200`**',
      '',
      table(['Field', 'Type', 'Description'], envelopeRows(mod.envelope)),
      '',
      '```json',
      JSON.stringify(envelopeExample(mod.envelope, row), null, 2),
      '```',
      '',
      '`data[]` fields:',
      '',
      table(['Field', 'Type', 'Description'], mod.rowFields.map(([name, type, desc]) => [code(name), type, desc])),
      '',
    );
    for (const [name, fields] of Object.entries(mod.nested ?? {})) {
      push(`\`${name}\` fields:`, '', table(['Field', 'Type', 'Description'], fields.map(([f, t, d]) => [code(f), t, d])), '');
    }
    push(
      mod.emptyStatus === 404
        ? `**No matching records:** \`404 {"status":"fail","message":"${mod.emptyMessage}"}\`.`
        : `**No matching records:** \`200\` with \`data: []\` and a total of \`0\`.`,
      '',
      '**Errors:** `400` invalid filter · `401` not authenticated · `500` unexpected error (see [§ 5](#5-error-responses)).',
      '',
    );

    // Export
    push(
      `#### Export ${mod.section}`,
      '',
      table(['', ''], [
        ['**Method**', 'GET'],
        ['**Endpoint**', code(exportPath)],
        ['**Purpose**', `Downloads every ${mod.section} document matching the filters as an \`.xlsx\` workbook. Same filters, search, sort and visibility as Get All; **no pagination**.`],
        ['**Authentication**', 'Bearer token (or `access_token` cookie)'],
        ['**Authorization**', 'Same row visibility as Get All.'],
        ['**Path parameters**', 'None'],
      ]),
      '',
      '**Query parameters:** every Get All parameter above; `page` and `limit` are ignored.',
      '',
      '<details><summary>Full parameter list</summary>',
      '',
      table(['Parameter', 'Type', 'Required', 'Description', 'Example'], exportParams),
      '',
      '</details>',
      '',
      '**Example request**',
      '',
      '```http',
      `GET ${exportPath}?${exportQuery}`,
      'Authorization: Bearer <token>',
      '```',
      '',
      '```bash',
      'curl -X GET \\',
      `  "${BASE}${exportPath}?${exportQuery}" \\`,
      '  -H "Authorization: Bearer <token>" \\',
      `  --output ${mod.exportDef.fileStem}.xlsx`,
      '```',
      '',
      '**Response `200`**',
      '',
      '```text',
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `Content-Disposition: attachment; filename="${mod.exportDef.fileStem}_2026-09-15.xlsx"; filename*=UTF-8''${mod.exportDef.fileStem}_2026-09-15.xlsx`,
      'Cache-Control: no-store',
      'X-Export-Record-Count: <documents in the file>',
      '```',
      '',
      `File name pattern: \`${mod.exportDef.fileStem}_<YYYY-MM-DD>.xlsx\`. Sheets:`,
      '',
      sheetsSection(mod.exportDef),
      '',
      '**Errors:** `400` invalid filter (JSON) · `401` not authenticated · `404 {"status":"fail","message":"No records found for the given filters"}` · `500` unexpected error.',
      '',
      `#### Import ${mod.section}`,
      '',
      'Not available — no import endpoint exists for this module (see [§ 7](#7-import-apis)).',
      '',
      '---',
      '',
    );
  });

  // All vouchers
  const voucherKinds = Object.values(VOUCHER_KINDS);
  const voucherTypes = MODULES.filter((m) => m.visibility === 'documentb' && m.documentType !== 'grn');
  const unionParams = new Map<string, { field: FieldFilter; types: string[] }>();
  for (const m of voucherTypes) {
    for (const f of getModuleFilterDefinition(m.documentType)!.fields) {
      const entry = unionParams.get(f.param) ?? { field: f, types: [] };
      entry.types.push(m.section);
      unionParams.set(f.param, entry);
    }
  }
  const voucherQuery = curlQuery({ startDate: '2026-09-01', endDate: '2026-09-15', voucherType: 'multi-cash-voucher,transport-payment-voucher', status: 'hold' });
  push(
    `### 8.${MODULES.length + 1} All Vouchers`,
    '',
    'All four voucher types (Multi Cash, Labour Payment, Transport Payment and Packing Material) in one list or one workbook. Each type is read through its own list service with the same common filters, so visibility and filtering match the four voucher lists above.',
    '',
    '#### Get All Vouchers',
    '',
    table(['', ''], [
      ['**Method**', 'GET'],
      ['**Endpoint**', '`/vouchers`'],
      ['**Purpose**', 'Merged list of every voucher type visible to the user, filtered and sorted, optionally paginated.'],
      ['**Authentication**', 'Bearer token (or `access_token` cookie)'],
      ['**Authorization**', `No role check. Per voucher type, visible to ${VISIBILITY_TEXT.documentb}.`],
      ['**Implemented in**', '`VouchersController.getAllVouchers`'],
      ['**Path parameters**', 'None'],
    ]),
    '',
    '**Query parameters** (all optional)',
    '',
    table(['Parameter', 'Type', 'Required', 'Description', 'Example'], [
      ['`page`', 'number', 'No', 'Page number. Pagination is applied only when both `page` and `limit` are given.', '`1`'],
      ['`limit`', 'number', 'No', 'Records per page', '`20`'],
      ['`voucherType`', 'enum (comma-separated)', 'No', `Voucher types to include; any of: ${voucherKinds.map(code).join(', ')}`, '`multi-cash-voucher,transport-payment-voucher`'],
      ...COMMON_FILTERS.map((f) => [code(f.param), COMMON_TYPES[f.param] ?? 'string', 'No', f.param === 'startDate' || f.param === 'endDate' ? `${f.description}. Filters on the voucher creation date` : f.description, code(exampleFor(f.param))]),
      ...[...unionParams.entries()].map(([param, { field, types }]) => [
        code(param),
        kindType(field),
        'No',
        `${fieldDescription(field)}. ${kindMatch(field)}.${types.length < voucherTypes.length ? ` Only ${types.join(', ')}  this field; other voucher types are excluded when it is used.` : ''}`,
        code(exampleFor(param, field)),
      ]),
      ...PRODUCT_FILTERS.map((f) => [code(f.param), f.kind === 'id' ? 'uuid (comma-separated)' : 'string', 'No', `${f.description}. Only Transport Payment Vouchers have products; other types are excluded when used.`, code(exampleFor(f.param))]),
    ]),
    '',
    '**Sorting:** `sort` (or `sortBy` + `sortOrder`) on any field of the returned rows; without it, newest documents first.',
    '',
    '**Example request**',
    '',
    '```bash',
    'curl -X GET \\',
    `  "${BASE}/vouchers?${voucherQuery}&page=1&limit=20" \\`,
    '  -H "Authorization: Bearer <token>"',
    '```',
    '',
    '**Response `200`**',
    '',
    table(['Field', 'Type', 'Description'], [
      ['`status`', 'string', '`"success"`'],
      ['`data`', 'object[]', 'Rows of each voucher type’s own list (see § 8.15–8.18), plus the fields below'],
      ['`data[].voucherType`', 'string', `One of ${voucherKinds.map(code).join(', ')}`],
      ['`data[].voucherTypeLabel`', 'string', 'Readable voucher type, e.g. `Transport Payment Voucher`'],
      ['`allRecords`', 'number', 'Total matching records'],
      ['`totalPages`', 'number', 'Total pages (1 when not paginated)'],
      ['`page`', 'number', 'Current page (1 when not paginated)'],
    ]),
    '',
    '```json',
    JSON.stringify({ status: 'success', data: [{ ...exampleRow(VOUCHER_ROW_BASE), voucherType: 'multi-cash-voucher', voucherTypeLabel: 'Multi Cash Voucher' }], allRecords: 1, totalPages: 1, page: 1 }, null, 2),
    '```',
    '',
    '**No matching records:** `200` with `data: []`, `allRecords: 0`.',
    '',
    '**Errors:** `400` invalid filter or `voucherType` · `401` not authenticated · `500` unexpected error.',
    '',
    '#### Export All Vouchers',
    '',
    table(['', ''], [
      ['**Method**', 'GET'],
      ['**Endpoint**', '`/vouchers/export/excel`'],
      ['**Purpose**', 'Downloads every voucher of every selected type matching the filters, in the same order as `GET /vouchers`; **no pagination**.'],
      ['**Authentication**', 'Bearer token (or `access_token` cookie)'],
      ['**Authorization**', 'Same row visibility as `GET /vouchers`.'],
      ['**Path parameters**', 'None'],
    ]),
    '',
    '**Query parameters:** every `GET /vouchers` parameter; `page` and `limit` are ignored.',
    '',
    '```bash',
    'curl -X GET \\',
    `  "${BASE}/vouchers/export/excel?${voucherQuery}" \\`,
    '  -H "Authorization: Bearer <token>" \\',
    `  --output ${ALL_VOUCHERS_EXPORT.fileStem}.xlsx`,
    '```',
    '',
    `**Response \`200\`:** \`${ALL_VOUCHERS_EXPORT.fileStem}_<YYYY-MM-DD>.xlsx\`, headers as in [§ 6](#6-export-file-format). The \`All Vouchers\` sheet has a \`Voucher Type\` column; the approval sheet is \`Voucher Approvals\`. Sheets:`,
    '',
    sheetsSection(ALL_VOUCHERS_EXPORT),
    '',
    '**Errors:** `400` invalid filter or `voucherType` · `401` not authenticated · `404 {"status":"fail","message":"No records found for the given filters"}` · `500` unexpected error.',
    '',
    '#### Import All Vouchers',
    '',
    'Not available — no import endpoint exists for vouchers (see [§ 7](#7-import-apis)).',
    '',
  );

  return out.join('\n');
}

if (require.main === module) {
  const target = path.join(process.cwd(), DOC_RELATIVE_PATH);
  fs.writeFileSync(target, buildFilterApiDocs(), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${DOC_RELATIVE_PATH}`);
}
