import { Department, Status } from "../../../utils/status.enum";



export interface PMPVoucherMaterialDto {
  id?: string;
  itemName?: string | null;
  itemQty?: number | null;
  itemUom?: string | null;
  rate?: number | null;
  amt?: number | null;
}

export interface PMPVoucherAddressDto {
  id?: string | null;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface CreatePMPVoucherDto {
  voucherNo?: string;
  grnNo?: string | null;
  approvalStatus?: Status;
  debitCreditTo?: string | null;
  payReceivedFrom?: string | null;
  sellerName?: string | null;
  address?: string | PMPVoucherAddressDto | null;
  contactNo?: string | null;
  altContactNo?: string | null;
  purpose?: string | null;
  materials?: PMPVoucherMaterialDto[];
  paymentMode?: string | null;
  totalAmt?: number | null;
  amtWords?: string | null;
  receiverName?: string | null;
  kyc?: boolean | null;
  anyAttachment?: string[] | null;
  requestingDepartment?: Department | null;
  companyName?: string | null;
  requestedBy?: string | null;
  passBy?: string | null;
  approveBy?: string | null;
  remark?: string | null;
  location?: string | null; // Branch id
}

export type UpdatePMPVoucherDto = Partial<CreatePMPVoucherDto>;

export interface PMPVoucherListItemDto {
  id: string;
  documentId?: string | null;
  voucherNo?: string | null;
  approvalStatus?: Status | null;
  debitCreditTo?: string | null;
  payReceivedFrom?: string | null;
  sellerName?: string | null;
  address?: PMPVoucherAddressDto | null;
  companyName?: string | null;
  grnNo?: string | null;
  totalAmt?: number | null;
  amtWords?: string | null;
  paymentMode?: string | null;
  receiverName?: string | null;
  remark?: string | null;
  requestingDepartment?: Department | null;
  overAllStatus?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  createdBy?: string | null;
  kyc?: boolean | null;
  purpose?: string | null;
  contactNo?: string | null;
  altContactNo?: string | null;
  location?: string | null; // Branch name (display)
}


export interface GetSellerAddressDto{
id?: string;
  address1?: string;
  address2?: string;
  location?: string;
  city?: string;
  state?: string;
  pincode?: string;
}
export interface PMPVoucherDetailDto {
  id: string;
  voucherNo?: string | null;
  grnNo?: string | null;
  approvalStatus?: Status | null;
  debitCreditTo?: string | null;
  payReceivedFrom?: string | null;
  location?: string | null; // Branch name (display)
  sellerName?: string | null;
  address?: PMPVoucherAddressDto | null;
  contactNo?: string | null;
  altContactNo?: string | null;
  purpose?: string | null;
  materials?: PMPVoucherMaterialDto[];
  paymentMode?: string | null;
  totalAmt?: number | null;
  amtWords?: string | null;
  receiverName?: string | null;
  anyAttachment?: string[] | null;
  requestingDepartment?: Department | null;
  kyc?: boolean | null;
  companyName?: string | null;
  requestedBy?: string | null;
  passBy?: string | null;
  approveBy?: string | null;
  remark?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  overAllStatus?: string | null;
  documentId?: string | null;
  createdBy?: string | null;
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
