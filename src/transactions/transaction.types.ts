/**
 * Transaction tracking — shared types and constant maps
 * (docs/transaction-tracking-plan.md §3, §5, §9.2).
 *
 * A transaction is one business deal (a purchase, a stock transfer, a sale,
 * an other sale or a second sale). Its number is issued by the first
 * document of the deal and copied onto every following document.
 *
 * Pure module: no database access, safe to import from the stock primitives.
 */

// Type-only: this module must not load the entity graph (it is imported by the stock primitives).
import type { DocumentTypeEnum } from '../approvalFlow/entity/docuemnt.entity';

/** A DocumentTypeEnum value written as its literal (the enum is imported as a type only). */
const dt = (value: string) => value as DocumentTypeEnum;

export type TxnType = 'purchase' | 'transfer' | 'sale' | 'other-sale' | 'second-sale';
export type TxnStatus = 'Open' | 'Closed' | 'Cancelled';
export type TxnDocType =
  | 'rfpa' | 'deal-slip' | 'grn' | 'dispatch' | 'aqr' | 'inward-register' | 'dump-register'
  | 'return-to-vendor' | 'dc-customer' | 'dc-transfer' | 'dc-other' | 'return-by-customer'
  | 'final-invoice' | 'second-sale';
export type TxnPrefix = 'R' | 'G' | 'T' | 'S' | 'SO' | 'SS';
export type TxnPartyType = 'vendor' | 'farmer' | 'customer' | 'branch' | 'walk-in';
export type TxnLinkKind = 'transferred' | 'sold' | 'sold-other' | 'resold' | 'direct-sale';
export type TxnStepState = 'Done' | 'Current' | 'Pending' | 'Rejected' | 'Skipped';

export const TXN_TYPES: TxnType[] = ['purchase', 'transfer', 'sale', 'other-sale', 'second-sale'];
export const TXN_STATUSES: TxnStatus[] = ['Open', 'Closed', 'Cancelled'];

export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  purchase: 'Purchase',
  transfer: 'Stock Transfer',
  sale: 'Sale',
  'other-sale': 'Other Sale',
  'second-sale': 'Second Sale',
};

export interface TxnDocTypeInfo {
  /** Header table (constant, never user input). */
  table: string;
  /** Column holding the document number. */
  numberColumn: string;
  /** `documents.type` of the document's approval rows. */
  documentsType: DocumentTypeEnum;
  label: string;
}

/**
 * Every document type that carries a transaction number. The three DC kinds
 * share `delivery_challan_purchase`; the three dispatch registers share
 * `dispatch` and one approval type (`vehicle-dispatch-register`, whatever the
 * `dispatchType`).
 */
export const TXN_DOC_TYPES: Record<TxnDocType, TxnDocTypeInfo> = {
  rfpa: { table: 'rfpa', numberColumn: 'rfpaId', documentsType: dt('rfpa'), label: 'RFPA' },
  'deal-slip': { table: 'deal_slips', numberColumn: 'dealSlipNo', documentsType: dt('deal-slip'), label: 'Deal Slip' },
  grn: { table: 'grns', numberColumn: 'grnNo', documentsType: dt('grn'), label: 'GRN' },
  dispatch: { table: 'dispatch', numberColumn: 'vehicleDispatchNo', documentsType: dt('vehicle-dispatch-register'), label: 'Vehicle Dispatch' },
  aqr: { table: 'aqr', numberColumn: 'aqrNo', documentsType: dt('aqr'), label: 'AQR' },
  'inward-register': { table: 'inward_register', numberColumn: 'inwardNo', documentsType: dt('inward-register'), label: 'Inward Register' },
  'dump-register': { table: 'dump_register', numberColumn: 'dumpNo', documentsType: dt('dump-register'), label: 'Dump Register' },
  'return-to-vendor': { table: 'return_to_vendor', numberColumn: 'rtvNo', documentsType: dt('return-to-vendor'), label: 'Return To Vendor' },
  'dc-customer': { table: 'delivery_challan_purchase', numberColumn: 'challanNo', documentsType: dt('DC_TYPE_CUSTOMER'), label: 'Customer DC' },
  'dc-transfer': { table: 'delivery_challan_purchase', numberColumn: 'challanNo', documentsType: dt('DC_TYPE_STOCK_TRANSFER'), label: 'Stock Transfer DC' },
  'dc-other': { table: 'delivery_challan_purchase', numberColumn: 'challanNo', documentsType: dt('DC_TYPE_OTHER'), label: 'Other DC' },
  'return-by-customer': { table: 'return_by_customer', numberColumn: 'rbcNo', documentsType: dt('return-by-customer'), label: 'Return By Customer' },
  'final-invoice': { table: 'invoices', numberColumn: 'invoiceNo', documentsType: dt('final-invoice'), label: 'Final Invoice' },
  'second-sale': { table: 'second_sale_document', numberColumn: 'secondSaleNo', documentsType: dt('second-sale'), label: 'Second Sale' },
};

export const TXN_DOC_TYPE_LIST = Object.keys(TXN_DOC_TYPES) as TxnDocType[];

export const isTxnDocType = (value: unknown): value is TxnDocType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(TXN_DOC_TYPES, value);

/**
 * `documents.type` (also the `doc_type` of stock ledger / allocation rows) →
 * TxnDocType. Types without a transaction (vouchers, EOD, adjustment, repack)
 * are absent.
 */
export const DOCUMENT_TYPE_TO_TXN_DOC: Partial<Record<DocumentTypeEnum, TxnDocType>> = {
  'rfpa': 'rfpa',
  'deal-slip': 'deal-slip',
  'grn': 'grn',
  'vehicle-dispatch-register': 'dispatch',
  'aqr': 'aqr',
  'inward-register': 'inward-register',
  'dump-register': 'dump-register',
  'return-to-vendor': 'return-to-vendor',
  'DC_TYPE_CUSTOMER': 'dc-customer',
  'DC_TYPE_STOCK_TRANSFER': 'dc-transfer',
  'DC_TYPE_OTHER': 'dc-other',
  'return-by-customer': 'return-by-customer',
  'final-invoice': 'final-invoice',
  'second-sale': 'second-sale',
};

/** Dispatch register (`dispatch.dispatchType`) → TxnDocType: all three are `dispatch`. */
export const DISPATCH_TYPE_TO_TXN_DOC: Record<string, TxnDocType> = {
  purchase: 'dispatch',
  'stock-transfer': 'dispatch',
  sales: 'dispatch',
};

/**
 * TxnDocType of a documents type, a stock ledger `doc_type`, a dispatch type or
 * a TxnDocType itself; null when the type has no transaction.
 */
export function toTxnDocType(value: string | null | undefined): TxnDocType | null {
  if (!value) return null;
  if (isTxnDocType(value)) return value;
  const fromDocuments = DOCUMENT_TYPE_TO_TXN_DOC[value as DocumentTypeEnum];
  if (fromDocuments) return fromDocuments;
  return DISPATCH_TYPE_TO_TXN_DOC[value] ?? null;
}

/** Header table of a document type (stock ledger `doc_type`, documents type or TxnDocType); null when none. */
export function txnTableOf(value: string | null | undefined): string | null {
  const docType = toTxnDocType(value);
  return docType ? TXN_DOC_TYPES[docType].table : null;
}

/** Link kind written when a stock-out document of this type consumes a batch. */
export const CONSUME_LINK_KIND: Partial<Record<TxnDocType, TxnLinkKind>> = {
  'dc-transfer': 'transferred',
  'dc-customer': 'sold',
  'dc-other': 'sold-other',
  'second-sale': 'resold',
};

/** Prefix of a new transaction: a purchase is `R` when it starts with an RFPA, `G` when with a GRN. */
export function prefixOf(type: TxnType, originDocType: TxnDocType): TxnPrefix {
  switch (type) {
    case 'purchase':
      return originDocType === 'rfpa' ? 'R' : 'G';
    case 'transfer':
      return 'T';
    case 'sale':
      return 'S';
    case 'other-sale':
      return 'SO';
    case 'second-sale':
      return 'SS';
  }
}

/** Document types that may start each transaction type. */
export const ORIGIN_DOC_TYPES: Record<TxnType, TxnDocType[]> = {
  purchase: ['rfpa', 'grn'],
  transfer: ['dc-transfer'],
  sale: ['dc-customer'],
  'other-sale': ['dc-other'],
  'second-sale': ['second-sale'],
};

/** Step key a document belongs to inside a transaction of `type`. */
export function stepOfDoc(type: TxnType, docType: TxnDocType): string {
  switch (docType) {
    case 'rfpa':
    case 'deal-slip':
    case 'grn':
    case 'dispatch':
    case 'second-sale':
      return docType;
    case 'aqr':
    case 'inward-register':
    case 'dump-register':
    case 'return-to-vendor':
      return type === 'sale' ? 'return-receiving' : 'receiving';
    case 'dc-customer':
      return 'customer-dc';
    case 'dc-transfer':
      return 'transfer-dc';
    case 'dc-other':
      return 'other-dc';
    case 'return-by-customer':
      return 'return';
    case 'final-invoice':
      return 'invoice';
  }
}

/** Longest transaction number (`SO` / `SS` + yyMMdd + 5 digits). */
export const TXN_NO_MAX_LENGTH = 13;
export const TXN_SERIAL_WIDTH = 5;
export const TXN_TIME_ZONE = 'Asia/Kolkata';

// ─── API shapes (§9.5) ────────────────────────────────────────────────────────

export interface TxnSummary {
  productCount: number;
  totalQty: number;
  totalKg: number;
  totalValue: number;
  daysOpen: number;
}

export interface TxnOriginRef {
  docType: TxnDocType;
  id: string;
  docNo: string | null;
  documentId: string | null;
}

export interface TxnListRow {
  txnNo: string;
  type: TxnType;
  status: TxnStatus;
  stage: string;
  stageLabel: string;
  openedAt: string;
  closedAt: string | null;
  cancelledAt: string | null;
  daysOpen: number;
  companyName: string | null;
  locationName: string | null;
  toLocationName: string | null;
  partyName: string | null;
  productCount: number;
  totalQty: number;
  totalKg: number;
  totalValue: number;
  origin: TxnOriginRef;
}

export interface TxnStepDoc {
  docType: TxnDocType;
  id: string;
  docNo: string | null;
  documentId: string | null;
  status: string | null;
}

export interface TxnStep {
  key: string;
  label: string;
  state: TxnStepState;
  side?: boolean;
  docs: TxnStepDoc[];
}

export interface TxnDocumentRow {
  docType: TxnDocType;
  docTypeLabel: string;
  id: string;
  docNo: string | null;
  documentId: string | null;
  status: string | null;
  step: string;
  createdAt: string;
  createdBy: string | null;
}

export interface TxnRelatedRow {
  kind: 'voucher' | 'grn-payment' | 'invoice-payment' | 'delivery-confirmation';
  label: string;
  no: string | null;
  amount: number | null;
  date: string | null;
  status: string | null;
  documentId: string | null;
}

export interface TxnQuantityRow {
  productId: string;
  productName: string | null;
  variantName: string | null;
  uomName: string | null;
  values: Record<string, number | null>;
}

export interface TxnLinkRow {
  direction: 'from' | 'to';
  kind: string;
  txnNo: string;
  type: TxnType;
  batchNo: string | null;
  qty: number;
  netKg: number;
}

export interface TxnDetail extends TxnListRow {
  steps: TxnStep[];
  documents: TxnDocumentRow[];
  related: TxnRelatedRow[];
  quantityColumns: { key: string; label: string }[];
  quantities: TxnQuantityRow[];
  money: { label: string; amount: number }[];
  links: TxnLinkRow[];
}

export interface TxnLedgerRow {
  postedAt: string;
  movementType: string;
  docType: string;
  docNo: string | null;
  batchNo: string;
  locationName: string | null;
  productName: string | null;
  variantName: string | null;
  uomName: string | null;
  qtyIn: number;
  qtyOut: number;
  netKgIn: number;
  netKgOut: number;
  value: number;
}

export interface TxnSearchHit {
  txnNo: string;
  type: TxnType;
  status: TxnStatus;
  matchedBy: 'transaction' | 'document' | 'batch';
  matchedNo: string;
}

export interface TxnDashboardSummary {
  byType: { type: TxnType; open: number; closed: number; cancelled: number }[];
  byStage: { type: TxnType; stage: string; stageLabel: string; count: number; over7Days: number }[];
}
