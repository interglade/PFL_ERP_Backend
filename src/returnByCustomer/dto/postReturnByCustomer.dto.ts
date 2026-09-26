// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

export interface RBCReturnedProductInputDto {
  productName?: string | { id: string } | null;
  variant?: string | { id: string } | null;
  saleUoM?: string | { id: string } | null;
  unitPrice?: number;
  returnedQty?: number;
  returnedQtyAmt?: number;
  returnedNetWt?: number;
  returnedPackingMaterialWt?: number;
  returnedGrossWt?: number;
  rejectedQty?: number;
  rejectedQtyAmt?: number;
  rejectedNetWt?: number;
  rejectedGrossWt?: number;
  rejectedPackingMaterialWt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Post Return By Customer DTO  (POST /returns)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateRBCDto {
  /** DeliveryChallan entity ID */
  deliveryChallanNo: string;
  /** Company entity ID */
  companyName?: string | null;
  /** Branch entity ID */
  location?: string | null;
  /** Customer entity ID */
  customerName?: string | null;
  date?: string | Date | null;
  remark?: string | null;
  returnedProducts?: RBCReturnedProductInputDto[];
  /** Injected by controller */
  rbcNo?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Post Return By Customer DTO  (PATCH /returns/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateRBCDto extends Partial<CreateRBCDto> {
  returnedProducts?: (RBCReturnedProductInputDto & { id?: string })[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RBC list item DTO  (GET /returns — getAllPostReturnByCustomer)
// ─────────────────────────────────────────────────────────────────────────────

export interface RBCListProductDto {
  id: string;
  productName: string | null;
  saleUoM: string | null;
  unitPrice: number | null;
}

export interface RBCListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  rbcNo: string | null;
  date: string | null;
  remark: string | null;
  companyName: string | null;
  deliveryChallanNo: string | null;
  returnedProducts: RBCListProductDto[];
}

export interface RBCListResponseDto {
  data: RBCListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RBC detail DTO  (GET /returns/:id — getByIdPostReturnByCustomer)
// ─────────────────────────────────────────────────────────────────────────────

export interface RBCDetailProductDto {
  productName: string | null;
  saleUoM: string | null;
  unitPrice: number | null;
  returnedQty: number | null;
  returnedQtyAmt: number | null;
  rejectedQty: number | null;
  rejectedQtyAmt: number | null;
  returnedNetWt: number | null;
  returnedPackingMaterialWt: number | null;
  returnedGrossWt: number | null;
  rejectedNetWt: number | null;
  rejectedGrossWt: number | null;
  rejectedPackingMaterialWt: number | null;
}

export interface RBCDetailDto {
  id: string;
  rbcNo: string | null;
  companyName: string | null;
  date: string | null;
  createdDate: string | null;
  createdTime: string | null;
  deliveryChallanNo: string | null;
  remark: string | null;
  returnedProducts: RBCDetailProductDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RBC view DTO  (GET /returns/view/:docid — getByIdPostReturnByCustomerforView)
// Full detail with document metadata. Relations as display names.
// ─────────────────────────────────────────────────────────────────────────────

export interface RBCViewProductDto {
  productName: string | null;
  variant: string | null;
  saleUoM: string | null;
  unitPrice: number | null;
  returnedQty: number | null;
  returnedQtyAmt: number | null;
  rejectedQty: number | null;
  rejectedQtyAmt: number | null;
  returnedNetWt: number | null;
  returnedPackingMaterialWt: number | null;
  returnedGrossWt: number | null;
  rejectedNetWt: number | null;
  rejectedGrossWt: number | null;
  rejectedPackingMaterialWt: number | null;
}

export interface RBCViewDto {
  id: string;
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
  companyName: string | null;
  customerName: string | null;
  location: string | null;
  date: string | null;
  deliveryChallanNo: string | null;
  remark: string | null;
  returnedProducts: RBCViewProductDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RBC update-form DTO  (GET /returns/update/:id — getByIdPostReturnByCustomerforupdate)
// Relations as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface RBCUpdateProductDto {
  productName: string | null;
  variant: string | null;
  saleUoM: string | null;
  unitPrice: number | null;
  returnedQty: number | null;
  returnedQtyAmt: number | null;
  rejectedQty: number | null;
  rejectedQtyAmt: number | null;
  returnedNetWt: number | null;
  returnedPackingMaterialWt: number | null;
  returnedGrossWt: number | null;
  rejectedNetWt: number | null;
  rejectedGrossWt: number | null;
  rejectedPackingMaterialWt: number | null;
}

export interface RBCUpdateFormDto {
  id: string;
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
  /** Company entity ID */
  companyName: string | null;
  /** Customer entity ID */
  customerName: string | null;
  date: string | null;
  /** Branch entity ID */
  location: string | null;
  /** DeliveryChallan entity ID */
  deliveryChallanNo: string | null;
  remark: string | null;
  returnedProducts: RBCUpdateProductDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RBC numbers DTO  (GET /returns/get/rbcNo)
// ─────────────────────────────────────────────────────────────────────────────

export interface RBCNumberItemDto {
  id: string;
  rbcNo: string | null;
}

export interface RBCNumbersResponseDto {
  data: RBCNumberItemDto[];
  total: number;
  page: number;
  totalPages: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /returns/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteRBCDto {
  ids: string[];
}

export interface BulkDeleteRBCResultDto {
  success: string[];
  failed: { id: string; reason: string }[];
  message: string;
}
