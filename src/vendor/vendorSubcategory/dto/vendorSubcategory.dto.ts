// ─────────────────────────────────────────────────────────────────────────────
// Vendor Subcategory DTOs
// ─────────────────────────────────────────────────────────────────────────────

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreateVendorSubcategoryDto {
  name: string;
  /** VendorCategory id */
  category: string;
}

// ── Update ────────────────────────────────────────────────────────────────────

export interface UpdateVendorSubcategoryDto {
  name?: string;
  /** VendorCategory id */
  category?: string;
}

// ── Response (single record) ──────────────────────────────────────────────────

export interface VendorSubcategoryResponseDto {
  id: string;
  name: string;
  /** Category id — used by update form to pre-select the dropdown */
  category: string | null;
}

// ── List item ─────────────────────────────────────────────────────────────────

export interface VendorSubcategoryListItemDto {
  id: string;
  name: string;
  /** Category name — flattened for list display */
  category: string | null;
}

// ── List response (paginated) ─────────────────────────────────────────────────

export interface VendorSubcategoryListResponseDto {
  data: VendorSubcategoryListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ── Dropdown item (GET /getSubcategories) ────────────────────────────────────

export interface VendorSubcategoryDropdownDto {
  id: string;
  name: string;
}

// ── Bulk delete ───────────────────────────────────────────────────────────────

export interface BulkDeleteVendorSubcategoryDto {
  ids: string[];
}
