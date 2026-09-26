// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

export interface EodProductInputDto {
  /** SKU entity ID */
  sku?: string | { id: string } | null;
  /** UOM entity ID */
  uom?: string | { id: string } | null;
  qty?: number | null;
  totalWeightInKg?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create EOD Stock DTO  (POST /eodStock)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateEodStockDto {
  /** Company entity ID */
  companyName?: string | null;
  /** Branch entity ID */
  location?: string | null;
  stockDate?: string | Date | null;
  submission?: string | null;
  comments?: string | null;
  /** Injected from res.locals by controller */
  submittedBy?: string;
  eodNo?: string;
  eodProducts?: EodProductInputDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Update EOD Stock DTO  (PATCH /eodStock/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateEodStockDto extends Partial<CreateEodStockDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// EOD Stock detail DTO  (GET /eodStock/:id — getEodStockById)
// Relations returned as objects with id+name.
// ─────────────────────────────────────────────────────────────────────────────

export interface EodProductDetailDto {
  id: string;
  qty: number | null;
  totalWeightInKg: number | null;
  sku: { id: string; name: string } | null;
  uom: { id: string; name: string } | null;
}

export interface EodStockDetailDto {
  id: string;
  createdDate: string | null;
  createdTime: string | null;
  stockDate: Date | null;
  submission: string | null;
  comments: string | null;
  submittedBy: string | null;
  companyName: { id: string; companyName: string } | null;
  location: { id: string; name: string } | null;
  eodProducts: EodProductDetailDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// EOD Stock view DTO  (GET /eodStock/view/:id — getEodStockByIdForView)
// Full detail with document metadata. Relations resolved to display names.
// ─────────────────────────────────────────────────────────────────────────────

export interface EodProductViewDto {
  id: string;
  qty: number | null;
  totalWeightInKg: number | null;
  sku: string | null;
  uom: string | null;
}

export interface EodStockViewDto {
  id: string;
  createdDate: string | null;
  createdTime: string | null;
  stockDate: Date | null;
  submission: string | null;
  comments: string | null;
  submittedBy: string | null;
  /** Company name string */
  companyName: string | null;
  /** Branch name string */
  location: string | null;
  eodProducts: EodProductViewDto[];
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
// EOD Stock update-form DTO  (GET /eodStock/update/:id — getEodStockByIdForUpdate)
// Relations returned as IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface EodProductUpdateDto {
  id: string;
  qty: number | null;
  totalWeightInKg: number | null;
  /** SKU entity ID */
  sku: string | null;
  /** UOM entity ID */
  uom: string | null;
}

export interface EodStockUpdateFormDto {
  id: string;
  createdDate: string | null;
  createdTime: string | null;
  stockDate: Date | null;
  submission: string | null;
  comments: string | null;
  submittedBy: string | null;
  /** Company entity ID */
  companyName: string | null;
  /** Branch entity ID */
  location: string | null;
  eodProducts: EodProductUpdateDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// EOD Stock list item DTO  (GET /eodStock — getAllEodStocks)
// ─────────────────────────────────────────────────────────────────────────────

export interface EodStockListItemDto {
  id: string;
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  eodNo: string | null;
  stockDate: Date | null;
  submission: string | null;
  comments: string | null;
  submittedBy: string | null;
  companyName: string | null;
  location: string | null;
}

export interface EodStockListResponseDto {
  data: EodStockListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /eodStock/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteEodStockDto {
  ids: string[];
}

export interface BulkDeleteEodStockResultDto {
  success: string[];
  failed: { id: string; reason: string }[];
  message: string;
}
