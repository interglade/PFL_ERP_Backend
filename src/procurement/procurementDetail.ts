/**
 * The details an RFPA and its Deal Slip share (the Deal Slip carries a copy of the RFPA's), in the one
 * response shape both documents use. `view` resolves relations to display names; `form` returns ids for
 * the edit form's controls.
 */

/** Header columns shared by `rfpa` and `deal_slips`. */
type ProcurementSource = {
  source?: string | null;
  companyName?: any;
  purchaseLocation?: any;
  purchaseForSalesLocation?: any;
  otherPurchaseLoc?: string | null;
  otherPurchaseForSalesLoc?: string | null;
  deliveryReceivingPerson?: string | null;
  packingInstruction?: string | null;
  selectedVendor?: any;
  selectedFarmer?: any;
  paymentInfo?: any;
};

/** Product line columns shared by `rfpa_product` and `deal_slip_product`. */
type ProcurementLine = {
  id?: string;
  productName?: any;
  variant?: any;
  uom?: any;
  grade?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  purchaseDate?: any;
  expectedHarvestDate?: any;
  dispatchDate?: any;
  deliveryDate?: any;
};

export type DetailMode = 'view' | 'form';

/** Relations the header formatter reads (prefix-free: valid for both RFPA and DealSlip). */
export const PROCUREMENT_HEADER_RELATIONS = [
  'companyName',
  'purchaseLocation',
  'purchaseForSalesLocation',
  'selectedVendor',
  'selectedVendor.officeAddress',
  'selectedVendor.vendorSaleInfo',
  'selectedFarmer',
  'selectedFarmer.residensialAddress',
  'selectedFarmer.farmAddress',
  'paymentInfo',
];

/** Relations the line formatter reads, under the document's product relation (e.g. 'rfpaProducts'). */
export const procurementLineRelations = (productsRelation: string): string[] => [
  productsRelation,
  `${productsRelation}.productName`,
  `${productsRelation}.variant`,
  `${productsRelation}.uom`,
];

const idOf = (value: any): string | null => value?.id ?? null;

function vendorInfo(vendor: any) {
  if (!vendor) return null;
  return {
    companyName: vendor.companyName || null,
    vendorCode: vendor.vendorCode || null,
    contactPersonName: `${vendor.vendorSaleInfo?.contactFName ?? ''} ${vendor.vendorSaleInfo?.contactLName ?? ''}`.trim() || null,
    officeContactNo: vendor.officeContactNo || null,
    officeEmail: vendor.officeEmail || null,
    officeAddress: vendor.officeAddress || null,
  };
}

function farmerInfo(farmer: any) {
  if (!farmer) return null;
  return {
    fullName: `${farmer.farmerfName ?? ''} ${farmer.farmermName ?? ''} ${farmer.farmerlName ?? ''}`.trim(),
    primaryMobileNo: farmer.primaryMobileNo || null,
    email: farmer.email || null,
    farmerCode: farmer.farmerCode || null,
    residensialAddress: farmer.residensialAddress || null,
    farmAddress: farmer.farmAddress || null,
  };
}

function paymentInfo(payment: any) {
  if (!payment) return null;
  return {
    paymentMode: payment.paymentMode ?? null,
    paymentDate: payment.paymentDate ?? null,
    advancePaidAmt: payment.advancePaidAmt ?? null,
    paymentTerms: payment.paymentTerms ?? null,
    dueDate: payment.dueDate ?? null,
    creditPeriod: payment.creditPeriod ?? null,
    validityOfQuote: payment.validityOfQuote ?? null,
  };
}

/** Header, party and payment details, identical for an RFPA and its Deal Slip. */
export function formatProcurementHeader(doc: ProcurementSource, mode: DetailMode): Record<string, any> {
  const isVendor = doc.source === 'vendor';
  const view = mode === 'view';
  return {
    source: doc.source ?? null,
    companyName: view ? doc.companyName?.name ?? null : idOf(doc.companyName),
    purchaseLocation: view ? doc.purchaseLocation?.name ?? null : idOf(doc.purchaseLocation),
    purchaseForSalesLocation: view ? doc.purchaseForSalesLocation?.name ?? null : idOf(doc.purchaseForSalesLocation),
    otherPurchaseLoc: doc.otherPurchaseLoc ?? null,
    otherPurchaseForSalesLoc: doc.otherPurchaseForSalesLoc ?? null,
    deliveryReceivingPerson: doc.deliveryReceivingPerson ?? null,
    packingInstruction: doc.packingInstruction ?? null,
    selectedParty: view
      ? (isVendor ? vendorInfo(doc.selectedVendor) : farmerInfo(doc.selectedFarmer))
      : (isVendor ? idOf(doc.selectedVendor) : idOf(doc.selectedFarmer)),
    paymentInfo: paymentInfo(doc.paymentInfo),
  };
}

/** One product line, identical for RFPA and Deal Slip lines. */
export function formatProcurementLine(line: ProcurementLine, mode: DetailMode): Record<string, any> {
  const view = mode === 'view';
  return {
    id: line.id ?? null,
    productName: view ? line.productName?.name ?? null : idOf(line.productName),
    variant: view ? line.variant?.variantName ?? null : idOf(line.variant),
    uom: view ? line.uom?.unit ?? null : idOf(line.uom),
    grade: line.grade ?? null,
    quantity: line.quantity ?? null,
    unitPrice: line.unitPrice ?? null,
    amount: line.amount ?? null,
    purchaseDate: line.purchaseDate ?? null,
    expectedHarvestDate: line.expectedHarvestDate ?? null,
    dispatchDate: line.dispatchDate ?? null,
    deliveryDate: line.deliveryDate ?? null,
  };
}
