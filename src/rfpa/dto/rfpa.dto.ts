

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

import { Department, Source } from "../../utils/status.enum";

/** Payment info — used in create, update, view and update-form responses. */
export interface RfpaPaymentInfoDto {
  paymentMode?: string | null;
  paymentDate?: string | Date | null;
  advancePaidAmt?: number | null;
  paymentTerms?: number | null;
  dueDate?: string | Date | null;
  creditPeriod?: number | null;
  validityOfQuote?: string | null;
}

/** Product line — used in create/update requests. */
export interface RfpaProductInputDto {
  /** Product entity ID */
  productName?: string | { id: string } | null;
  /** Variant entity ID */
  variant?: string | { id: string } | null;
  grade?: string | null;
  quantity: number;
  /** UOM entity ID */
  uom?: string | { id: string } | null;
  unitPrice: number;
  count?: string | null;
  size?: string | null;
  origin?: string | null;
  variety?: string | null;
  amount: number;
  purchaseDate?: string | Date | null;
  expectedHarvestDate?: string | Date | null;
  dispatchDate?: string | Date | null;
  deliveryDate?: string | Date | null;
}

/** Product line — view response (names resolved). */
export interface RfpaProductViewDto {
  productName: string | null;
  variant: string | null;
  grade: string | null;
  quantity: number;
  uom: string | null;
  unitPrice: number;
  amount: number;
  purchaseDate: string | Date | null;
  expectedHarvestDate: string | Date | null;
  dispatchDate: string | Date | null;
  deliveryDate: string | Date | null;
}

/** Product line — update-form response (IDs for pre-selection). */
export interface RfpaProductUpdateDto {
  productName: string | null;
  variant: string | null;
  grade: string | null;
  quantity: number;
  uom: string | null;
  unitPrice: number;
  amount: number;
  purchaseDate: string | Date | null;
  expectedHarvestDate: string | Date | null;
  dispatchDate: string | Date | null;
  deliveryDate: string | Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create RFPA DTO  (POST /rfpa)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateRfpaDto {
  /** Resolved from source: vendor ID or farmer ID */
  selectedParty?: string | null;
  selectedVendor?: string | { id: string } | null;
  selectedFarmer?: string | { id: string } | null;
  source: Source;

  /** Injected from res.locals by controller */
  createdBy?: string;
  requestingDepartment?: Department | null;

  companyName?: string | { id: string } | null;
  purchaseLocation?: string | { id: string } | null;
  purchaseForSalesLocation?: string | { id: string } | null;
  otherPurchaseLoc?: string | null;
  otherPurchaseForSalesLoc?: string | null;

  deliveryReceivingPerson?: string | null;
  packingInstruction?: string | null;
  specialReq?: string | null;
  remark?: string | null;

  paymentInfo: RfpaPaymentInfoDto;
  rfpaProducts?: RfpaProductInputDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Update RFPA DTO  (PATCH /rfpa/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateRfpaDto extends Partial<CreateRfpaDto> {
  /** Injected by controller */
  requestedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RFPA list item DTO  (GET /rfpa — getAllRfpa)
// ─────────────────────────────────────────────────────────────────────────────

export interface RfpaListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  rfpaId: string | null;
  remark: string | null;
  source: Source | null;
  deliveryReceivingPerson: string | null;
  packingInstruction: string | null;
  paymentInfo: RfpaPaymentInfoDto | null;
  companyName: string | null;
  purchaseLocation: string | null;
  purchaseForSalesLocation: string | null;
}

export interface RfpaListResponseDto {
  data: RfpaListItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RFPA view DTO  (GET /rfpa/:id/view — getRFQByIdByView)
// Relations resolved to display names/strings.
// ─────────────────────────────────────────────────────────────────────────────

export interface RfpaSelectedPartyViewDto {
  id: string;
  vendorCode?: string | null;
  companyName?: string | null;
  farmerCode?: string | null;
  name?: string | null;
}

export interface RfpaViewResponseDto {
  rfpa: string;
  companyName: string | null;
  createdDate: string | null;
  createdTime: string | null;
  requestingDepartment: Department | null;
  purchaseLocation: string | null;
  purchaseForSalesLocation: string | null;
  otherPurchaseLoc: string | null;
  otherPurchaseForSalesLoc: string | null;
  deliveryReceivingPerson: string | null;
  remark: string | null;
  packingInstruction: string | null;
  specialReq: string | null;
  source: Source | null;
  selectedParty: RfpaSelectedPartyViewDto | null;
  paymentInfo: RfpaPaymentInfoDto | null;
  rfpaProducts: RfpaProductViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RFPA update form DTO  (GET /rfpa/:id/update — getRFQByIdForUpdate)
// Relations returned as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface RfpaUpdateFormDto {
  rfpaId: string;
  companyName: string | null;
  createdDate: string | null;
  createdTime: string | null;
  requestingDepartment: Department | null;
  purchaseLocation: string | null;
  purchaseForSalesLocation: string | null;
  otherPurchaseLoc: string | null;
  otherPurchaseForSalesLoc: string | null;
  deliveryReceivingPerson: string | null;
  remark: string | null;
  packingInstruction: string | null;
  specialReq: string | null;
  source: Source | null;
  /** ID of the selected vendor or farmer */
  selectedParty: string | null;
  paymentInfo: RfpaPaymentInfoDto | null;
  rfpaProducts: RfpaProductUpdateDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RFPA numbers DTO  (GET /rfpa/rfpanumbers/getAllRfpaNo)
// ─────────────────────────────────────────────────────────────────────────────

export interface RfpaNumberItemDto {
  id: string;
  rfpaId: string;
  documentId: string | null;
}

export interface RfpaNumbersResponseDto {
  data: RfpaNumberItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// RFPA document view DTO  (GET /rfpa/view/:docid — getRfpaByIdForView)
// Returned when viewing via document approval flow (includes approval metadata).
// ─────────────────────────────────────────────────────────────────────────────

export interface RfpaVendorPartyDto {
  companyName: string | null;
  vendorCode: string | null;
  contactPersonName: string | null;
  officeContactNo: string | null;
  officeEmail: string | null;
  officeAddress: any | null;
}

export interface RfpaFarmerPartyDto {
  fullName: string;
  primaryMobileNo: string | null;
  email: string | null;
  farmerCode: string | null;
  residensialAddress: any | null;
  farmAddress: any | null;
}

export interface RfpaDocumentViewProductDto {
  productName: string | null;
  variant: string | null;
  grade: string | null;
  quantity: number | null;
  uom: string | null;
  unitPrice: number | null;
  amount: number | null;
  purchaseDate: string | Date | null;
  expectedHarvestDate: string | Date | null;
  dispatchDate: string | Date | null;
  deliveryDate: string | Date | null;
}

export interface RfpaDocumentViewResponseDto {
  // ── Document metadata ────────────────────────────────────────────────────
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: any | null;
  createdDate: string | null;
  createdTime: string | null;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;

  // ── RFPA fields ───────────────────────────────────────────────────────────
  rfpaId: string | null;
  remark: string | null;
  specialReq: string | null;
  requestingDepartment: Department | null;
  otherPurchaseLoc: string | null;
  otherPurchaseForSalesLoc: string | null;
  source: Source | null;
  deliveryReceivingPerson: string | null;
  packingInstruction: string | null;

  /** Vendor or farmer detail depending on source */
  selectedParty: RfpaVendorPartyDto | RfpaFarmerPartyDto | null;

  paymentInfo: RfpaPaymentInfoDto | null;
  rfpaProducts: RfpaDocumentViewProductDto[];

  companyName: string | null;
  purchaseLocation: string | null;
  purchaseForSalesLocation: string | null;
}
// ─────────────────────────────────────────────────────────────────────────────

export interface RfpaFilterQueryDto {
  page?: number;
  limit?: number;
  [key: string]: any;
}

export interface RfpaFilterResponseDto {
  success: boolean;
  data: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recycle bin DTO  (GET /rfpa/recyclebin)
// ─────────────────────────────────────────────────────────────────────────────

export interface RfpaRecycleBinResponseDto {
  data: RfpaListItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /rfpa/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteRfpaDto {
  ids: string[];
}

export interface BulkDeleteRfpaResultDto {
  message: string;
}
