import { Department, Status } from '../../../utils/status.enum';

// ─────────────────────────────────────────────────────────────────────────────
// Create Transport Payment Voucher DTO  (POST /tpvoucher)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTPVoucherDto {
  /** GRN entity ID */
  grnNo?: string | null;
  /** Company entity ID */
  companyName?: string | null;
  /** Product entity IDs */
  products?: string[];

  requestingDepartment?: Department | null;
  debitCreditTo?: string | null;
  payReceivedFrom?: string | null;
  location?: string | null; // Branch id
  driverName?: string | null;
  contactNo?: string | null;
  altContactNo?: string | null;
  vehicleNo?: string | null;
  dispatchLocation?: string | null;
  destinationLocation?: string | null;
  paymentMode?: string | null;

  freightAmt?: number | null;
  decidedAmt?: number | null;
  actualAmt?: number | null;
  advanceAmt?: number | null;
  totalPayableAmt?: number | null;
  finalPayableAmt?: number | null;
  deductionAmt?: number | null;
  extraAmt?: number | null;

  amtWords?: string | null;
  receiverName?: string | null;
  kyc?: boolean | null;
  anyAttachment?: string[] | null;
  remark?: string | null;

  /** Injected from res.locals by controller */
  requestedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update TP Voucher DTO  (PATCH /tpvoucher/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateTPVoucherDto extends Partial<CreateTPVoucherDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// TP Voucher list item DTO  (GET /tpvoucher — getAllTPVouchers)
// ─────────────────────────────────────────────────────────────────────────────

export interface TPVoucherListItemDto {
  id: string | null;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  voucherNo: string | null;
  companyName: string | null;
  grnNo: string | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  location: string | null; // Branch name (display)
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  dispatchLocation: string | null;
  destinationLocation: string | null;
  paymentMode: string | null;
  freightAmt: number | null;
  totalAmt: number | null;
  amtWords: string | null;
  receiverName: string | null;
  kyc: boolean | null;
  remark: string | null;
}

export interface TPVoucherListResponseDto {
  data: TPVoucherListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TP Voucher detail DTO  (GET /tpvoucher/:id — getTPVoucherById)
// GRN and company returned as objects with id+name.
// ─────────────────────────────────────────────────────────────────────────────

export interface TPVoucherDetailDto {
  id: string;
  voucherNo: string | null;
  requestingDepartment: Department | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  location: string | null;
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  dispatchLocation: string | null;
  destinationLocation: string | null;
  paymentMode: string | null;
  freightAmt: number | null;
  totalPayableAmt: number | null;
  kyc: boolean | null;
  remark: string | null;
  amtWords: string | null;
  approvalStatus: Status | null;
  receiverName: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  grnNo: { id: string; grnNo: string } | null;
  companyName: { id: string | null; companyName: string | null } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TP Voucher view DTO  (GET /tpvoucher/:id/view — getTPVoucherByIdForView)
// Full detail with document approval metadata. Relations resolved to names.
// ─────────────────────────────────────────────────────────────────────────────

export interface TPVoucherViewDto {
  id: string;
  voucherNo: string | null;
  requestingDepartment: Department | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  location: string | null; // Branch name (display)
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  dispatchLocation: string | null;
  destinationLocation: string | null;
  /** Product names resolved */
  products: (string | null)[] | null;
  paymentMode: string | null;
  freightAmt: number | null;
  totalPayableAmt: number | null;
  extraAmt: number | null;
  deductionAmt: number | null;
  finalPayableAmt: number | null;
  advanceAmt: number | null;
  actualAmt: number | null;
  decidedAmt: number | null;
  kyc: boolean | null;
  remark: string | null;
  amtWords: string | null;
  approvalStatus: Status | null;
  receiverName: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  /** Company name string */
  companyName: string | null;
  /** GRN number string */
  grnNo: string | null;
  /** Full name of requestedBy user */
  requestedBy: string | null;
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
// TP Voucher update form DTO  (GET /tpvoucher/:id/update — getTPVoucherByIdForUpdate)
// Relations returned as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface TPVoucherUpdateFormDto {
  id: string;
  voucherNo: string | null;
  requestingDepartment: Department | null;
  debitCreditTo: string | null;
  payReceivedFrom: string | null;
  location: string | null; // Branch id (for form pre-selection)
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  dispatchLocation: string | null;
  destinationLocation: string | null;
  /** Product IDs */
  products: string[] | null;
  paymentMode: string | null;
  freightAmt: number | null;
  totalPayableAmt: number | null;
  extraAmt: number | null;
  deductionAmt: number | null;
  finalPayableAmt: number | null;
  advanceAmt: number | null;
  actualAmt: number | null;
  decidedAmt: number | null;
  kyc: boolean | null;
  remark: string | null;
  amtWords: string | null;
  approvalStatus: Status | null;
  receiverName: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  /** GRN entity ID */
  grnNo: string | null;
  /** Company entity ID */
  companyName: string | null;
  /** User entity ID */
  requestedBy: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /tpvoucher/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteTPVoucherDto {
  ids: string[];
}

export interface BulkDeleteTPVoucherResultDto {
  message: string;
}
