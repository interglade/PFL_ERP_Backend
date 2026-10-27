import { Status } from "../../utils/status.enum";

;

// ─────────────────────────────────────────────────────────────────────────────
// Update Deal Slip DTO  (PATCH /dealSlip/:id)
// Only these can change (rules in dealSlipEdit.ts); anything else is rejected with 400. Saving a
// Draft submits it for approval, so lotNo and loadingLocation are required.
// ─────────────────────────────────────────────────────────────────────────────

/** An existing product line (copied from the RFPA); product, variant and grade cannot change. */
export interface UpdateDealSlipProductDto {
  /** deal_slip_product id (lines cannot be added or removed) */
  id: string;
  /** uom id */
  uom?: string | null;
  /** whole number > 0 */
  quantity?: number;
  /** > 0 */
  unitPrice?: number;
  purchaseDate?: string | null;
  dispatchDate?: string | null;
  deliveryDate?: string | null;
  /** required when the slip's source is farmer */
  expectedHarvestDate?: string | null;
  // `amount` is not accepted: the server recomputes it as quantity x unitPrice.
}

export interface UpdateDealSlipDto {
  lotNo?: string;
  loadingLocation?: string;
  specialRequest?: string;
  remark?: string | null;
  dealSlipProducts?: UpdateDealSlipProductDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal Slip detail DTO  (GET /dealSlip/:id — findDealSlipById)
// Returns RFPA as ID.
// ─────────────────────────────────────────────────────────────────────────────

export interface DealSlipDetailDto {
  id: string;
  lotNo: string;
  approvalNote: string | null;
  loadingLocation: string;
  remark: string | null;
  specialRequest: string;
  approvalStatus: Status;
  createdDate: string | null;
  createdTime: string | null;
  dealSlipNo: string | null;
  /** RFPA entity ID */
  rfpa: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal Slip view DTO  (GET /dealSlip/:id/view — findDealSlipByIdforView)
// Returns RFPA as rfpaId string for display.
// ─────────────────────────────────────────────────────────────────────────────

export type DealSlipViewDto = DealSlipDetailDto;

// ─────────────────────────────────────────────────────────────────────────────
// Deal Slip update form DTO  (GET /dealSlip/:id/update — findDealSlipByIdforUpdate)
// The RFPA update-form shape (relations as ids, shared formatter) plus the slip's own fields.
// Also the GRN form's pre-fill source.
// ─────────────────────────────────────────────────────────────────────────────

export interface DealSlipUpdateFormProductDto {
  id: string;
  /** product / variant / uom ids */
  productName: string | null;
  variant: string | null;
  uom: string | null;
  grade: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  purchaseDate: string | Date | null;
  expectedHarvestDate: string | Date | null;
  dispatchDate: string | Date | null;
  deliveryDate: string | Date | null;
  /** The RFPA line's planned values, for comparison */
  rfpaQuantity: number | null;
  rfpaUnitPrice: number | null;
  /** unit name */
  rfpaUom: string | null;
}

export interface DealSlipUpdateFormDto {
  id: string;
  dealSlipNo: string | null;
  /** RFPA number (rfpaId) */
  rfpa: string | null;
  documentId: string | null;
  overAllStatus: string | null;
  /** User id of the approver; null until approved. The GRN form maps it to "Requesting person". */
  approvedBy: string | null;
  lotNo: string;
  loadingLocation: string;
  specialRequest: string;
  remark: string | null;
  createdDate: string | null;
  createdTime: string | null;
  source: string | null;
  /** company / branch ids */
  companyName: string | null;
  purchaseLocation: string | null;
  purchaseForSalesLocation: string | null;
  otherPurchaseLoc: string | null;
  otherPurchaseForSalesLoc: string | null;
  deliveryReceivingPerson: string | null;
  packingInstruction: string | null;
  /** vendor or farmer id, by source */
  selectedParty: string | null;
  paymentInfo: {
    paymentMode: string | null;
    paymentDate: string | Date | null;
    advancePaidAmt: number | null;
    paymentTerms: number | null;
    dueDate: string | Date | null;
    creditPeriod: number | null;
    validityOfQuote: string | null;
  } | null;
  dealSlipProducts: DealSlipUpdateFormProductDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal Slip list item DTO  (GET /dealSlip — getAllDealSlips)
// ─────────────────────────────────────────────────────────────────────────────

export interface DealSlipListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  /** RFPA rfpaId string */
  rfpa: string | null;
  lotNo: string | null;
  loadingLocation: string | null;
  remark: string | null;
  specialRequest: string | null;
  dealSlipNo: string | null;
}

export interface DealSlipListResponseDto {
  data: DealSlipListItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal Slip recycle bin item DTO  (GET /dealSlip/recyclebin)
// ─────────────────────────────────────────────────────────────────────────────

export interface DealSlipRecycleBinItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: any | null;
  createdDate: string | null;
  createdTime: string | null;
  lotNo: string | null;
  approvalNote: string | null;
  loadingLocation: string | null;
  remark: string | null;
  specialRequest: string | null;
  approvalStatus: Status | null;
  dealSlipCreatedAt: Date | null;
  dealSlipApprovedAt: Date | null;
  dealSlipNo: string | null;
}

export interface DealSlipRecycleBinResponseDto {
  data: DealSlipRecycleBinItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal Slip document view DTO  (GET /dealSlip/view/:docid — getDealSlipByIdForView)
// Full detail including document approval metadata.
// ─────────────────────────────────────────────────────────────────────────────

export interface DealSlipDocumentViewDto {
  // ── Document metadata ─────────────────────────────────────────────────────
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

  // ── Deal Slip fields ──────────────────────────────────────────────────────
  id: string;
  lotNo: string;
  approvalNote: string | null;
  loadingLocation: string;
  remark: string | null;
  specialRequest: string;
  approvalStatus: Status;
  dealSlipCreatedAt: Date | null;
  dealSlipApprovedAt: Date | null;
  dealSlipNo: string | null;
  /** RFPA rfpaId string */
  rfpa: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deal Slip numbers DTO  (GET /dealSlip/dealslipno/getAlldealslipNo)
// ─────────────────────────────────────────────────────────────────────────────

export interface DealSlipNumberItemDto {
  id: string;
  dealSlipNo: string;
  documentId: string | null;
}

export interface DealSlipNumbersResponseDto {
  data: DealSlipNumberItemDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /dealSlip/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteDealSlipDto {
  ids: string[];
}

export interface BulkDeleteDealSlipResultDto {
  message: string;
  /** dealSlipNo of each successfully scheduled deal slip */
  deletedNos: string[];
}
