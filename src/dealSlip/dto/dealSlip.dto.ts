import { Department, Status } from "../../utils/status.enum";

;

// ─────────────────────────────────────────────────────────────────────────────
// Create Deal Slip DTO  (POST /dealSlip)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateDealSlipDto {
  /** RFPA entity ID */
  rfpa: string;
  lotNo: string;
  loadingLocation: string;
  specialRequest: string;
  remark?: string | null;
  approvalNote?: string | null;
  /** Injected from res.locals by controller */
  requestedBy?: string;
  requestingDepartment?: Department | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Deal Slip DTO  (PATCH /dealSlip/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateDealSlipDto extends Partial<CreateDealSlipDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Approve Deal Slip DTO  (PATCH /dealSlip/approve/:dealSlipId)
// ─────────────────────────────────────────────────────────────────────────────

export interface ApproveDealSlipDto {
  approvalStatus: Status.APPROVED | Status.REJECTED;
  approvalNote?: string | null;
}

export interface ApproveDealSlipResultDto {
  message: string;
  approvalStatus: Status;
  approvalNote: string;
  user: {
    name: string;
    department: string | null;
  };
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
  requestingDepartment: Department | null;
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
// Same shape — rfpa as ID for pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export type DealSlipUpdateFormDto = DealSlipDetailDto;

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
  requestingDepartment: Department | null;
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
  requestingDepartment: Department | null;
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
