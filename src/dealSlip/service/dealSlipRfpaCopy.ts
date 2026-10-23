import { EntityManager } from 'typeorm';
import { RFPA } from '../../rfpa/entity/rfpa.entity';
import { PaymentInfoForRFPA } from '../../rfpa/entity/rfpaPayementInfo.entity';
import { DealSlip } from '../entity/dealSlip.entity';
import { DealSlipProduct } from '../entity/dealSlipProduct.entity';

/**
 * Relations an RFPA must be loaded with before its details can be copied into a Deal Slip.
 * Shared by the auto-create service and the one-time backfill script.
 */
export const RFPA_COPY_RELATIONS = [
  'createdBy',
  'companyName',
  'purchaseLocation',
  'purchaseForSalesLocation',
  'selectedVendor',
  'selectedFarmer',
  'paymentInfo',
  'rfpaProducts',
  'rfpaProducts.productName',
  'rfpaProducts.variant',
  'rfpaProducts.uom',
];

/** The RFPA header fields a Deal Slip carries a copy of (payment info is copied separately). */
export function dealSlipHeaderFromRfpa(rfpa: RFPA): Partial<DealSlip> {
  return {
    requestingDepartment: rfpa.requestingDepartment,
    companyName: rfpa.companyName,
    purchaseLocation: rfpa.purchaseLocation,
    purchaseForSalesLocation: rfpa.purchaseForSalesLocation,
    otherPurchaseLoc: rfpa.otherPurchaseLoc,
    otherPurchaseForSalesLoc: rfpa.otherPurchaseForSalesLoc,
    deliveryReceivingPerson: rfpa.deliveryReceivingPerson,
    packingInstruction: rfpa.packingInstruction,
    selectedVendor: rfpa.selectedVendor,
    selectedFarmer: rfpa.selectedFarmer,
    source: rfpa.source,
  };
}

/** Inserts a new payment info row with the same values as the RFPA's. */
export async function copyRfpaPaymentInfo(manager: EntityManager, rfpa: RFPA): Promise<PaymentInfoForRFPA | null> {
  const source = rfpa.paymentInfo;
  if (!source) return null;

  const copy = manager.create(PaymentInfoForRFPA, {
    paymentMode: source.paymentMode,
    paymentDate: source.paymentDate,
    advancePaidAmt: source.advancePaidAmt,
    paymentTerms: source.paymentTerms,
    dueDate: source.dueDate,
    creditPeriod: source.creditPeriod,
    validityOfQuote: source.validityOfQuote,
  });
  return manager.save(copy);
}

/** Inserts one deal slip product per RFPA line, remembering which RFPA line it came from. */
export async function copyRfpaProducts(manager: EntityManager, dealSlip: DealSlip, rfpa: RFPA): Promise<DealSlipProduct[]> {
  const lines = rfpa.rfpaProducts ?? [];
  if (!lines.length) return [];

  const products = lines.map((line) =>
    manager.create(DealSlipProduct, {
      dealSlip,
      rfpaProduct: line,
      productName: line.productName,
      variant: line.variant,
      grade: line.grade,
      quantity: line.quantity,
      uom: line.uom,
      unitPrice: line.unitPrice,
      count: line.count,
      size: line.size,
      origin: line.origin,
      variety: line.variety,
      amount: line.amount,
      purchaseDate: line.purchaseDate,
      expectedHarvestDate: line.expectedHarvestDate,
      dispatchDate: line.dispatchDate,
      deliveryDate: line.deliveryDate,
    }),
  );
  return manager.save(products);
}
