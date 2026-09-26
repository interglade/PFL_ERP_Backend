

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

import { OFFICE_TYPE } from "../entity/offices.entity";

export interface OfficeAddressDto {
  id?: string;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Office DTO  (POST /location-offices/:officeType)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateOfficeDto {
  name: string;
  officeEmail?: string | null;
  contactNumber?: string | null;
  cFirstName?: string | null;
  cMiddleName?: string | null;
  cLastName?: string | null;
  notes?: string | null;
  /** Injected from route param by controller */
  type?: OFFICE_TYPE;
  address?: OfficeAddressDto | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Office DTO  (PATCH /location-offices/:officeType/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateOfficeDto extends Partial<CreateOfficeDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Office detail DTO  (GET /location-offices/:officeType/:id — getOfficeByIdAndType)
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeDetailDto {
  id: string;
  name: string;
  officeEmail?: string | null;
  contactNumber?: string | null;
  cFirstName?: string | null;
  cMiddleName?: string | null;
  cLastName?: string | null;
  notes?: string | null;
  type: OFFICE_TYPE;
  address: OfficeAddressDto | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Office list item DTO  (GET /location-offices/:officeType — getOfficesByType1)
// paginated list; address has subset of fields
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeListItemDto {
  id: string;
  name: string;
  officeEmail?: string | null;
  contactNumber?: string | null;
  cFirstName?: string | null;
  cMiddleName?: string | null;
  cLastName?: string | null;
  notes?: string | null;
  type: OFFICE_TYPE;
  address: Pick<OfficeAddressDto, 'id' | 'location' | 'city' | 'state' | 'pincode'> | null;
}

export interface OfficeListResponseDto {
  data: OfficeListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Office filter DTO  (GET /location-offices/filterData/filter/all)
// Lightweight shape: only id, name, type
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeFilterItemDto {
  id: string;
  name: string;
  type: OFFICE_TYPE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Office search DTO  (GET /location-offices?search=type — getOfficesByType)
// Full entity with address relation
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeSearchItemDto {
  id: string;
  name: string;
  officeEmail?: string | null;
  contactNumber?: string | null;
  cFirstName?: string | null;
  cMiddleName?: string | null;
  cLastName?: string | null;
  notes?: string | null;
  type: OFFICE_TYPE;
  address: OfficeAddressDto | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /location-offices/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteOfficeDto {
  ids: string[];
}

export interface BulkDeleteOfficeResultDto {
  affected?: number | null;
}
