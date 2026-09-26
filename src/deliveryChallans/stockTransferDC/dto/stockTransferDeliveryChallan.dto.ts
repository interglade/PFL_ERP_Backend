

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

import { Department } from "../../../utils/status.enum";
import { StockTransferType } from "../entity/stockTransferdeliveryChallan.entity";

/** Product line — used in create/update requests. */
export interface STChallanProductInputDto {
  productName?: string | { id: string } | null;
  variant?: string | { id: string } | null;
  uom?: string | { id: string } | null;
  quantity?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  grossWeight?: number | null;
  netWeight?: number | null;
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
// Create Stock Transfer Delivery Challan DTO  (POST /tranfer-delivery-challan)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSTDeliveryChallanDto {
  stockTransferType: StockTransferType;
  /** Company entity ID */
  companyName?: string | null;
  /** Office entity ID */
  offices?: string | null;
  /** GRN entity ID */
  grnNo?: string | null;
  /** Branch entity ID — from location */
  fromLocation?: string | null;
  /** Branch entity ID — to location */
  toLocation?: string | null;

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

  deliveryChallanProducts?: STChallanProductInputDto[];

  /** Injected by controller */
  createdBy?: string;
  type?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update DTO  (PATCH /tranfer-delivery-challan/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateSTDeliveryChallanDto extends Partial<CreateSTDeliveryChallanDto> {
  updatedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update-form DTO  (GET /tranfer-delivery-challan/update/:id)
// Relations returned as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface STChallanProductUpdateDto {
  id: string;
  productName: string | null;
  variant: string | null;
  uom: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  grossWeight: number | null;
  packingMaterialWeight: number | null;
  netWeight: number | null;
  saleUoM: string | null;
  packagingMaterial: string | null;
  packagingMaterialUoM: string | null;
  packagingMaterialAmount: number | null;
  packagingMaterialUnitPrice: number | null;
  packagingMaterialQuantity: number | null;
  packagingMaterialTotalWeight: number | null;
}

export interface STDeliveryChallanUpdateFormDto {
  id: string;
  challanNo: string | null;
  stockTransferType: StockTransferType | null;
  companyName: string | null;
  office: string | null;
  grnNo: string | null;
  fromLocation: string | null;
  toLocation: string | null;
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
  transitInsuranceNo: string | null;
  rmn: string | null;
  requestingDepartment: Department | null;
  approvalStatus: string | null;
  remark: string | null;
  anyAttachment: string[] | null;
  createdDate: string | null;
  createdTime: string | null;
  deliveryChallanProducts: STChallanProductUpdateDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// View DTO  (GET /tranfer-delivery-challan/view/:id)
// Relations resolved to display names. Includes document metadata.
// ─────────────────────────────────────────────────────────────────────────────

export interface STChallanProductViewDto {
  id: string;
  productName: string | null;
  variant: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  grossWeight: number | null;
  netWeight: number | null;
  packingMaterialWeight: number | null;
  saleUoM: string | null;
  packingMaterial: string | null;
  packagingMaterialUoM: string | null;
  packagingMaterialAmount: number | null;
  packagingMaterialUnitPrice: number | null;
  packagingMaterialQuantity: number | null;
  packagingMaterialTotalWeight: number | null;
}

export interface STDeliveryChallanViewDto {
  id: string;
  documentId: string | null;
  challanNo: string | null;
  stockTransferType: StockTransferType | null;
  /** Company name string */
  companyName: string | null;
  transitInsuranceNo: string | null;
  /** Office name string */
  office: string | null;
  grnNo: string | null;
  /** Branch name string */
  fromLocation: string | null;
  /** Branch name string */
  toLocation: string | null;
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
  // ── Document metadata ─────────────────────────────────────────────────────
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
  deliveryChallanProducts: STChallanProductViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// List item DTO  (GET /tranfer-delivery-challan — getAll)
// ─────────────────────────────────────────────────────────────────────────────

export interface STDeliveryChallanListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  challanNo: string | null;
  transitInsuranceNo: string | null;
  totalProductAmount: number | null;
  netProductWeight: number | null;
  netPackagingMaterialWeight: number | null;
  totalPackagingMaterialAmount: number | null;
  totalAmtInWords: string | null;
  driverName: string | null;
  contactNo: string | null;
  altContactNo: string | null;
  vehicleNo: string | null;
  licenseNo: string | null;
  rmn: string | null;
  receiverName: string | null;
  anyAttachment: string[] | null;
  remark: string | null;
  requestingDepartment: Department | null;
  approvalStatus: string | null;
  stockTransferType: StockTransferType | null;
  /** Company name string */
  companyName: string | null;
  /** Branch name string */
  fromLocation: string | null;
  toLocation: string | null;
}

export interface STDeliveryChallanListResponseDto {
  data: STDeliveryChallanListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    totalPages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /tranfer-delivery-challan/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteSTChallanDto {
  ids: string[];
}

export interface BulkDeleteSTChallanResultDto {
  success: string[];
  failed: { id: string; reason: string }[];
  message: string;
}
