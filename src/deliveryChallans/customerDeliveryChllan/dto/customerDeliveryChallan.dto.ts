

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

import { Department } from "../../../utils/status.enum";

export interface ChallanAddressDto {
  id?: string | null;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

/** Product line — used in create/update. */
export interface ChallanProductInputDto {
  productName?: string | { id: string } | null;
  variant?: string | { id: string } | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  netWeight?: number | null;
  grossWeight?: number | null;
  acceptedQty?: number | null | undefined;
  rejectedQty?: number | null | undefined;
  returnedQty?: number | null;
  changedQty?: number | null;
  changedPrice?: number | null;
  saleUoM?: string | { id: string } | null;
  packagingMaterial?: string | { id: string } | null;
  packagingMaterialUoM?: string | { id: string } | null;
  packagingMaterialAmount?: number | null;
  packagingMaterialUnitPrice?: number | null;
  packagingMaterialQuantity?: number | null;
  packagingMaterialTotalWeight?: number | null;
  packingMaterialWeight?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Customer Delivery Challan DTO  (POST /customer-delivery-challan)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateCustomerDeliveryChallanDto {
  /** Customer entity ID */
  partyName?: string | null;
  /** Company entity ID */
  companyName?: string | null;
  /** Office entity ID */
  offices?: string | null;
  /** Branch entity ID for fromLocation */
  fromLocation?: string | null;
  /** GRN entity ID */
  grnNo?: string | null;

  poNumber?: string | null;
  transitInsuranceNo?: string | null;
  driverName?: string | null;
  contactNo?: string | null;
  altContactNo?: string | null;
  vehicleNo?: string | null;
  licenseNo?: string | null;
  receiverName?: string | null;
  rmn?: string | null;

  billingAddress?: ChallanAddressDto | null;
  deliveryAddress?: ChallanAddressDto | null;
currentShippingAddress?:ChallanAddressDto|null;
  totalProductAmount?: number | null;
  netProductWeight?: number | null;
  netPackagingMaterialWeight?: number | null;
  totalPackagingMaterialAmount?: number | null;
  totalAmtInWords?: string | null;

  requestingDepartment?: Department | null;
  remark?: string | null;
  anyAttachment?: string[] | null;

  deliveryChallanProducts?: ChallanProductInputDto[];
  variants?: string[];

  /** Injected by controller */
  createdBy?: string;
  type?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Customer Delivery Challan DTO  (PATCH /customer-delivery-challan/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateCustomerDeliveryChallanDto extends Partial<CreateCustomerDeliveryChallanDto> {
  updatedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Challan update form DTO  (GET /customer-delivery-challan/update/:id)
// Relations returned as IDs.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChallanProductUpdateDto {
  id: string;
  productName: string | null;
  variant: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  netWeight: number | null;
  grossWeight: number | null;
  acceptedQty: number | null | undefined;
  rejectedQty: number | null | undefined;
  returnedQty: number | null;
  changedQty: number | null;
  changedPrice: number | null;
  saleUoM: string | null;
  packagingMaterial: string | null;
  packagingMaterialUoM: string | null;
  packagingMaterialAmount: number | null;
  packingMaterialWeight: number | null;
  packagingMaterialUnitPrice: number | null;
  packagingMaterialQuantity: number | null;
  packagingMaterialTotalWeight: number | null;
}

export interface CustomerDeliveryChallanUpdateFormDto {
  id: string;
  challanNo: string | null;
  poNumber: string | null;
  customerName: string | null;
  fromLocation: string | null;
  transitInsuranceNo: string | null;
  billingAddress: ChallanAddressDto | null;
  deliveryAddress: ChallanAddressDto | null;
  currentShippingAddress?:ChallanAddressDto|null;
  companyName: string | null;
  office: string | null;
  grnNo: string | null;
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  licenseNo: string | null;
  receiverName: string | null;
  rmn: string | null;
  totalProductAmount: number | null;
  netProductWeight: number | null;
  netPackagingMaterialWeight: number | null;
  totalPackagingMaterialAmount: number | null;
  totalAmtInWords: string | null;
  requestingDepartment: Department | null;
  remark: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  deliveryChallanProducts: ChallanProductUpdateDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Challan view DTO  (GET /customer-delivery-challan/view/:id)
// Relations resolved to display names. Includes document metadata.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChallanProductViewDto {
  id: string;
  productName: string | null;
  variant: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  netWeight: number | null;
  grossWeight: number | null;
  acceptedQty: number | null | undefined;
  returnedQty: number | null | undefined;
  rejectedQty: number | null | undefined;
  changedQty: number | null;
  changedPrice: number | null;
  saleUoM: string | null;
  packingMaterial: string | null;
  packagingMaterialUoM: string | null;
  packagingMaterialAmount: number | null;
  packagingMaterialUnitPrice: number | null;
  packagingMaterialQuantity: number | null;
  packagingMaterialTotalWeight: number | null;
}

export interface CustomerDeliveryChallanViewDto {
  id: string;
  documentId: string | null;
  challanNo: string | null;
  poNumber: string | null;
  /** Customer organisation name */
  customerName: string | null;
  transitInsuranceNo: string | null;
  /** Branch name */
  fromLocation: string | null;
  billingAddress: ChallanAddressDto | null;
  deliveryAddress: ChallanAddressDto | null;
  currentShippingAddress?:ChallanAddressDto|null;
  /** Company name */
  companyName: string | null;
  /** Office name */
  office: string | null;
  grnNo: string | null;
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  licenseNo: string | null;
  receiverName: string | null;
  totalProductAmount: number | null;
  netProductWeight: number | null;
  netPackagingMaterialWeight: number | null;
  totalPackagingMaterialAmount: number | null;
  totalAmtInWords: string | null;
  requestingDepartment: Department | null;
  remark: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  overAllStatus: string | null;
  createdBy: any | null;
  isInvoiceCreated: boolean;
  isReturned: boolean;
  isReturnByCustomerCreated: boolean;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;
  deliveryChallanProducts: ChallanProductViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Challan list item DTO  (GET /customer-delivery-challan — getAllCustomerDeliveryChallans)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChallanListProductDto {
  id: string;
  packagingMaterialQuantity: number | null;
  packagingMaterialUnitPrice: number | null;
  packagingMaterialAmount: number | null;
  packagingMaterialTotalWeight: number | null;
  amount: number | null;
  unitPrice: number | null;
  grossWeight: number | null;
  netWeight: number | null;
}

export interface CustomerDeliveryChallanListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  challanNo: string | null;
  poNumber: string | null;
  customerName: string | null;
  billingAddress: ChallanAddressDto | null;
  deliveryAddress: ChallanAddressDto | null;
  currentShippingAddress?:ChallanAddressDto|null;
  fromLocation: { id: string; name: string } | null;
  transitInsuranceNo: string | null;
  grnNo: string | null;
  companyName: { id: string; name: string } | null;
  office: string | null;
  netProductWeight: number | null;
  netPackagingMaterialWeight: number | null;
  totalPackagingMaterialAmount: number | null;
  totalProductAmount: number | null;
  totalAmtInWords: string | null;
  driverName: string | null;
  licenseNo: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  receiverName: string | null;
  rmn: string | null;
  remark: string | null;
  anyAttachment: string[] | null;
  deliveryChallanProducts: ChallanListProductDto[];
}

export interface CustomerDeliveryChallanListResponseDto {
  data: CustomerDeliveryChallanListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /customer-delivery-challan/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteCustomerDCDto {
  ids: string[];
}

/** Returned by delete (single) service method */
export interface DeleteCustomerDeliveryChallanResultDto {
  challanNo: string;
}

export interface BulkDeleteCustomerDCResultDto {
  success: string[];
  failed: { id: string; reason: string }[];
  message: string;
}
