import { Department } from "../../../utils/status.enum";

;

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

export interface ODCAddressDto {
  id?: string | null;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface ODCProductInputDto {
  productName?: string | { id: string } | null;
  variant?: string | { id: string } | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  netWeight?: number | null;
  grossWeight?: number | null;
  packingMaterialWeight?: number | null;
  saleUoM?: string | { id: string } | null;
  packagingMaterial?: string | { id: string } | null;
  packagingMaterialUoM?: string | { id: string } | null;
  packagingMaterialAmount?: number | null;
  packagingMaterialUnitPrice?: number | null;
  packagingMaterialQuantity?: number | null;
  packagingMaterialTotalWeight?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Other Delivery Challan DTO  (POST /other-delivery-challan)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateODCDto {
  /** Company entity ID */
  companyName?: string | null;
  /** Office entity ID */
  offices?: string | null;
  /** GRN entity ID */
  grnNo?: string | null;
  /** Branch entity ID */
  fromLocation?: string | null;

  // Customer info (plain varchar columns)
  customerName?: string | null;
  customer?: string | null;
  customerContactNo?: string | null;
  customerEmail?: string | null;
  /** Address object (creates new) or Address entity ID */
  customerAddress?: ODCAddressDto | string | null;

  transitInsuranceNo?: string | null;
  driverName?: string | null;
  contactNo?: string | null;
  altContactNo?: string | null;
  vehicleNo?: string | null;
  licenseNo?: string | null;
  receiverName?: string | null;
  rmn?: string | null;

  totalProductAmount?: number | null;
  netProductWeight?: number | null;
  netPackagingMaterialWeight?: number | null;
  totalPackagingMaterialAmount?: number | null;
  totalAmtInWords?: string | null;

  requestingDepartment?: Department | null;
  remark?: string | null;
  anyAttachment?: string[] | null;

  deliveryChallanProducts?: ODCProductInputDto[];

  /** Injected by controller */
  createdBy?: string;
  requestedBy?: string;
  type?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update DTO  (PATCH /other-delivery-challan/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateODCDto extends Partial<CreateODCDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Detail DTO  (GET /other-delivery-challan/:id — getById)
// Raw entity relations included.
// ─────────────────────────────────────────────────────────────────────────────

export interface ODCDetailDto {
  data: any;   // raw entity — kept as any since findOne returns the entity
}

// ─────────────────────────────────────────────────────────────────────────────
// View DTO  (GET /other-delivery-challan/view/:id — getByIdChallanforView)
// Relations resolved to display names. Includes document metadata.
// ─────────────────────────────────────────────────────────────────────────────

export interface ODCProductViewDto {
  id: string;
  productName: string | null;
  variant: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  netWeight: number | null;
  grossWeight: number | null;
  packingMaterialWeight: number | null;
  saleUoM: string | null;
  packagingMaterial: string | null;
  packagingMaterialUoM: string | null;
  packagingMaterialAmount: number | null;
  packagingMaterialUnitPrice: number | null;
  packagingMaterialQuantity: number | null;
  packagingMaterialTotalWeight: number | null;
}

export interface ODCViewDto {
  id: string;
  documentId: string | null;
  challanNo: string | null;
  companyName: string | null;
  office: string | null;
  grnNo: string | null;
  fromLocation: string | null;
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  licenseNo: string | null;
  receiverName: string | null;
  rmn: string | null;
  transitInsuranceNo: string | null;
  totalProductAmount: number | null;
  netProductWeight: number | null;
  netPackagingMaterialWeight: number | null;
  totalPackagingMaterialAmount: number | null;
  totalAmtInWords: string | null;
  remark: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  /** Customer name (varchar) */
  customer: string | null;
  customerContactNo: string | null;
  customerEmail: string | null;
  /** Formatted customer address string for display */
  customerAddress: string | null;
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
  deliveryChallanProducts: ODCProductViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Update-form DTO  (GET /other-delivery-challan/update/:id)
// Relations as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface ODCProductUpdateDto {
  id: string;
  productName: string | null;
  variant: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  netWeight: number | null;
  grossWeight: number | null;
  packingMaterialWeight: number | null;
  saleUoM: string | null;
  packagingMaterial: string | null;
  packagingMaterialUoM: string | null;
  packagingMaterialAmount: number | null;
  packagingMaterialUnitPrice: number | null;
  packagingMaterialQuantity: number | null;
  packagingMaterialTotalWeight: number | null;
}

export interface ODCUpdateFormDto {
  id: string;
  challanNo: string | null;
  companyName: string | null;
  office: string | null;
  grnNo: string | null;
  fromLocation: string | null;
  rmn: string | null;
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  licenseNo: string | null;
  receiverName: string | null;
  transitInsuranceNo: string | null;
  totalProductAmount: number | null;
  netProductWeight: number | null;
  netPackagingMaterialWeight: number | null;
  totalPackagingMaterialAmount: number | null;
  totalAmtInWords: string | null;
  requestingDepartment: Department | null;
  approvalStatus: string | null;
  remark: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  customer: string | null;
  customerContactNo: string | null;
  customerEmail: string | null;
  customerAddress: ODCAddressDto | null;
  deliveryChallanProducts: ODCProductUpdateDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// List item DTO  (GET /other-delivery-challan — getAll)
// ─────────────────────────────────────────────────────────────────────────────

export interface ODCListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  challanNo: string | null;
  companyName: string | null;
  office: string | null;
  grnNo: string | null;
  fromLocation: string | null;
  customer: string | null;
  customerContactNo: string | null;
  customerEmail: string | null;
  rmn: string | null;
  /** Formatted address string */
  customerAddress: string | null;
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  licenseNo: string | null;
  receiverName: string | null;
  transitInsuranceNo: string | null;
  totalProductAmount: number | null;
  netProductWeight: number | null;
  netPackagingMaterialWeight: number | null;
  totalPackagingMaterialAmount: number | null;
  totalAmtInWords: string | null;
  requestingDepartment: Department | null;
  approvalStatus: string | null;
  remark: string | null;
  anyAttachment: string[] | null;
}

export interface ODCListResponseDto {
  data: ODCListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /other-delivery-challan/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteODCDto {
  ids: string[];
}

export interface BulkDeleteODCResultDto {
  success: string[];
  failed: { id: string; reason: string }[];
  message: string;
}
