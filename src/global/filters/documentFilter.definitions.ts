/**
 * Filter definitions for every document type, derived from the entities.
 *
 * Common filters (dates, document status, search, document number, creator,
 * approver, products, sorting) are added by the parser for every module; this
 * file only declares what differs per module: the record, its business date, its
 * relations and its module-specific fields.
 *
 * Modules without a document-date column (RFPA, GRN, the three delivery challans
 * and the vouchers) filter `startDate` / `endDate` on the record's creation date.
 */

import { DocumentTypeEnum } from '../../approvalFlow/entity/docuemnt.entity';
import { Department, Source, Status, ammountStatus } from '../../utils/status.enum';
import { RFPA } from '../../rfpa/entity/rfpa.entity';
import { RFPAProduct } from '../../rfpa/entity/rfpaProduct.entity';
import { DealSlip } from '../../dealSlip/entity/dealSlip.entity';
import { GRN, GrnType, LocationType, PurchaseType } from '../../grn/entity/grn.entity';
import { GrnProduct } from '../../grn/entity/grnProduct.entity';
import { InwardRegister, InwardType } from '../../inwardRegister/entity/inwardRegister.entity';
import { InwardProduct } from '../../inwardRegister/entity/inwardProduct.entity';
import { Aqr, AqrFor } from '../../aqr/entity/aqr.entity';
import { DumpRegister, DumpType } from '../../dumpRegister/entity/dumpRegister.entity';
import { DumpProduct } from '../../dumpRegister/entity/dumpProduct.entity';
import { Item } from '../../deliveryChallans/deliverychllan/entity/dItem.entity';
import { CustomerDeliveryChallan } from '../../deliveryChallans/customerDeliveryChllan/entity/customerDeliveryChallan.entity';
import {
  StockTransferDeliveryChallan,
  StockTransferType,
} from '../../deliveryChallans/stockTransferDC/entity/stockTransferdeliveryChallan.entity';
import { OtherDeliveryChallan } from '../../deliveryChallans/otherDeliveryChallan/entity/otherDeliveryChallan.entity';
import { Invoice } from '../../invoice/entity/invoice.entity';
import { InvoiceProduct } from '../../invoice/entity/invoiceProduct.entity';
import { PostReturnByCustomer } from '../../returnByCustomer/entity/postReturnByCustomer.entity';
import { ReturnedProducts } from '../../returnByCustomer/entity/returnProduct.entity';
import { ReturnToVendor } from '../../returnToVendor/entity/returnToVendor.entity';
import { ProductReturnToVendor } from '../../returnToVendor/entity/productReturnToVendor.entity';
import { SecondSale } from '../../secondSale/entity/secondSale.entity';
import { SecondSaleProduct } from '../../secondSale/entity/secondSaleProduct.entity';
import { VehicleDispatch } from '../../vehicleDispatch/entity/vehicleDispatch.entity';
import { CashVoucher } from '../../vouchers/multiCashV/entity/mCashVoucher.entity';
import { LPVoucher } from '../../vouchers/labourPaymentV/entity/labourPaymentVoucher.entity';
import { TPVoucher } from '../../vouchers/tranportPaymentV/entity/transportPaymentvoucher.entity';
import { PMPVoucher } from '../../vouchers/paymentMaterialV/entity/packingMaterialVoucher.entity';
import { FieldFilter, ModuleFilterDefinition } from './documentFilter.types';

// ─── Reusable field blocks ──────────────────────────────────────────────────

const id = (param: string, exprs: string[], description: string): FieldFilter => ({ param, kind: 'id', exprs, description });
const text = (param: string, exprs: string[], description: string): FieldFilter => ({ param, kind: 'text', exprs, description });
const enumOf = (param: string, expr: string, values: object, description: string): FieldFilter => ({
  param,
  kind: 'enum',
  exprs: [expr],
  values: Object.values(values) as string[],
  description,
});
const flag = (param: string, expr: string, description: string): FieldFilter => ({ param, kind: 'boolean', exprs: [expr], description });
const amountRange = (expr: string, what: string): FieldFilter[] => [
  { param: 'minAmount', kind: 'min', exprs: [expr], description: `${what} >= value` },
  { param: 'maxAmount', kind: 'max', exprs: [expr], description: `${what} <= value` },
];

const personName = (alias: string) => `CONCAT_WS(' ', ${alias}.firstName, ${alias}.middleName, ${alias}.lastName)`;
const farmerFullName = (alias: string) => `CONCAT_WS(' ', ${alias}.farmerfName, ${alias}.farmermName, ${alias}.farmerlName)`;

const companyFields = (join = 'company'): FieldFilter[] => [
  id('companyId', [`${join}.id`], 'Company id'),
  text('company', [`${join}.name`], 'Company name (partial)'),
];
const vendorFields = (join = 'vendor'): FieldFilter[] => [
  id('vendorId', [`${join}.id`], 'Vendor id'),
  text('vendorCode', [`${join}.vendorCode`], 'Vendor code (partial)'),
  text('vendorName', [`${join}.companyName`], 'Vendor name (partial)'),
];
const farmerFields = (join = 'farmer'): FieldFilter[] => [
  id('farmerId', [`${join}.id`], 'Farmer id'),
  text('farmerCode', [`${join}.farmerCode`], 'Farmer code (partial)'),
  text('farmerName', [farmerFullName(join)], 'Farmer name (partial)'),
];
const customerFields = (join = 'customer'): FieldFilter[] => [
  id('customerId', [`${join}.id`], 'Customer id'),
  text('customerCode', [`${join}.customerCode`], 'Customer code (partial)'),
  text('customerName', [`${join}.organisationName`], 'Customer name (partial)'),
];
/** Branches are the storage locations; `warehouseId` / `warehouse` are accepted as aliases. */
const locationFields = (joins: string[], extraNames: string[] = []): FieldFilter[] => [
  id('locationId', joins.map((j) => `${j}.id`), `Location (branch) id, on: ${joins.join(', ')}`),
  text('location', [...joins.map((j) => `${j}.name`), ...extraNames], 'Location name (partial)'),
];
const departmentField = (expr = 'rec.requestingDepartment') => enumOf('requestingDepartment', expr, Department, 'Requesting department');

const standardSort = (numberKey: string, numberExpr: string, extra: Record<string, string> = {}): Record<string, string> => ({
  createdAt: 'doc.createdAt',
  createdDate: 'doc.createdAt',
  updatedAt: 'rec.updatedAt',
  status: 'doc.status',
  overAllStatus: 'doc.status',
  documentNo: numberExpr,
  [numberKey]: numberExpr,
  ...extra,
});

// ─── Delivery challans share their base table and line table ────────────────

const challanBase = (): { joins: Record<string, string>; fields: FieldFilter[]; search: string[] } => ({
  joins: { company: 'rec.companyName', grn: 'rec.grnNo' },
  fields: [
    ...companyFields(),
    enumOf('approvalStatus', 'rec.approvalStatus', Status, 'Challan approval status'),
    departmentField(),
    text('grnNo', ['grn.grnNo'], 'Linked GRN number (partial)'),
    text('vehicleNo', ['rec.vehicleNo'], 'Vehicle number (partial)'),
    text('driverName', ['rec.driverName'], 'Driver name (partial)'),
    flag('isReturned', 'rec.isReturned', 'Challan has been returned'),
    ...amountRange('rec.totalProductAmount', 'Total product amount'),
  ],
  search: ['company.name', 'grn.grnNo', 'rec.vehicleNo', 'rec.driverName', 'rec.receiverName'],
});

const challanLines = { entity: Item, parentRelation: 'deliveryChallan', product: 'productName', variant: 'variant' };

// ─── Vouchers share an approval/party block ────────────────────────────────

const voucherBase = (amountExpr: string): { joins: Record<string, string>; fields: FieldFilter[]; search: string[] } => ({
  joins: { company: 'rec.companyName', location: 'rec.location', grn: 'rec.grnNo' },
  fields: [
    ...companyFields(),
    ...locationFields(['location']),
    enumOf('approvalStatus', 'rec.approvalStatus', Status, 'Voucher approval status'),
    departmentField(),
    { param: 'paymentMode', kind: 'iexact', exprs: ['rec.paymentMode'], description: 'Payment mode (exact, case-insensitive)' },
    text('grnNo', ['grn.grnNo'], 'Linked GRN number (partial)'),
    text('receiverName', ['rec.receiverName'], 'Receiver name (partial)'),
    text('payReceivedFrom', ['rec.payReceivedFrom'], 'Pay / received from (partial)'),
    text('debitCreditTo', ['rec.debitCreditTo'], 'Debit / credit to (partial)'),
    ...amountRange(amountExpr, 'Voucher amount'),
  ],
  search: ['company.name', 'location.name', 'grn.grnNo', 'rec.receiverName', 'rec.payReceivedFrom', 'rec.debitCreditTo'],
});

// ─── Definitions ────────────────────────────────────────────────────────────

const DEFINITIONS: ModuleFilterDefinition[] = [
  {
    documentType: DocumentTypeEnum.RFPA,
    module: 'RFPA',
    entity: RFPA,
    numberColumn: 'rfpaId',
    businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'rfpa.createdAt (RFPA has no document date column)' },
    joins: {
      company: 'rec.companyName',
      purchaseLocation: 'rec.purchaseLocation',
      purchaseForSalesLocation: 'rec.purchaseForSalesLocation',
      vendor: 'rec.selectedVendor',
      farmer: 'rec.selectedFarmer',
    },
    fields: [
      enumOf('source', 'rec.source', Source, 'Source: vendor or farmer'),
      departmentField(),
      ...companyFields(),
      ...vendorFields(),
      ...farmerFields(),
      ...locationFields(['purchaseLocation', 'purchaseForSalesLocation'], ['rec.otherPurchaseLoc', 'rec.otherPurchaseForSalesLoc']),
      flag('isDealSlipCreated', 'rec.isDealSlipCreated', 'A deal slip has been raised'),
    ],
    search: ['company.name', 'vendor.companyName', 'vendor.vendorCode', farmerFullName('farmer'), 'purchaseLocation.name', 'rec.deliveryReceivingPerson'],
    lineItems: { entity: RFPAProduct, parentRelation: 'rfpa', product: 'productName', variant: 'variant' },
    sortable: standardSort('rfpaId', 'rec.rfpaId'),
  },
  {
    documentType: DocumentTypeEnum.DEAL_SLIP,
    module: 'Deal Slip',
    entity: DealSlip,
    numberColumn: 'dealSlipNo',
    businessDate: { expr: 'COALESCE(rec.dealSlipCreatedAt, rec.createdAt)', kind: 'timestamp', source: 'deal_slips.dealSlipCreatedAt' },
    joins: {
      rfpa: 'rec.rfpa',
      company: 'rfpa.companyName',
      vendor: 'rfpa.selectedVendor',
      farmer: 'rfpa.selectedFarmer',
      purchaseLocation: 'rfpa.purchaseLocation',
      purchaseForSalesLocation: 'rfpa.purchaseForSalesLocation',
    },
    fields: [
      enumOf('approvalStatus', 'rec.approvalStatus', Status, 'Deal slip approval status'),
      departmentField(),
      text('dealSlipNo', ['rec.dealSlipNo'], 'Deal slip number (partial)'),
      text('lotNo', ['rec.lotNo'], 'Lot number (partial)'),
      text('loadingLocation', ['rec.loadingLocation'], 'Loading location (partial)'),
      text('rfpaNo', ['rfpa.rfpaId'], 'RFPA number (partial)'),
      ...companyFields(),
      ...vendorFields(),
      ...farmerFields(),
      ...locationFields(['purchaseLocation', 'purchaseForSalesLocation']),
      flag('isGrnCreated', 'rec.isGrnCreated', 'A GRN has been raised'),
    ],
    search: ['rec.lotNo', 'rec.loadingLocation', 'rfpa.rfpaId', 'company.name', 'vendor.companyName', 'vendor.vendorCode', farmerFullName('farmer')],
    lineItems: { entity: RFPAProduct, parentRelation: 'rfpa', parentIdExpr: 'rfpa.id', product: 'productName', variant: 'variant' },
    sortable: standardSort('dealSlipNo', 'rec.dealSlipNo', { dealSlipCreatedAt: 'rec.dealSlipCreatedAt' }),
  },
  {
    documentType: DocumentTypeEnum.GRN,
    module: 'GRN',
    entity: GRN,
    numberColumn: 'grnNo',
    businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'grns.createdAt (GRN has no document date column)' },
    joins: {
      company: 'rec.companyName',
      dealSlip: 'rec.dealSlipId',
      rfpa: 'rec.rfpa',
      location: 'rec.location',
      purchaseLocation: 'rec.purchaseLocation',
      purchaseForSalesLocation: 'rec.purchaseForSalesLocation',
      vendor: 'rec.selectedVendor',
      farmer: 'rec.selectedFarmer',
    },
    fields: [
      enumOf('grnType', 'rec.grnType', GrnType, 'GRN type'),
      enumOf('purchaseType', 'rec.purchaseType', PurchaseType, 'Purchase type'),
      enumOf('locationType', 'rec.locationType', LocationType, 'Location type'),
      enumOf('source', 'rec.source', Source, 'Source: vendor or farmer'),
      enumOf('paymentStatus', 'rec.ammountStatus', ammountStatus, 'Payment status'),
      departmentField(),
      ...companyFields(),
      // Historic GRN list parameter: accepts a company id or a (partial) company name.
      { param: 'companyName', kind: 'id', exprs: ['company.id'], nameExprs: ['company.name'], description: 'Company id or name' },
      text('dealSlipNo', ['dealSlip.dealSlipNo'], 'Deal slip number (partial)'),
      text('rfpaNo', ['rfpa.rfpaId'], 'RFPA number (partial)'),
      ...vendorFields(),
      ...farmerFields(),
      ...locationFields(['location', 'purchaseLocation', 'purchaseForSalesLocation'], ['rec.baseLocation']),
      text('vehicleNo', ['rec.vehicleNo'], 'Vehicle number (partial)'),
      text('billNo', ['rec.billNo'], 'Bill number (partial)'),
      ...amountRange('rec.totalAmt', 'GRN total amount'),
    ],
    search: ['rec.billNo', 'rec.vehicleNo', 'company.name', 'dealSlip.dealSlipNo', 'rfpa.rfpaId', 'vendor.companyName', 'vendor.vendorCode', farmerFullName('farmer'), 'location.name'],
    lineItems: { entity: GrnProduct, parentRelation: 'grn', product: 'productName', variant: 'variant' },
    sortable: standardSort('grnNo', 'rec.grnNo', { totalAmt: 'rec.totalAmt' }),
  },
  {
    documentType: DocumentTypeEnum.INWARD_REGISTER,
    module: 'Inward Register',
    entity: InwardRegister,
    numberColumn: 'inwardNo',
    businessDate: { expr: 'rec.date', kind: 'date', source: 'inward_register.date' },
    joins: {
      grn: 'rec.grnNo',
      challan: 'rec.deliveryChallanNo',
      rbc: 'rec.rbcNo',
      company: 'rec.companyName',
      location: 'rec.location',
      fromLocation: 'rec.fromLocation',
      vendor: 'rec.selectedVendor',
      farmer: 'rec.selectedFarmer',
      customer: 'rec.customerName',
    },
    fields: [
      enumOf('inwardType', 'rec.inwardType', InwardType, 'Inward type'),
      enumOf('source', 'rec.source', Source, 'Source: vendor or farmer'),
      text('batchNo', ['rec.batchNo'], 'Batch number (partial)'),
      text('grnNo', ['grn.grnNo'], 'GRN number (partial)'),
      text('deliveryChallanNo', ['challan.challanNo'], 'Delivery challan number (partial)'),
      text('rbcNo', ['rbc.rbcNo'], 'Return by customer number (partial)'),
      ...companyFields(),
      ...locationFields(['location', 'fromLocation']),
      ...vendorFields(),
      ...farmerFields(),
      ...customerFields(),
      ...amountRange('rec.inwardCost', 'Inward cost'),
    ],
    search: ['rec.batchNo', 'grn.grnNo', 'challan.challanNo', 'company.name', 'location.name', 'vendor.companyName', farmerFullName('farmer'), 'customer.organisationName'],
    lineItems: { entity: InwardProduct, parentRelation: 'inwardRegister', product: 'productName', variant: 'variant' },
    sortable: standardSort('inwardNo', 'rec.inwardNo', { date: 'rec.date' }),
  },
  {
    documentType: DocumentTypeEnum.AQR,
    module: 'AQR',
    entity: Aqr,
    numberColumn: 'aqrNo',
    businessDate: { expr: 'rec.arrivalDate', kind: 'date', source: 'aqr.arrivalDate' },
    joins: {
      company: 'rec.companyName',
      location: 'rec.location',
      fromLocation: 'rec.fromLocation',
      challan: 'rec.deliveryChallanNo',
      vendor: 'rec.selectedVendor',
      farmer: 'rec.selectedFarmer',
      product: 'rec.product',
      variant: 'rec.variant',
    },
    fields: [
      enumOf('aqrFor', 'rec.aqrFor', AqrFor, 'AQR for'),
      enumOf('source', 'rec.source', Source, 'Source: vendor or farmer'),
      text('deliveryChallanNo', ['challan.challanNo'], 'Delivery challan number (partial)'),
      ...companyFields(),
      ...locationFields(['location', 'fromLocation']),
      ...vendorFields(),
      ...farmerFields(),
      // Historic AQR list parameters.
      text('supplierName', ['vendor.companyName', farmerFullName('farmer')], 'Vendor or farmer name (partial)'),
      { param: 'arrivalDate', kind: 'day', exprs: ['rec.arrivalDate'], description: 'Exact arrival date (YYYY-MM-DD)' },
      { param: 'minQuantity', kind: 'min', exprs: ['rec.totalQty'], description: 'Total quantity >= value' },
      { param: 'maxQuantity', kind: 'max', exprs: ['rec.totalQty'], description: 'Total quantity <= value' },
    ],
    search: ['challan.challanNo', 'company.name', 'location.name', 'vendor.companyName', farmerFullName('farmer'), 'product.name', 'product.productCode'],
    headerProduct: { product: 'product', variant: 'variant' },
    sortable: standardSort('aqrNo', 'rec.aqrNo', { arrivalDate: 'rec.arrivalDate' }),
  },
  {
    documentType: DocumentTypeEnum.DUMP_REGISTER,
    module: 'Dump Register',
    entity: DumpRegister,
    numberColumn: 'dumpNo',
    businessDate: { expr: 'rec.date', kind: 'date', source: 'dump_register.date' },
    joins: {
      challan: 'rec.deliveryChallanNo',
      rbc: 'rec.rbcNo',
      grn: 'rec.grn',
      company: 'rec.companyName',
      location: 'rec.location',
      requestedBy: 'rec.requestedBy',
    },
    fields: [
      enumOf('dumpType', 'rec.dumpType', DumpType, 'Dump type'),
      text('batchNo', ['rec.batchNo'], 'Batch number (partial)'),
      text('grnNo', ['grn.grnNo'], 'GRN number (partial)'),
      text('deliveryChallanNo', ['challan.challanNo'], 'Delivery challan number (partial)'),
      text('rbcNo', ['rbc.rbcNo'], 'Return by customer number (partial)'),
      ...companyFields(),
      ...locationFields(['location']),
      id('requestedById', ['requestedBy.id'], 'Requested-by user id'),
      ...amountRange('rec.totalDumpCost', 'Total dump cost'),
      { param: 'minQuantity', kind: 'min', exprs: ['rec.totalQty'], description: 'Total dump quantity >= value' },
      { param: 'maxQuantity', kind: 'max', exprs: ['rec.totalQty'], description: 'Total dump quantity <= value' },
    ],
    search: ['rec.batchNo', 'grn.grnNo', 'challan.challanNo', 'rbc.rbcNo', 'company.name', 'location.name', 'rec.remark'],
    lineItems: { entity: DumpProduct, parentRelation: 'dumpRegister', product: 'productName', variant: 'variant' },
    sortable: standardSort('dumpNo', 'rec.dumpNo', { date: 'rec.date' }),
  },
  (() => {
    const base = challanBase();
    return {
      documentType: DocumentTypeEnum.DC_TYPE_CUSTOMER,
      module: 'Customer Delivery Challan',
      entity: CustomerDeliveryChallan,
      numberColumn: 'challanNo',
      businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'delivery_challan_purchase.createdAt (no challan date column)' },
      joins: { ...base.joins, customer: 'rec.customerName', fromLocation: 'rec.fromLocation' },
      fields: [
        ...base.fields,
        ...customerFields(),
        ...locationFields(['fromLocation']),
        text('poNumber', ['rec.poNumber'], 'PO number (partial)'),
        flag('isInvoiceCreated', 'rec.isInvoiceCreated', 'An invoice has been raised'),
        flag('isReturnByCustomerCreated', 'rec.isReturnByCustomerCreated', 'A return by customer has been raised'),
      ],
      search: [...base.search, 'customer.organisationName', 'customer.customerCode', 'rec.poNumber', 'fromLocation.name'],
      lineItems: challanLines,
      sortable: standardSort('challanNo', 'rec.challanNo'),
    } as ModuleFilterDefinition;
  })(),
  (() => {
    const base = challanBase();
    return {
      documentType: DocumentTypeEnum.DC_TYPE_STOCK_TRANSFER,
      module: 'Stock Transfer Delivery Challan',
      entity: StockTransferDeliveryChallan,
      numberColumn: 'challanNo',
      businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'delivery_challan_purchase.createdAt (no challan date column)' },
      joins: { ...base.joins, fromLocation: 'rec.fromLocation', toLocation: 'rec.toLocation' },
      fields: [
        ...base.fields,
        enumOf('stockTransferType', 'rec.stockTransferType', StockTransferType, 'Stock transfer type'),
        ...locationFields(['fromLocation', 'toLocation']),
        id('sourceLocationId', ['fromLocation.id'], 'Source location id'),
        text('sourceLocation', ['fromLocation.name'], 'Source location name (partial)'),
        id('destinationLocationId', ['toLocation.id'], 'Destination location id'),
        text('destinationLocation', ['toLocation.name'], 'Destination location name (partial)'),
      ],
      search: [...base.search, 'fromLocation.name', 'toLocation.name'],
      lineItems: challanLines,
      sortable: standardSort('challanNo', 'rec.challanNo'),
    } as ModuleFilterDefinition;
  })(),
  (() => {
    const base = challanBase();
    return {
      documentType: DocumentTypeEnum.DC_TYPE_OTHER,
      module: 'Other Delivery Challan',
      entity: OtherDeliveryChallan,
      numberColumn: 'challanNo',
      businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'delivery_challan_purchase.createdAt (no challan date column)' },
      joins: { ...base.joins, fromLocation: 'rec.fromLocation' },
      fields: [
        ...base.fields,
        ...locationFields(['fromLocation']),
        // The party on an Other DC is free text, not a customer record.
        text('customerName', ['rec.customer'], 'Party name (partial)'),
        text('customerContactNo', ['rec.customerContactNo'], 'Party contact number (partial)'),
      ],
      search: [...base.search, 'rec.customer', 'fromLocation.name'],
      lineItems: challanLines,
      sortable: standardSort('challanNo', 'rec.challanNo'),
    } as ModuleFilterDefinition;
  })(),
  {
    documentType: DocumentTypeEnum.FINAL_INVOICE,
    module: 'Final Invoice',
    entity: Invoice,
    numberColumn: 'invoiceNo',
    businessDate: { expr: 'rec.invoiceDate', kind: 'date', source: 'invoices.invoiceDate' },
    joins: { company: 'rec.companyName', challan: 'rec.deliveryChallan', customer: 'rec.customerName', fromLocation: 'rec.fromLocation' },
    fields: [
      enumOf('paymentStatus', 'rec.ammountStatus', ammountStatus, 'Payment status'),
      ...companyFields(),
      ...customerFields(),
      ...locationFields(['fromLocation']),
      text('deliveryChallanNo', ['challan.challanNo'], 'Delivery challan number (partial)'),
      text('poNumber', ['rec.poNumber'], 'PO number (partial)'),
      text('vehicleNo', ['rec.vehicleNo'], 'Vehicle number (partial)'),
      text('placeOfSupply', ['rec.placeOfSupply'], 'Place of supply (partial)'),
      ...amountRange('rec.totalAmount', 'Invoice grand total'),
    ],
    // Superset of the fields the invoice list already searched in SQL.
    search: ['company.name', 'customer.organisationName', 'customer.customerCode', 'challan.challanNo', 'rec.vehicleNo', 'rec.poNumber', 'fromLocation.name'],
    lineItems: { entity: InvoiceProduct, parentRelation: 'invoice', product: 'productName', variant: 'variant' },
    sortable: standardSort('invoiceNo', 'rec.invoiceNo', { invoiceDate: 'rec.invoiceDate', totalAmount: 'rec.totalAmount' }),
  },
  {
    documentType: DocumentTypeEnum.RETURN_BY_CUSTOMER,
    module: 'Return By Customer',
    entity: PostReturnByCustomer,
    numberColumn: 'rbcNo',
    businessDate: { expr: 'rec.date', kind: 'date', source: 'return_by_customer.date' },
    joins: { challan: 'rec.deliveryChallanNo', company: 'rec.companyName', location: 'rec.location', customer: 'rec.customerName' },
    fields: [
      ...companyFields(),
      ...customerFields(),
      ...locationFields(['location']),
      text('deliveryChallanNo', ['challan.challanNo'], 'Original delivery challan number (partial)'),
    ],
    search: ['challan.challanNo', 'company.name', 'customer.organisationName', 'customer.customerCode', 'location.name', 'rec.remark'],
    lineItems: { entity: ReturnedProducts, parentRelation: 'postReturn', product: 'productName', variant: 'variant' },
    sortable: standardSort('rbcNo', 'rec.rbcNo', { date: 'rec.date' }),
  },
  {
    documentType: DocumentTypeEnum.RETURN_TO_VENDOR,
    module: 'Return To Vendor',
    entity: ReturnToVendor,
    numberColumn: 'rtvNo',
    businessDate: { expr: 'rec.returnDate', kind: 'date', source: 'return_to_vendor.returnDate' },
    joins: { grn: 'rec.grnNo', company: 'rec.companyName', location: 'rec.location', vendor: 'rec.selectedVendor' },
    fields: [
      ...companyFields(),
      ...vendorFields(),
      ...locationFields(['location']),
      text('grnNo', ['grn.grnNo'], 'Original GRN number (partial)'),
      ...amountRange('rec.totalAmt', 'Return total amount'),
    ],
    search: ['grn.grnNo', 'company.name', 'vendor.companyName', 'vendor.vendorCode', 'location.name', 'rec.remark'],
    lineItems: {
      entity: ProductReturnToVendor,
      parentRelation: 'returnToVendor',
      product: 'productName',
      variant: 'variant',
      textFields: [{ param: 'returnReason', column: 'reason', description: 'Return reason on any line (partial)' }],
    },
    sortable: standardSort('rtvNo', 'rec.rtvNo', { returnDate: 'rec.returnDate', totalAmt: 'rec.totalAmt' }),
  },
  {
    documentType: DocumentTypeEnum.SECOND_SALE,
    module: 'Second Sale',
    entity: SecondSale,
    numberColumn: 'secondSaleNo',
    businessDate: { expr: 'rec.saleDate', kind: 'date', source: 'second_sale_document.saleDate' },
    joins: { company: 'rec.companyName', location: 'rec.location', challan: 'rec.deliveryChallanNo' },
    fields: [
      ...companyFields(),
      ...locationFields(['location']),
      // The buyer on a second sale is free text, not a customer record.
      text('customerName', ['rec.customerName'], 'Customer name (partial)'),
      text('customerContactNo', ['rec.customerContactNo'], 'Customer contact number (partial)'),
      text('deliveryChallanNo', ['challan.challanNo'], 'Source delivery challan number (partial)'),
      { param: 'paymentMode', kind: 'iexact', exprs: ['rec.paymentMode'], description: 'Payment mode (exact, case-insensitive)' },
      text('reasonForSale', ['rec.reasonForSale'], 'Reason for sale (partial)'),
      ...amountRange('rec.totalAmt', 'Second sale total amount'),
    ],
    search: ['rec.customerName', 'rec.customerContactNo', 'challan.challanNo', 'company.name', 'location.name', 'rec.reasonForSale'],
    lineItems: { entity: SecondSaleProduct, parentRelation: 'secondSaleRegister', product: 'productName', variant: 'variant' },
    sortable: standardSort('secondSaleNo', 'rec.secondSaleNo', { saleDate: 'rec.saleDate', totalAmt: 'rec.totalAmt' }),
  },
  {
    documentType: DocumentTypeEnum.VEHICLE_DISPATCH_REGISTER,
    module: 'Vehicle Dispatch',
    entity: VehicleDispatch,
    numberColumn: 'vehicleDispatchNo',
    businessDate: { expr: 'rec.date', kind: 'date', source: 'dispatch.date' },
    joins: { company: 'rec.companyName', challan: 'rec.deliveryChallanNo' },
    fields: [
      ...companyFields(),
      { param: 'vehicleType', kind: 'iexact', exprs: ['rec.vehicleType'], description: 'Vehicle type (exact, case-insensitive)' },
      text('vehicleNo', ['rec.vehicleNo'], 'Vehicle number (partial)'),
      text('driverName', ['rec.driverName'], 'Driver name (partial)'),
      // The client on a dispatch is free text, not a customer record.
      text('customerName', ['rec.clientName'], 'Client name (partial)'),
      text('deliveryChallanNo', ['challan.challanNo'], 'Delivery challan number (partial)'),
      text('clientGRNNo', ['rec.clientGRNNo'], 'Client GRN number (partial)'),
      ...amountRange('rec.transportationBillAmt', 'Transportation bill amount'),
    ],
    search: ['rec.vehicleNo', 'rec.vehicleType', 'rec.driverName', 'rec.clientName', 'challan.challanNo', 'company.name'],
    sortable: standardSort('vehicleDispatchNo', 'rec.vehicleDispatchNo', { date: 'rec.date' }),
  },
  (() => {
    const base = voucherBase('rec.totalAmt');
    return {
      documentType: DocumentTypeEnum.MULTI_CASH_VOUCHER,
      module: 'Multi Cash Voucher',
      entity: CashVoucher,
      numberColumn: 'voucherNo',
      businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'multiple_cash_voucher.createdAt (no voucher date column)' },
      joins: { ...base.joins, challan: 'rec.challanNo' },
      fields: [...base.fields, text('deliveryChallanNo', ['challan.challanNo'], 'Delivery challan number (partial)')],
      search: [...base.search, 'challan.challanNo'],
      sortable: standardSort('voucherNo', 'rec.voucherNo', { totalAmt: 'rec.totalAmt' }),
    } as ModuleFilterDefinition;
  })(),
  (() => {
    const base = voucherBase('rec.totalAmt');
    return {
      documentType: DocumentTypeEnum.LABOR_PAYMENT_VOUCHER,
      module: 'Labour Payment Voucher',
      entity: LPVoucher,
      numberColumn: 'voucherNo',
      businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'labour_payment_voucher.createdAt (no voucher date column)' },
      joins: base.joins,
      fields: [...base.fields, text('products', ['rec.products'], 'Products text (partial)')],
      search: [...base.search, 'rec.products'],
      sortable: standardSort('voucherNo', 'rec.voucherNo', { totalAmt: 'rec.totalAmt', loadingDate: 'rec.loadingDate' }),
    } as ModuleFilterDefinition;
  })(),
  (() => {
    const base = voucherBase('rec.finalPayableAmt');
    return {
      documentType: DocumentTypeEnum.TRANSPORT_PAYMENT_VOUCHER,
      module: 'Transport Payment Voucher',
      entity: TPVoucher,
      numberColumn: 'voucherNo',
      businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'transport_payment_voucher.createdAt (no voucher date column)' },
      joins: base.joins,
      fields: [
        ...base.fields,
        text('vehicleNo', ['rec.vehicleNo'], 'Vehicle number (partial)'),
        text('driverName', ['rec.driverName'], 'Driver name (partial)'),
        text('dispatchLocation', ['rec.dispatchLocation'], 'Dispatch location (partial)'),
        text('destinationLocation', ['rec.destinationLocation'], 'Destination location (partial)'),
      ],
      search: [...base.search, 'rec.vehicleNo', 'rec.driverName', 'rec.dispatchLocation', 'rec.destinationLocation'],
      // Products are a many-to-many on the voucher itself.
      lineItems: { entity: TPVoucher, parentRelation: null, product: 'products' },
      sortable: standardSort('voucherNo', 'rec.voucherNo', { finalPayableAmt: 'rec.finalPayableAmt' }),
    } as ModuleFilterDefinition;
  })(),
  (() => {
    const base = voucherBase('rec.totalAmt');
    return {
      documentType: DocumentTypeEnum.PACKAGING_MATERIAL_VOUCHER,
      module: 'Packing Material Voucher',
      entity: PMPVoucher,
      numberColumn: 'voucherNo',
      businessDate: { expr: 'rec.createdAt', kind: 'timestamp', source: 'packing_material_payment.createdAt (no voucher date column)' },
      joins: base.joins,
      fields: [...base.fields, text('sellerName', ['rec.sellerName'], 'Seller name (partial)'), text('purpose', ['rec.purpose'], 'Purpose (partial)')],
      search: [...base.search, 'rec.sellerName', 'rec.purpose'],
      sortable: standardSort('voucherNo', 'rec.voucherNo', { totalAmt: 'rec.totalAmt' }),
    } as ModuleFilterDefinition;
  })(),
];

const BY_TYPE = new Map(DEFINITIONS.map((d) => [d.documentType, d]));

export function getModuleFilterDefinition(documentType: string): ModuleFilterDefinition | undefined {
  return BY_TYPE.get(documentType);
}

export function allModuleFilterDefinitions(): readonly ModuleFilterDefinition[] {
  return DEFINITIONS;
}

/** Shared helper for other query code that renders a user's full name. */
export const userFullNameExpr = personName;
