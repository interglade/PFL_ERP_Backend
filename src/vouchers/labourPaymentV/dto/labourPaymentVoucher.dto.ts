

// ─────────────────────────────────────────────────────────────────────────────
// Create Labour Payment Voucher DTO  (POST /lpvoucher)
// ─────────────────────────────────────────────────────────────────────────────

import { Department, Status } from "../../../utils/status.enum";

export interface CreateLPVoucherDto {
  /** GRN entity ID */
  grnNo?: string | null;
  /** Company entity ID */
  companyName?: string | null;

  requestingDepartment?: Department | null;
  debitCreditTo?: string | null;
  payReceivedFrom?: string | null;
  location?: string | null;
  noOfLabours?: number | null;
  loadingDate?: string | Date | null;
  contactNo?: string | null;
  altContactNo?: string | null;
  /** Comma-separated product names (plain string column) */
  products?: string | null;
  paymentMode?: string | null;
  ratePerLabour?: number | null;
  totalAmt?: number | null;
  amtWords?: string | null;
  receiverName?: string | null;
  kyc?: boolean | null;
  anyAttachment?: string[] | null;
  remark?: string | null;

  /** Injected from res.locals by controller */
  requestedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Labour Payment Voucher DTO  (PATCH /lpvoucher/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateLPVoucherDto extends Partial<CreateLPVoucherDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// LP Voucher list item DTO  (GET /lpvoucher — getLPVouchers)
// ─────────────────────────────────────────────────────────────────────────────

export interface LPVoucherListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  voucherNo: string | null;
  approvalStatus: Status | null;
  companyName: string | null;
  grnNo: string | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  location: string | null;
  noOfLabours: number | null;
  loadingDate: Date | null;
  contactNo: string | null;
  altContactNo: string | null;
  products: string | null;
  paymentMode: string | null;
  ratePerLabour: number | null;
  totalAmt: number | null;
  amtWords: string | null;
  receiverName: string | null;
  kyc: boolean | null;
  anyAttachment: string[] | null;
  requestingDepartment: Department | null;
  remark: string | null;
}

export interface LPVoucherListResponseDto {
  data: LPVoucherListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LP Voucher detail DTO  (GET /lpvoucher/:id — getLPVoucherById)
// GRN and company as objects with id + name.
// ─────────────────────────────────────────────────────────────────────────────

export interface LPVoucherDetailDto {
  id: string;
  voucherNo: string | null;
  approvalStatus: Status | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  receiverName: string | null;
  location: string | null;
  noOfLabours: number | null;
  loadingDate: Date | null;
  contactNo: string | null;
  altContactNo: string | null;
  products: string | null;
  kyc: boolean | null;
  paymentMode: string | null;
  ratePerLabour: number | null;
  totalAmt: number | null;
  amtWords: string | null;
  anyAttachment: string[] | null;
  requestingDepartment: Department | null;
  createdDate: string | null;
  createdTime: string | null;
  grnNo: { id: string | null; grnNo: string | null } | null;
  companyName: { id: string | null; companyName: string | null } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LP Voucher view DTO  (GET /lpvoucher/:id/view — getLPVoucherByIdForView)
// Full detail with document approval metadata. Relations resolved to names.
// ─────────────────────────────────────────────────────────────────────────────

export interface LPVoucherViewDto {
  id: string;
  voucherNo: string | null;
  approvalStatus: Status | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  receiverName: string | null;
  location: string | null;
  noOfLabours: number | null;
  loadingDate: Date | null;
  contactNo: string | null;
  altContactNo: string | null;
  products: string | null;
  kyc: boolean | null;
  paymentMode: string | null;
  ratePerLabour: number | null;
  totalAmt: number | null;
  amtWords: string | null;
  anyAttachment: string[] | null;
  requestingDepartment: Department | null;
  remark: string | null;
  /** Company name string */
  companyName: string | null;
  /** GRN number string */
  grnNo: string | null;
  createdDate: string | null;
  createdTime: string | null;
  // ── Document metadata ─────────────────────────────────────────────────────
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: any | null;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LP Voucher update form DTO  (GET /lpvoucher/:id/update — getLPVoucherByIdForUpdate)
// Relations returned as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface LPVoucherUpdateFormDto {
  id: string;
  voucherNo: string | null;
  approvalStatus: Status | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  receiverName: string | null;
  location: string | null;
  noOfLabours: number | null;
  loadingDate: Date | null;
  contactNo: string | null;
  altContactNo: string | null;
  products: string | null;
  kyc: boolean | null;
  paymentMode: string | null;
  ratePerLabour: number | null;
  totalAmt: number | null;
  amtWords: string | null;
  anyAttachment: string[] | null;
  requestingDepartment: Department | null;
  remark: string | null;
  /** GRN entity ID */
  grnNo: string | null;
  /** Company entity ID */
  companyName: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /lpvoucher/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteLPVoucherDto {
  ids: string[];
}

export interface BulkDeleteLPVoucherResultDto {
  message: string;
}
