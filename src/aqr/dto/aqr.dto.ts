

// ─── Relation ref (matches TypeORM DeepPartial shape) ────────────────────────

import { Source } from "../../utils/status.enum";
import { AqrFor } from "../entity/aqr.entity";

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

// ─── Create DTO ───────────────────────────────────────────────────────────────

export class CreateAqrDto {
  aqrFor: AqrFor;

  /** { id: companyId } */
  companyName: RelationRef;

  /** { id: branchId } */
  location: RelationRef;

  source: Source;

  /**
   * { id: vendorId }  when source === Source.VENDOR
   * { id: farmerId }  when source === Source.FARMER
   * The service maps this to selectedVendor / selectedFarmer then removes it.
   */
  selectedParty: RelationRef;

  /** { id: deliveryChallanId } — optional */
  deliveryChallanNo?: RelationRef | null;

  /** { id: branchId } — optional */
  fromLocation?: RelationRef | null;

  /** { id: productId } */
  product: RelationRef;

  /** { id: variantId } — optional */
  variant?: RelationRef | null;

  arrivalDate?: string | null;
  arrivedQty?: string | null;
  samplingQty?: string | null;

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

  parameters?: AqrParameterCreateDto[];

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

  source?: Source;

  /**
   * { id: vendorId } or { id: farmerId }
   */
  selectedParty?: RelationRef | null;

  /** { id: deliveryChallanId } */
  deliveryChallanNo?: RelationRef | null;

  /** { id: branchId } */
  fromLocation?: RelationRef | null;

  /** { id: productId } */
  product?: RelationRef | null;

  /** { id: variantId } */
  variant?: RelationRef | null;

  arrivalDate?: string | null;
  arrivedQty?: string | null;
  samplingQty?: string | null;

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

  parameters?: AqrParameterUpdateDto[];
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

/** Returned by GET /aqr/:id — IDs only for relations (edit form) */
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

  deliveryChallanNo: string | null;
  fromLocation: string | null;
  product: string | null;
  productCode: string | null;
  packingType: string | null;
  variant: string | null;
  arrivalDate: Date | null;
  arrivedQty: string | null;
  samplingQty: string | null;
  totalQty: number | null;
  totalpercent: number | null;
  remark: string | null;
  purchaseBy: string | null;
  receivedBy: string | null;
  qcCheckBy: string | null;
  verifiedBy: string | null;
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
  deliveryChallanNo: string | null;
  fromLocation: string | null;
  product: string | null;
  variant: string | null;
  arrivalDate: string | null;   // raw value from DB, not a Date object
  arrivedQty: string | null;    // formatted as .toFixed(2)
  samplingQty: string | null;   // formatted as .toFixed(2)
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
  aqrFor: AqrFor | null;

  // All relations returned as plain IDs for edit form dropdowns
  companyName: string | null;
  location: string | null;
  source: Source | null;
  selectedParty: string | null;     // vendor id or farmer id depending on source
  deliveryChallanNo: string | null;
  fromLocation: string | null;
  product: string | null;
  variant: string | null;

  arrivalDate: Date | null;       // ISO "YYYY-MM-DD" (converted from DB format)
  arrivedQty: string | null;
  samplingQty: string | null;

  purchaseBy: string | null;        // user id
  receivedBy: string | null;        // user id
  qcCheckBy: string | null;         // user id
  verifiedBy: string | null;        // user id

  totalQty: number | null;
  totalpercent: number | null;
  remark: string | null;
  createdDate?: string | null | Date;
  createdTime?: string | null | Date;
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
