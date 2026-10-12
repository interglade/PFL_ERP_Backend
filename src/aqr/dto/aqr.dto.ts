// ─── Relation ref (matches TypeORM DeepPartial shape) ────────────────────────

import { Source } from "../../utils/status.enum";
import { AqrFor } from "../entity/aqr.entity";
import { ReceivingSourceType } from "../../receiving/receiving.types";

export interface RelationRef {
  id: string;
}

// ─── Parameter DTOs ───────────────────────────────────────────────────────────

export class AqrParameterCreateDto {
  qualityParameterId: string;
  qualityParameterName: string;
  qualityParameterType: string;
  quantity?: number | null;
  percentage?: number | null;
}

export class AqrParameterUpdateDto {
  id?: string;
  qualityParameterId?: string;
  qualityParameterName?: string;
  qualityParameterType?: string;
  quantity?: number | null;
  percentage?: number | null;
}

// ─── Product line DTOs (docs/receiving-links-plan.md §2.4) ───────────────────

/** One product of the source with its arrived / sampled kg and quality parameters. */
export class AqrProductLineCreateDto {
  /** { id: productId } */
  product: RelationRef;
  /** { id: variantId } — optional */
  variant?: RelationRef | null;
  /** { id: uomId } — optional */
  uom?: RelationRef | null;
  arrivedQty: number;
  samplingQty: number;
  totalQty?: number | null;
  totalpercent?: number | null;
  remark?: string | null;
  parameters: AqrParameterCreateDto[];
}

/** Same as create; `id` matches an existing line, otherwise product + variant does. */
export class AqrProductLineUpdateDto {
  id?: string | null;
  product: RelationRef;
  variant?: RelationRef | null;
  uom?: RelationRef | null;
  arrivedQty: number;
  samplingQty: number;
  totalQty?: number | null;
  totalpercent?: number | null;
  remark?: string | null;
  parameters: AqrParameterUpdateDto[];
}

// ─── Create DTO ───────────────────────────────────────────────────────────────

export class CreateAqrDto {
  aqrFor: AqrFor;

  /** { id: companyId } — defaulted from the source when missing */
  companyName?: RelationRef | null;

  /** { id: branchId } — defaulted from the source when missing */
  location?: RelationRef | null;

  source?: Source | null;

  /**
   * { id: vendorId }  when source === Source.VENDOR
   * { id: farmerId }  when source === Source.FARMER
   * Overridden by the party of the source GRN when it has one.
   */
  selectedParty?: RelationRef | null;

  /** { id: grnId } — required when aqrFor === purchase */
  grnNo?: RelationRef | null;

  /** { id: deliveryChallanId } — required when aqrFor === transfer */
  deliveryChallanNo?: RelationRef | null;

  /** { id: rbcId } — required when aqrFor === returned-by-customer */
  rbcNo?: RelationRef | null;

  /** { id: branchId } — optional, defaulted from a Transfer DC */
  fromLocation?: RelationRef | null;

  /** One line per product of the source. */
  products: AqrProductLineCreateDto[];

  // Legacy single-product fields; ignored when `products` is present.
  /** @deprecated use `products` */
  product?: RelationRef | null;
  /** @deprecated use `products` */
  variant?: RelationRef | null;
  /** @deprecated use `products` */
  arrivedQty?: string | number | null;
  /** @deprecated use `products` */
  samplingQty?: string | number | null;
  /** @deprecated use `products[].parameters` */
  parameters?: AqrParameterCreateDto[];

  arrivalDate?: string | null;

  /** { id: userId } — optional */
  purchaseBy?: RelationRef | null;
  /** { id: userId } — optional */
  receivedBy?: RelationRef | null;
  /** { id: userId } — optional */
  qcCheckBy?: RelationRef | null;
  /** { id: userId } — optional */
  verifiedBy?: RelationRef | null;

  totalQty?: number | null;
  totalpercent?: number | null;
  remark?: string | null;

  // Injected by controller — do not send from client
  requestedBy?: string;
}

// ─── Update DTO ───────────────────────────────────────────────────────────────

export class UpdateAqrDto {
  aqrFor?: AqrFor;

  /** { id: companyId } */
  companyName?: RelationRef | null;

  /** { id: branchId } */
  location?: RelationRef | null;

  source?: Source | null;

  /** { id: vendorId } or { id: farmerId } */
  selectedParty?: RelationRef | null;

  /** { id: grnId } */
  grnNo?: RelationRef | null;

  /** { id: deliveryChallanId } */
  deliveryChallanNo?: RelationRef | null;

  /** { id: rbcId } */
  rbcNo?: RelationRef | null;

  /** { id: branchId } */
  fromLocation?: RelationRef | null;

  /** The full set of lines (the product set is fixed by the source). */
  products?: AqrProductLineUpdateDto[];

  // Legacy single-product fields; ignored when `products` is present.
  /** @deprecated use `products` */
  product?: RelationRef | null;
  /** @deprecated use `products` */
  variant?: RelationRef | null;
  /** @deprecated use `products` */
  arrivedQty?: string | number | null;
  /** @deprecated use `products` */
  samplingQty?: string | number | null;
  /** @deprecated use `products[].parameters` */
  parameters?: AqrParameterUpdateDto[];

  arrivalDate?: string | null;

  /** { id: userId } */
  purchaseBy?: RelationRef | null;
  /** { id: userId } */
  receivedBy?: RelationRef | null;
  /** { id: userId } */
  qcCheckBy?: RelationRef | null;
  /** { id: userId } */
  verifiedBy?: RelationRef | null;

  totalQty?: number | null;
  totalpercent?: number | null;
  remark?: string | null;
}

// ─── Query / GetAll DTO ───────────────────────────────────────────────────────

export class GetAllAqrsQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;        // format: "field:ASC" or "field:DESC"
  supplierName?: string;
  arrivalDate?: string; // "YYYY-MM-DD"
}

// ─── Response DTOs ────────────────────────────────────────────────────────────

export class AqrParameterResponseDto {
  id: string;
  qualityParameterId: string;
  qualityParameterName: string;
  qualityParameterType: string;
  quantity: number | null;
  percentage: number | null;
}

/** Source references as returned by the view / update-view endpoints. */
export class AqrGrnRefDto {
  id: string;
  grnNo: string | null;
}

export class AqrChallanRefDto {
  id: string;
  challanNo: string | null;
}

export class AqrRbcRefDto {
  id: string;
  rbcNo: string | null;
}

/** One product line as returned by the view / update-view endpoints. */
export class AqrProductLineResponseDto {
  /** Line id; null on a line synthesised from a legacy header-only AQR. */
  id: string | null;
  product: { id: string; name: string | null; productCode?: string | null; packingType?: string | null } | null;
  variant: { id: string; variantName: string | null } | null;
  uom: { id: string; name: string | null; unit: string | null } | null;
  /** Net kg of this product on the source when the AQR was made; null on legacy rows. */
  receivedQty: number | null;
  arrivedQty: number | null;
  samplingQty: number | null;
  totalQty: number | null;
  totalpercent: number | null;
  remark: string | null;
  parameters: AqrParameterResponseDto[];
}

// ─── Nested DTOs for getAQRByIdForView ───────────────────────────────────────

export class AddressDto {
  id: string | null;
  address1: string | null;
  address2: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export class VendorPartyDto {
  id: string | null;
  companyName: string | null;
  vendorCode: string | null;
  officeContactNo: string | null;
  officeEmail: string | null;
  officeAddress: AddressDto | null;
  contactPersonName: string | null;
}

export class FarmerPartyDto {
  id: string | null;
  fullName: string | null;
  farmerCode: string | null;
  primaryMobileNo: string | null;
  email: string | null;
  residensialAddress: AddressDto | null;
  farmAddress: AddressDto | null;
}

/** The customer of a Return By Customer source (read through the RBC). */
export class CustomerPartyDto {
  id: string | null;
  organisationName: string | null;
  customerCode: string | null;
}

// ─── Get AQR By ID For View Response DTO ─────────────────────────────────────

export class GetAqrByIdForViewResponseDto {
  // Document fields
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate?: string | null | Date;
  createdTime?: string | null | Date;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;

  // AQR fields
  id: string;
  aqrNo: string | null;
  aqrFor: AqrFor | null;
  companyName: string | null;     // company id
  location: string | null;        // branch name
  source: Source | null;

  /**
   * VendorPartyDto when source === 'vendor'
   * FarmerPartyDto when source === 'farmer'
   * null if no party linked
   */
  selectedParty: VendorPartyDto | FarmerPartyDto | null;
  /** Customer of the RBC source; null for purchase / transfer. */
  customer: CustomerPartyDto | null;

  // Source references
  sourceType: ReceivingSourceType | null;
  sourceNo: string | null;
  grnNo: AqrGrnRefDto | null;
  deliveryChallanNo: AqrChallanRefDto | null;
  rbcNo: AqrRbcRefDto | null;

  fromLocation: string | null;
  arrivalDate: Date | string | null;
  remark: string | null;
  purchaseBy: string | null;
  receivedBy: string | null;
  qcCheckBy: string | null;
  verifiedBy: string | null;

  /** One line per product; a legacy AQR gets one line synthesised from its header. */
  products: AqrProductLineResponseDto[];
  productCount: number;

  // Legacy header columns, kept for old consumers (first line on new rows).
  product: string | null;
  productCode: string | null;
  packingType: string | null;
  variant: string | null;
  arrivedQty: string | null;
  samplingQty: string | null;
  totalQty: number | null;
  totalpercent: number | null;
  parameters: AqrParameterResponseDto[];
}

/** One row in the GET /aqr paginated list */
export class AqrListItemDto {
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate?: string | null | Date;
  createdTime?: string | null | Date;
  id: string;
  aqrFor: AqrFor | null;
  aqrNo: string | null;
  companyName: string | null;
  location: string | null;
  source: Source | null;
  selectedParty: string | null;
  sourceType: ReceivingSourceType | null;
  sourceNo: string | null;
  grnNo: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;
  fromLocation: string | null;
  productCount: number;
  /** Legacy header product, or the first line's product on new rows. */
  product: string | null;
  variant: string | null;
  arrivalDate: string | null;   // raw value from DB, not a Date object
  arrivedQty: string | null;    // formatted as .toFixed(2); sum of the lines on new rows
  samplingQty: string | null;   // formatted as .toFixed(2); sum of the lines on new rows
  totalQty: string | null;      // formatted as .toFixed(2)
  totalpercent: number | null;
  remark: string | null;
  purchaseBy: string | null;
  receivedBy: string | null;
  qcCheckBy: string | null;
  verifiedBy: string | null;
}

export class GetAllAqrsResponseDto {
  status: "success";
  data: AqrListItemDto[];
  allRecords: number;
  totalPages: number;
  page: number;
}

// ─── Get AQR For Update Response DTO ─────────────────────────────────────────

export class GetAqrForUpdateResponseDto {
  id: string;
  aqrNo: string | null;
  aqrFor: AqrFor | null;

  // All relations returned as plain IDs for edit form dropdowns
  companyName: string | null;
  location: string | null;
  source: Source | null;
  selectedParty: string | null;     // vendor id or farmer id depending on source
  fromLocation: string | null;

  // Source references
  sourceType: ReceivingSourceType | null;
  sourceNo: string | null;
  grnNo: AqrGrnRefDto | null;
  deliveryChallanNo: AqrChallanRefDto | null;
  rbcNo: AqrRbcRefDto | null;

  arrivalDate: Date | string | null;

  purchaseBy: string | null;        // user id
  receivedBy: string | null;        // user id
  qcCheckBy: string | null;         // user id
  verifiedBy: string | null;        // user id

  remark: string | null;
  createdDate?: string | null | Date;
  createdTime?: string | null | Date;

  /** One line per product; a legacy AQR gets one line synthesised from its header. */
  products: AqrProductLineResponseDto[];

  // Legacy header columns, kept for old consumers (first line on new rows).
  product: string | null;
  variant: string | null;
  arrivedQty: string | null;
  samplingQty: string | null;
  totalQty: number | null;
  totalpercent: number | null;
  parameters: AqrParameterResponseDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete result DTOs
// ─────────────────────────────────────────────────────────────────────────────

/** Returned by deleteAqr service method */
export interface DeleteAqrResultDto {
  aqrNo: string;
}

/** Item in the success array from deleteMultipleAqrs */
export interface DeletedAqrItemDto {
  id: string;
  aqrNo: string;
}

/** Returned by deleteMultipleAqrs service method */
export interface BulkDeleteAqrResultDto {
  success: DeletedAqrItemDto[];
  failed: { id: string; reason: string }[];
  message: string;
}
