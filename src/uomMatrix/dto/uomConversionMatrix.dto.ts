// ─────────────────────────────────────────────────────────────────────────────
// Create UOM Conversion Matrix DTO  (POST /uom-conversion-matrix)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUOMConversionMatrixDto {
  /** ID of the source UOM */
  fromUOM: string;
  /** ID of the target UOM */
  toUOM: string;
  conversionFactor: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update UOM Conversion Matrix DTO  (PATCH /uom-conversion-matrix/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateUOMConversionMatrixDto {
  fromUOM?: string | null;
  toUOM?: string | null;
  conversionFactor?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// UOM Conversion Matrix list item DTO  (GET /uom-conversion-matrix — getAll)
// Relations resolved to display strings (unit names).
// ─────────────────────────────────────────────────────────────────────────────

export interface UOMConversionMatrixListItemDto {
  id: string;
  conversionFactor: number;
  /** Resolved UOM unit string e.g. "kg" */
  fromUOM: string | null;
  /** Resolved UOM unit string e.g. "g" */
  toUOM: string | null;
}

export interface UOMConversionMatrixListResponseDto {
  data: UOMConversionMatrixListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UOM Conversion Matrix detail DTO  (GET /uom-conversion-matrix/:id — getById)
// Relations resolved to IDs for form pre-selection.
// ─────────────────────────────────────────────────────────────────────────────

export interface UOMConversionMatrixDetailDto {
  id: string;
  conversionFactor: number;
  /** UOM entity ID */
  fromUOM: string | null;
  /** UOM entity ID */
  toUOM: string | null;
}

// getByIdForUpdate returns the same shape as getById
export type UOMConversionMatrixUpdateFormDto = UOMConversionMatrixDetailDto;

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /uom-conversion-matrix/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteUOMConversionMatrixDto {
  ids: string[];
}

export interface BulkDeleteUOMConversionMatrixResultDto {
  affected?: number | null;
}
