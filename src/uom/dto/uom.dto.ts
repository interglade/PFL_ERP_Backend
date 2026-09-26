// ─────────────────────────────────────────────────────────────────────────────
// Create UOM DTO  (POST /uoms)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUOMDto {
  unit: string;
  abbreviation?: string | null;
  description?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update UOM DTO  (PATCH /uoms/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateUOMDto extends Partial<CreateUOMDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// UOM list item DTO  (GET /uoms — getAll)
// ─────────────────────────────────────────────────────────────────────────────

export interface UOMListItemDto {
  id: string;
  unit: string;
  abbreviation: string | null;
  description: string | null;
}

export interface UOMListResponseDto {
  data: UOMListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UOM partial DTO  (GET /uoms/getAll/partialdata — dropdown / search)
// ─────────────────────────────────────────────────────────────────────────────

export interface UOMPartialDto {
  id: string;
  unit: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UOM detail DTO  (GET /uoms/:id — getById)
// ─────────────────────────────────────────────────────────────────────────────

export interface UOMDetailDto {
  id: string;
  unit: string;
  abbreviation: string | null;
  description: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /uoms/multiple-delete/delete)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteUOMDto {
  ids: string[];
}
