import { Role } from '../entity/user.entity';

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

/** Generic address shape used across user nested objects. */
export interface UserAddressDto {
  id?: string;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

/** Document permission item for the user. */
export interface UserPermissionDto {
  id?: string;
  /** ID of the document definition when used for create/update forms; name+type when from Excel */
  documentDefinition?: string | { id?: string; name?: string; documentType?: string } | null;
  canCreate?: boolean;
  canView?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canDownload?: boolean;
}

/** User status values. */
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'DRAFT';

// ─────────────────────────────────────────────────────────────────────────────
// Create User DTO  (POST /employee)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUserDto {
  // ── Personal info ─────────────────────────────────────────────────────────
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  username?: string | null;

  // ── Contact ───────────────────────────────────────────────────────────────
  primaryMobNo?: string | null;
  secondaryMobNo?: string | null;
  primaryEmail?: string | null;
  secondaryEmail?: string | null;

  // ── Work info ─────────────────────────────────────────────────────────────
  designation?: string | null;
  cugNo?: string | null;
  workEmail?: string | null;
  joiningDate?: string | Date | null;
  department?: string[];
  roles?: Role[];
  employeeId?: string | null;             // generated internally by service

  // ── Status ────────────────────────────────────────────────────────────────
  status?: UserStatus;                     // defaults to INACTIVE

  // ── Address ───────────────────────────────────────────────────────────────
  isAddressSame?: boolean | null;
  residentialAddress?: UserAddressDto | null;
  permanentAddress?: UserAddressDto | null;

  // ── Work locations (IDs — resolved by controller to Branch or Office) ─────
  /** Accepts a Branch or Office ID; controller resolves and splits into the right field */
  joiningLocation?: string | null;
  joiningOffice?: string | null;
  currentWorkLocation?: string | null;
  currentOfficeLocation?: string | null;
  otherWorkLocationInput?: string | null;

  /** Array of Branch IDs for access locations */
  accessLocation?: string[];

  /** Array of Company IDs */
  companyName?: string[];

  // ── Permissions ───────────────────────────────────────────────────────────
  permissions?: UserPermissionDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Update User DTO  (PUT /employee/:id)
// All fields optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateUserDto extends Partial<CreateUserDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// User list item DTO  (GET /employee — getAllUsers)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserListItemDto {
  id: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  username: string | null;
  primaryMobNo: string | null;
  secondaryMobNo: string | null;
  primaryEmail: string | null;
  secondaryEmail: string | null;
  joiningDate: string | Date | null;
  cugNo: string | null;
  workEmail: string | null;
  employeeId: string | null;
  status: UserStatus;
  /** Temp plain password visible in list (for admin handoff) */
  password: string | null | undefined;
  /** Resolved display name: branch name or office name */
  joiningLocation: string | null;
  currentWorkLocation: string | null;
  /** Array of branch names */
  accessLocation: string[];
  permanentAddress: UserAddressDto | null;
  residentialAddress: UserAddressDto | null;
}

export interface UserListResponseDto {
  data: UserListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// User view response DTO  (GET /employee/:id/view — full detail for display)
// Relations returned as display names (strings).
// ─────────────────────────────────────────────────────────────────────────────

export interface UserPermissionViewDto {
  id: string;
  canCreate: boolean;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canDownload: boolean;
  /** ID of the related document definition */
  documentDefinition: string | null;
}

export interface UserViewResponseDto {
  id: string;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  username: string | null;
  primaryMobNo: string | null;
  secondaryMobNo: string | null;
  primaryEmail: string | null;
  secondaryEmail: string | null;
  joiningDate: string | Date | null;
  designation: string | null;
  cugNo: string | null;
  otherWorkLocationInput: string | null;
  workEmail: string | null;
  isAddressSame: boolean | null;
  employeeId: string | null;
  status: UserStatus;
  /** Resolved display name */
  joiningLocation: string | null;
  currentWorkLocation: string | null;
  /** Array of location names */
  accessLocation: string[];
  /** Array of company names */
  companyName: string[];
  roles: Role[];
  department: string[];
  permanentAddress: UserAddressDto | null;
  residentialAddress: UserAddressDto | null;
  permissions: UserPermissionViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// User update form DTO  (GET /employee/:id/update — pre-filled form data)
// Relations returned as IDs so the form can pre-select them.
// ─────────────────────────────────────────────────────────────────────────────

export interface UserUpdateFormDto {
  id: string;
  createdDate: string | null;
  createdTime: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  username: string | null;
  primaryMobNo: string | null;
  secondaryMobNo: string | null;
  primaryEmail: string | null;
  secondaryEmail: string | null;
  joiningDate: string | Date | null;
  designation: string | null;
  cugNo: string | null;
  otherWorkLocationInput: string | null;
  workEmail: string | null;
  isAddressSame: boolean | null;
  employeeId: string | null;
  status: UserStatus;
  /** Resolved as a single ID (branch or office) for form pre-selection */
  joiningLocation: string | null;
  currentWorkLocation: string | null;
  /** Array of Branch IDs */
  accessLocation: string[];
  /** Array of Company IDs */
  companyName: string[];
  roles: Role[];
  department: string[];
  permanentAddress: UserAddressDto | null;
  residentialAddress: UserAddressDto | null;
  permissions: UserPermissionViewDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// User partial / dropdown DTO  (GET /employee/all/partial — lightweight list)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserPartialDto {
  id: string;
  /** Concatenated full name: "firstName middleName lastName" */
  fullName: string;
  employeeId: string | null;
  roles: Role[];
}

export interface UserPartialResponseDto {
  data: UserPartialDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status update DTO  (PATCH /employee/status/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateUserStatusDto {
  status: UserStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk delete DTO  (DELETE /employee/delete/multiple)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkDeleteUsersDto {
  ids: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Excel upload row DTO  (POST /employee/user/upload)
// Shape of one mapped row before it hits the service.
// ─────────────────────────────────────────────────────────────────────────────

export interface UserExcelRowDto {
  firstName?: string;
  lastName?: string;
  username?: string;
  primaryMobNo?: string;
  secondaryMobNo?: string;
  primaryEmail?: string;
  secondaryEmail?: string;
  employeeId?: string;
  designation?: string;
  cugNo?: string;
  workEmail?: string;
  joiningDate?: string;
  department?: string[];
  roles?: string[];
  status?: string;
  isAddressSame?: boolean;
  otherWorkLocationInput?: string;
  residentialAddress?: UserAddressDto;
  permanentAddress?: UserAddressDto;
  companyName?: { name?: string; officeAddress?: string };
  joiningLocation?: { name?: string };
  joiningOffice?: { name?: string };
  currentWorkLocation?: { name?: string };
  currentOfficeLocation?: { name?: string };
  accessLocation?: string;
  permissions?: UserPermissionDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow hierarchy DTO  (GET /employee/all/partial?id=...)
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowHierarchyItemDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  employeeId: string | null;
  designation: string | null;
  roles: Role[];
}
