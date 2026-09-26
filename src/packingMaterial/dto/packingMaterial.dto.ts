

// ─────────────────────────────────────────────────────────────────────────────
// Create Packing Material DTO  (POST /packingMaterial)
// ─────────────────────────────────────────────────────────────────────────────

import { UseFor } from "../entity/packingMaterial.entity";

export interface CreatePackingMaterialDto {
  packagingMaterialName?: string | null;
  packagingMaterialWeight?: number | null;
  packagingMaterialDescription?: string | null;
  containsQuantity?: number | null;
  useFor?: UseFor | null;
  /** UOM entity ID */
  uom?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Packing Material DTO  (PATCH /packingMaterial/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdatePackingMaterialDto extends Partial<CreatePackingMaterialDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Packing Material list item DTO  (GET /packingMaterial — getAll)
// ─────────────────────────────────────────────────────────────────────────────

export interface PackingMaterialListItemDto {
  id: string;
  packagingMaterialName: string | null;
  packagingMaterialWeight: number | null;
  packagingMaterialDescription: string | null;
  /** Resolved UOM unit string (e.g. "kg", "pcs") */
  uom: string | null;
  containsQuantity: number | null;
}

export interface PackingMaterialListResponseDto {
  formatResponse: PackingMaterialListItemDto[];
  data1: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Packing Material detail DTO  (GET /packingMaterial/:id — getMaterialById)
// Returns UOM as ID so the form can pre-select it.
// ─────────────────────────────────────────────────────────────────────────────

export interface PackingMaterialDetailDto {
  id: string;
  packagingMaterialName: string | null;
  packagingMaterialWeight: number | null;
  packagingMaterialDescription: string | null;
  useFor: UseFor | null;
  /** UOM entity ID */
  uom: string | null;
  containsQuantity: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Packing Material partial DTO  (GET /packingMaterial/all/partial — dropdown)
// ─────────────────────────────────────────────────────────────────────────────

export interface PackingMaterialPartialDto {
  id: string;
  packagingMaterialName: string | null;
  packagingMaterialWeight: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Packing Material dropdown DTO  (findAllPackingMaterial — used by other services)
// ─────────────────────────────────────────────────────────────────────────────

export interface PackingMaterialDropdownDto {
  id: string;
  name: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /packingMaterial/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeletePackingMaterialDto {
  ids: string[];
}

export interface BulkDeletePackingMaterialResultDto {
  success: string[];
  failed: { id: string; reason: string }[];
  message: string;
}
