

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types
// ─────────────────────────────────────────────────────────────────────────────

import { AccountType } from "../../../customer/addcustomer/entity/bankDetailsCust.entity";
import { Status } from "../../../utils/status.enum";
import { VendorClassification } from "../entity/vendor.entity";

/** Generic address shape used across vendor nested objects. */
export interface VendorAddressDto {
  id?: string;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

/** Contact person details for the vendor (mirrors VendorSaleInfo entity). */
export interface VendorSaleInfoDto {
  id?: string;
  contactFName?: string | null;
  contactMName?: string | null;
  contactLName?: string | null;
  directContactNumber?: string | null;
  mobileNumber?: string | null;
  email?: string | null;
}

/** Bank details for the vendor (mirrors BankDetailsvend entity). */
export interface VendorBankDetailsDto {
  id?: string;
  beneficiaryFName?: string | null;
  beneficiaryMName?: string | null;
  beneficiaryLName?: string | null;
  bankName?: string | null;
  branchAddress?: VendorAddressDto | null;
  typeOfAcc?: AccountType | null;
  ifscCode?: string | null;
  swiftNo?: string | null;
  invoiceCurrency?: string | null;
  /** Resolved to an S3 URL string by the upload middleware */
  cancelledChequeCopy?: string | null;
  ifCancelledCheque?: boolean | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Vendor DTO  (POST /vendors)
//
// File fields (gstnCopy, panCardCopy, msmeCopy, cancelledChequeCopy) arrive as
// multipart uploads and are resolved to S3 URL strings by the controller
// before the service receives them.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateVendorDto {
  // ── Company info ──────────────────────────────────────────────────────────
  companyName?: string | null;
  classification?: VendorClassification | null;
  vendorGrade?: string | null;
  vendorCode?: string;                   // generated internally — not accepted from client
  status?: Status;                       // forced to 'draft' by service

  // ── Office contact ────────────────────────────────────────────────────────
  officeContactNo?: string | null;
  officeEmail?: string | null;
  website?: string | null;

  // ── Office address ────────────────────────────────────────────────────────
  officeAddress?: VendorAddressDto | null;

  // ── Tax & regulatory ──────────────────────────────────────────────────────
  gstn?: string | null;
  /** Resolved to an S3 URL string */
  gstnCopy?: string | null;
  ifGstnCopy?: boolean | null;

  panNo?: string | null;
  /** Resolved to an S3 URL string */
  panCardCopy?: string | null;
  ifPanCardCopy?: boolean | null;

  msmeNo?: string | null;
  /** Resolved to an S3 URL string */
  msmeCopy?: string | null;
  ifMsmeCopy?: boolean | null;

  // ── Business info ─────────────────────────────────────────────────────────
  dateOfIncorporation?: string | Date | null;
  inFandVBusinessSince?: string | null;
  creditTerms?: number | null;
  proposedPaymentTerms?: number | null;
  paymentMode?: string | null;
  tradeLicenseNumber?: string | null;
  otherProductOrService?: string | null;
  anyDetailsTeamAndInfra?: string | null;

  // ── Logistics ─────────────────────────────────────────────────────────────
  dispatchCenter?: string | null;
  warehouseLocations?: string | null;
  packingCenterLocation?: string | null;

  // ── Product relations ─────────────────────────────────────────────────────
  /** ID of the main product */
  mainProduct?: { id: string } | string | null;
  /** Array of product IDs or objects with id */
  listOfAllProducts?: Array<{ id: string } | string> | null;

  // ── Packing material relations ────────────────────────────────────────────
  /** ID of the main packing material */
  mainPackingMaterial?: { id: string } | string | null;
  /** Array of packing material IDs or objects with id */
  listOfPackingMaterial?: Array<{ id: string } | string> | null;

  // ── Category & subcategory ────────────────────────────────────────────────
  category?: { id: string } | string | null;
  subcategory?: { id: string } | string | null;

  // ── Contact person (sale info) ────────────────────────────────────────────
  vendorSaleInfo?: VendorSaleInfoDto | null;

  // ── Bank details ──────────────────────────────────────────────────────────
  vendorBankDetails?: VendorBankDetailsDto | null;

  // ── Reference 1 ───────────────────────────────────────────────────────────
  ref1FName?: string | null;
  ref1MName?: string | null;
  ref1LName?: string | null;
  ref1PrimaryCNumb?: string | null;
  ref1AltrCNumb?: string | null;
  ref1Email?: string | null;
  ref1Address?: VendorAddressDto | null;

  // ── Reference 2 ───────────────────────────────────────────────────────────
  ref2FName?: string | null;
  ref2MName?: string | null;
  ref2LName?: string | null;
  ref2PrimaryCNumb?: string | null;
  ref2AltrCNumb?: string | null;
  ref2Email?: string | null;
  ref2Address?: VendorAddressDto | null;

  // ── Server-resolved fields ────────────────────────────────────────────────
  /** Injected by the controller from res.locals.user.id */
  createdBy?: string;
  registeredDate?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Vendor DTO  (PUT /vendors/:id)
// All fields are optional.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateVendorDto extends Partial<CreateVendorDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor list item DTO  (returned by GET /vendors — getAllVendors)
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorListItemDto {
  id: string;
  vendorCode: string | null;
  companyName: string | null;
  classification: VendorClassification | null;
  status: Status;
  vendorGrade?: string | null;
  officeContactNo: string | null;
  officeEmail: string | null;
  /** Formatted as a display string in list views */
  officeAddress?: string | null;
  gstn?: string | null;
  panNo?: string | null;
  msmeNo?: string | null;
  tradeLicenseNumber?: string | null;
  paymentMode?: string | null;
  proposedPaymentTerms?: number | null;
  creditTerms?: number | null;
  dispatchCenter?: string | null;
  warehouseLocations?: string | null;
  packingCenterLocation?: string | null;
  mainProduct?: string | null;
  listOfAllProducts?: string | null;
  mainPackingMaterial?: string | null;
  listOfPackingMaterial?: string | null;
  category: string | null;
  subcategory: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

export interface VendorListResponseDto {
  data: VendorListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor view response DTO  (GET /vendors/view/:id — full detail for display)
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorViewResponseDto {
  id: string;
  vendorCode: string | null;
  companyName: string | null;
  classification: VendorClassification | null;
  status: Status;
  vendorGrade: string | null;
  paymentMode: string | null;
  creditTerms: number | null;
  proposedPaymentTerms: number | null;
  otherProductOrService: string | null;
  dateOfIncorporation: string | Date | null;
  inFandVBusinessSince: string | null;
  dispatchCenter: string | null;
  warehouseLocations: string | null;
  packingCenterLocation: string | null;
  tradeLicenseNumber: string | null;
  anyDetailsTeamAndInfra: string | null;

  // ── Office ────────────────────────────────────────────────────────────────
  officeAddress: VendorAddressDto | null;
  officeContactNo: string | null;
  officeEmail: string | null;
  website: string | null;

  // ── Tax & regulatory ──────────────────────────────────────────────────────
  gstn: string | null;
  gstnCopy: string | null;
  ifGstnCopy: boolean | null;
  panNo: string | null;
  panCardCopy: string | null;
  ifPanCardCopy: boolean | null;
  msmeNo: string | null;
  msmeCopy: string | null;
  ifMsmeCopy: boolean | null;

  // ── Category ─────────────────────────────────────────────────────────────
  category: string | null;       // name for view
  subcategory: string | null;    // name for view

  // ── Products ──────────────────────────────────────────────────────────────
  mainProduct: string | null;                     // name for view
  listOfAllProducts: string[] | null;             // names for view

  // ── Packing materials ─────────────────────────────────────────────────────
  mainPackingMaterial: string | null;             // name for view
  listOfPackingMaterial: string[] | null;         // names for view

  // ── Contact person ────────────────────────────────────────────────────────
  vendorSaleInfo: VendorSaleInfoDto | null;

  // ── Bank details ──────────────────────────────────────────────────────────
  vendorBankDetails: (VendorBankDetailsDto & { branchAddress?: VendorAddressDto | null }) | null;

  // ── Reference 1 ───────────────────────────────────────────────────────────
  ref1FName: string | null;
  ref1MName: string | null;
  ref1LName: string | null;
  ref1PrimaryCNumb: string | null;
  ref1AltrCNumb: string | null;
  ref1Email: string | null;
  ref1Address: VendorAddressDto | null;

  // ── Reference 2 ───────────────────────────────────────────────────────────
  ref2FName: string | null;
  ref2MName: string | null;
  ref2LName: string | null;
  ref2PrimaryCNumb: string | null;
  ref2AltrCNumb: string | null;
  ref2Email: string | null;
  ref2Address: VendorAddressDto | null;

  // ── Audit ─────────────────────────────────────────────────────────────────
  createdBy: string | null;
  approvedBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor update form DTO  (GET /vendors/update/:id — pre-filled form data)
// Relations returned as IDs (not names) so the form can pre-select them.
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorUpdateFormDto {
  id: string;
  vendorCode: string | null;
  companyName: string | null;
  classification: VendorClassification | null;
  status: Status;
  vendorGrade: string | null;
  paymentMode: string | null;
  creditTerms: number | null;
  proposedPaymentTerms: number | null;
  otherProductOrService: string | null;
  dateOfIncorporation: string | Date | null;
  inFandVBusinessSince: string | null;
  dispatchCenter: string | null;
  warehouseLocations: string | null;
  packingCenterLocation: string | null;
  tradeLicenseNumber: string | null;
  anyDetailsTeamAndInfra: string | null;

  // ── Office ────────────────────────────────────────────────────────────────
  officeAddress: VendorAddressDto | null;
  officeContactNo: string | null;
  officeEmail: string | null;
  website: string | null;

  // ── Tax & regulatory ──────────────────────────────────────────────────────
  gstn: string | null;
  gstnCopy: string | null;
  ifGstnCopy: boolean | null;
  panNo: string | null;
  panCardCopy: string | null;
  ifPanCardCopy: boolean | null;
  msmeNo: string | null;
  msmeCopy: string | null;
  ifMsmeCopy: boolean | null;

  // ── Category — IDs for form pre-selection ─────────────────────────────────
  category: string | null;
  subcategory: string | null;

  // ── Products — IDs for form pre-selection ────────────────────────────────
  mainProduct: string | null;
  listOfAllProducts: string[];

  // ── Packing materials — IDs for form pre-selection ───────────────────────
  mainPackingMaterial: string | null;
  listOfPackingMaterial: string[];

  // ── Contact person ────────────────────────────────────────────────────────
  vendorSaleInfo: VendorSaleInfoDto | null;

  // ── Bank details ──────────────────────────────────────────────────────────
  vendorBankDetails: (VendorBankDetailsDto & { branchAddress?: VendorAddressDto | null }) | null;

  // ── Reference 1 ───────────────────────────────────────────────────────────
  ref1FName: string | null;
  ref1MName: string | null;
  ref1LName: string | null;
  ref1PrimaryCNumb: string | null;
  ref1AltrCNumb: string | null;
  ref1Email: string | null;
  ref1Address: VendorAddressDto | null;

  // ── Reference 2 ───────────────────────────────────────────────────────────
  ref2FName: string | null;
  ref2MName: string | null;
  ref2LName: string | null;
  ref2PrimaryCNumb: string | null;
  ref2AltrCNumb: string | null;
  ref2Email: string | null;
  ref2Address: VendorAddressDto | null;

  // ── Audit ─────────────────────────────────────────────────────────────────
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor dropdown DTO  (GET /vendors/bysearch/getvendors — lightweight search)
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorDropdownDto {
  id: string;
  vendorCode: string | null;
  companyName: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor filter DTO  (GET /vendors/filter/vendors — advanced search/filter)
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorFilterDto {
  classification?: string;
  categoryId?: string;
  subcategoryId?: string;
  pincode?: string;
  city?: string;
  state?: string;
  productId?: string;
  page?: number;
  limit?: number;
}
