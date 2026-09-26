import { BranchType } from '../entity/branches.entity';

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

export interface BranchAddressDto {
  id?: string;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Branch DTO  (POST /location-branches/:branchType)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateBranchDto {
  name: string;
  /** Injected from route param by controller */
  type?: BranchType;
  cFirstName?: string | null;
  cMiddleName?: string | null;
  cLastName?: string | null;
  contactNumber?: string | null;
  notes?: string | null;
  totalCapacity?: number | null;
  currentCapacity?: number | null;
  balanceCapacity?: number | null;
  prefix?: string | null;
  address?: BranchAddressDto | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Branch DTO  (PATCH /location-branches/:branchType/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateBranchDto extends Partial<CreateBranchDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Branch detail DTO  (GET /location-branches/:id — getBranchByIdAndType)
// ─────────────────────────────────────────────────────────────────────────────

export interface BranchDetailDto {
  id: string;
  name: string;
  type: BranchType;
  cFirstName: string | null;
  cMiddleName: string | null;
  cLastName: string | null;
  contactNumber: string | null;
  notes: string | null;
  totalCapacity: number | null;
  currentCapacity: number | null;
  balanceCapacity: number | null;
  prefix: string | null;
  address: BranchAddressDto | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch list item DTO  (GET /location-branches/getall/:branchType — paginated)
// ─────────────────────────────────────────────────────────────────────────────

export interface BranchListItemDto {
  id: string;
  type: BranchType;
  name: string;
  /** Concatenated: "cFirstName cMiddleName cLastName" */
  contactPerson: string;
  contact: string;
  totalCapacity: number | null;
  currentCapacity: number | null;
  balanceCapacity: number | null;
  address: Pick<BranchAddressDto, 'id' | 'address1' | 'address2' | 'city' | 'location' | 'pincode' | 'state'> | null;
}

export interface BranchListResponseDto {
  data: BranchListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch filter item DTO  (GET /location-branches/filterData/filter/all)
// Lightweight: only id, name, type
// ─────────────────────────────────────────────────────────────────────────────

export interface BranchFilterItemDto {
  id: string;
  name: string;
  type: BranchType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /location-branches/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteBranchDto {
  ids: string[];
}

export interface DeletedBranchItemDto {
  id: string;
  name: string;
  type: BranchType;
}

export interface BulkDeleteBranchResultDto {
  affected?: number | null;
  deleted: DeletedBranchItemDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete single branch result DTO
// ─────────────────────────────────────────────────────────────────────────────

export interface DeleteBranchResultDto {
  name: string;
  type: BranchType;
}
