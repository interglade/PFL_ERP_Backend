import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Category DTOs
// ─────────────────────────────────────────────────────────────────────────────

// ── Create ────────────────────────────────────────────────────────────────────

export const createVendorCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Category name is required'),
  }),
});

export interface CreateVendorCategoryDto {
  name: string;
}

// ── Get all ───────────────────────────────────────────────────────────────────

export const getAllVendorCategoriesSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    sort: z.string().optional(),
    categoryId: z.string().uuid().optional(),
  }),
});

// ── Get by ID ─────────────────────────────────────────────────────────────────

export const getVendorCategoryByIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid category ID'),
  }),
});

// ── Update ────────────────────────────────────────────────────────────────────

export const updateVendorCategorySchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid category ID'),
  }),
  body: z.object({
    name: z.string().min(1, 'Category name is required').optional(),
  }),
});

export interface UpdateVendorCategoryDto {
  name?: string;
}

// ── Delete ────────────────────────────────────────────────────────────────────

export const deleteVendorCategorySchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid category ID'),
  }),
});

// ── Response (single record) ──────────────────────────────────────────────────

export interface VendorCategoryResponseDto {
  id: string;
  name: string;
}

// ── List response (paginated) ─────────────────────────────────────────────────

export interface VendorCategoryListResponseDto {
  data: VendorCategoryResponseDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ── Bulk delete ───────────────────────────────────────────────────────────────

export const bulkDeleteVendorCategorySchema = z.object({
  body: z.object({
    ids: z.array(z.string().uuid()).min(1, 'ids must be a non-empty array'),
  }),
});

export interface BulkDeleteVendorCategoryDto {
  ids: string[];
}
