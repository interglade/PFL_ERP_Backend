// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

export interface RTVProductInputDto {
  productName?: string | { id: string } | null;
  variant?: string | { id: string } | null;
  uom?: string | { id: string } | null;
  quantity?: number | null;
  unitPrice?: number | null;
  netWeight?: number | null;
  grossWeight?: number | null;
  amount?: number | null;
  packingMaterialWeight?: number | null;
  reason?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Return To Vendor DTO  (POST /return-to-vendor)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateRTVDto {
  /** GRN entity ID */
  grnNo: string;
  /** Company entity ID */
  companyName?: string | null;
  /** Branch entity ID */
  location?: string | null;
  /** Vendor entity ID */
  selectedVendor?: string | null;

  returnedGrossWeight?: number | null;
  returnedNetWeight?: number | null;
  totalAmt?: number | null;
  returnDate?: string | Date | null;
  amtWords?: string | null;
  remark?: string | null;

  rtvProducts?: RTVProductInputDto[];
  variants?: string[];

  /** Injected by controller */
  createdBy?: string;
  isChanged?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update DTO  (PUT /return-to-vendor/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateRTVDto extends Partial<CreateRTVDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// RTV list item DTO  (GET /return-to-vendor — getAll)
// ─────────────────────────────────────────────────────────────────────────────

export interface RTVListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  rtvNo: string | null;
  grnNo: string | null;
  companyName: string | null;
  location: string | null;
  /** Vendor companyName string */
  selectedVendor: string | null;
  returnedGrossWeight: number | null;
  returnedNetWeight: number | null;
  totalAmt: number | null;
  returnDate: Date | string | null;
  amtWords: string | null;
  remark: string | null;
}

export interface RTVListResponseDto {
  data: RTVListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RTV view DTO  (GET /return-to-vendor/view/:docid — getByIdForView)
// Full detail with document metadata. Relations resolved to display names.
// ─────────────────────────────────────────────────────────────────────────────

export interface RTVProductViewDto {
  id: string;
  productName: string | null;
  variant: string | null;
  uom: string | null;
  quantity: number | null;
  unitPrice: number | null;
  netWeight: number | null;
  grossWeight: number | null;
  amount: number | null;
  packingMaterialWeight: number | null;
  reason: string | null;
}

export interface RTVViewDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
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
  rtvNo: string | null;
  grnNo: string | null;
  companyName: string | null;
  location: string | null;
  selectedVendor: string | null;
  returnedGrossWeight: number | null;
  returnedNetWeight: number | null;
  totalAmt: number | null;
  returnDate: Date | string | null;
  amtWords: string | null;
  remark: string | null;
  rtvProducts: RTVProductViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RTV update-form DTO  (GET /return-to-vendor/update/:id — getByIdForUpdate)
// Relations returned as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface RTVProductUpdateDto {
  id: string;
  productName: string | null;
  variant: string | null;
  uom: string | null;
  quantity: number | null;
  unitPrice: number | null;
  netWeight: number | null;
  grossWeight: number | null;
  amount: number | null;
  packingMaterialWeight: number | null;
  reason: string | null;
}

export interface RTVUpdateFormDto {
  id: string;
  /** GRN entity ID */
  grnNo: string | null;
  /** Company entity ID */
  companyName: string | null;
  /** Branch entity ID */
  location: string | null;
  /** Vendor entity ID */
  selectedVendor: string | null;
  /** User entity ID */
  createdBy: string | null;
  returnedGrossWeight: number | null;
  returnedNetWeight: number | null;
  totalAmt: number | null;
  returnDate: Date | string | null;
  amtWords: string | null;
  remark: string | null;
  rtvProducts: RTVProductUpdateDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft delete single DTO  (DELETE /return-to-vendor/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface SoftDeleteRTVResultDto {
  message: string;
  id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /return-to-vendor/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteRTVDto {
  ids: string[];
}

export interface BulkDeleteRTVResultDto {
  message: string;
  success?: string[];
  failed?: { id: string; reason: string }[];
}
