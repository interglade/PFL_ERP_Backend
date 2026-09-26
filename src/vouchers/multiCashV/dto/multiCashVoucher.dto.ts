import { Department, Status } from '../../../utils/status.enum';

export interface MultiCashVoucherParticularDto {
  id?: string;
  description?: string;
  amt?: number;
}

export interface UserRefDto {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface CreateMultiCashVoucherDto {
  requestingDepartment?: Department;
  companyName?: string;
  grnNo?: string | null | any;
  debitCreditTo?: string;
  voucherNo?: string;
  payReceivedFrom?: string;
  location?: string;
  particulars?: MultiCashVoucherParticularDto[];
  challanNo?: string | null | any;
  totalAmt?: number;
  amtWords?: string;
  paymentMode?: string;
  receiverName?: string;
  anyAttachment?: string[] | null;
  approvalStatus?: Status;
  requestedBy?: string;
  passBy?: string;
  approveBy?: string;
  remark?: string;
}

export type UpdateMultiCashVoucherDto = Partial<CreateMultiCashVoucherDto>;

export interface MultiCashVoucherListItemDto {
  id: string;
  documentId?: string | null;
  companyName?: string | null;
  grnNo?: string | null;
  challanNo?: string | null;
  debitCreditTo?: string | null;
  voucherNo?: string | null;
  payReceivedFrom?: string | null;
  location?: string | null;
  totalAmt?: number | null;
  amtWords?: string | null;
  paymentMode?: string | null;
  receiverName?: string | null;
  remark?: string | null;
  approvalStatus?: Status | null;
  requestingDepartment?: Department | null;
  createdDate?: string | null;
  createdTime?: string | null;
  createdBy?: string | null;
  overAllStatus?: string | null;
}

export interface MultiCashVoucherDetailDto {
  id: string;
  companyName?: string | null;
  grnNo?: string | null;
  challanNo?: string | null;
  debitCreditTo?: string | null;
  voucherNo?: string | null;
  payReceivedFrom?: string | null;
  location?: string | null;
  particulars: MultiCashVoucherParticularDto[];
  totalAmt?: number | null;
  amtWords?: string | null;
  paymentMode?: string | null;
  receiverName?: string | null;
  anyAttachment?: string[] | null;
  requestedBy?: UserRefDto | null;
  remark?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  overAllStatus?: string | null;
  documentId?: string | null;
  createdBy?: string | null;
  approvalSummary?: any | null;
}
