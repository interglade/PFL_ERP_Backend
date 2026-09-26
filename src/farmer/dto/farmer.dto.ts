import { Status } from "../../utils/status.enum";
import { LandHoldingStatus, LandStatus } from "../entity/farmer.entity";

;

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-types (mirror the frontend's Address model)
// ─────────────────────────────────────────────────────────────────────────────

export interface AddressDto {
  id?: string;
  address1?: string;
  address2?: string;
  location?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crops  (mirrors frontend ICrops)
// ─────────────────────────────────────────────────────────────────────────────

export interface CropDto {
  /** Present on existing crops (updates) */
  id?: string;
  /** Product id – nullable to match frontend ICrops.crop */
  crop: string | null;
  variety: string | null;
  noOfPlants: number | null;
  pruningDate: string | null;
  expectedHarvestDate: string | null;
  expectedQuantityInTonnes: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Land status union types  (mirrors frontend LandStatusType / LandHoldingStatusType)
// ─────────────────────────────────────────────────────────────────────────────

export type LandStatusType = LandStatus | 'Cultivable' | 'Fallow' | 'Irrigated' | 'Non-Irrigated';
export type LandHoldingStatusType = LandHoldingStatus | 'Owned' | 'Leased' | 'Shared' | 'Encumbered';

// ─────────────────────────────────────────────────────────────────────────────
// Create Farmer DTO  (mirrors frontend IFarmer — body sent on POST /farmers)
//
// File fields (idProofCopy, farmerPhoto, farmPhoto, sevenTwelveCopy) arrive as
// multipart file uploads and are resolved to S3 URL strings by the upload
// middleware before reaching the service.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateFarmerDto {
  // ── Personal details ──────────────────────────────────────────────────────
  farmerfName: string | null;
  farmermName: string | null;
  farmerlName: string | null;
  primaryMobileNo: string | null;
  secondaryMobileNo: string | null;
  email: string | null;
  gender: string | null;
  dob: string | null;
status?:Status
  // ── Address ───────────────────────────────────────────────────────────────
  residensialAddress: AddressDto;
  farmAddress: AddressDto;

  // ── Identity proof ────────────────────────────────────────────────────────
  idProofNo: string | null;
  /** Resolved to an S3 URL string by the upload middleware */
  idProofCopy: string | null;

  // ── Farm details ──────────────────────────────────────────────────────────
  landHoldingStatus: LandHoldingStatusType | null;
  landStatus: LandStatusType | null;
  totalLandArea: number | null;
  cultivationArea: number | null;
  sevenTwelveNo: string | null;
  /** Resolved to an S3 URL string by the upload middleware */
  sevenTwelveCopy: string | null;

  // ── Photos ────────────────────────────────────────────────────────────────
  /** Resolved to an S3 URL string by the upload middleware */
  farmerPhoto: string | null;
  /** Resolved to an S3 URL string by the upload middleware */
  farmPhoto: string | null;

  // ── Sell info ─────────────────────────────────────────────────────────────
  howDoYouSell: string | null;

  // ── Crops ─────────────────────────────────────────────────────────────────
  crops: CropDto[];

  // ── Optional / server-resolved fields ────────────────────────────────────
  farmerGrading?: string;
  farmerType?: string;
  /** Injected by the controller from res.locals.user.id */
  createdBy?: string;
  // farmerCode and status are generated internally by the service — not accepted from the client
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Farmer DTO  (all fields optional for PATCH / PUT)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateFarmerDto extends Partial<CreateFarmerDto> {}

// ─────────────────────────────────────────────────────────────────────────────
// Farmer list item DTO  (returned by GET /farmers — getAllFarmers)
// Addresses are flattened to a single display string for list views.
// ─────────────────────────────────────────────────────────────────────────────

export interface FarmerListItemDto {
  id: string;
  status: Status;
  farmerCode: string;
  farmerfName: string | null;
  farmermName: string | null;
  farmerlName: string | null;
  primaryMobileNo: string | null;
  secondaryMobileNo: string | null;
  email: string | null;
  gender: string | null;
  dob: Date | null;
  totalLandArea: number | null;
  cultivationArea: number | null;
  landHoldingStatus: LandHoldingStatusType | null;
  landStatus: LandStatusType | null;
  idProofNo: string | null;
  /** Flattened address string — e.g. "123 Main St Mumbai Maharashtra 400001" */
  residensialAddress: string;
  /** Flattened address string */
  farmAddress: string;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
}

export interface FarmerListResponseDto {
  data: FarmerListItemDto[];
  meta: {
    total: number;
    page: number | undefined;
    pages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Partial farmer data  (mirrors frontend IFarmerPartialData — list / search responses)
// ─────────────────────────────────────────────────────────────────────────────

export interface FarmerPartialDataDto {
  id: string;
  fullName: string;
  primaryMobileNo: string;
  secondaryMobileNo: string;
  email: string;
  farmerCode: string;
  residensialAddress: AddressDto;
  farmAddress: AddressDto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Approve / reject DTO
// ─────────────────────────────────────────────────────────────────────────────

export interface ApproveFarmerDto {
  status: Status.APPROVED | Status.REJECTED;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get Farmer Response DTO  (mirrors frontend IFarmer — returned by GET /farmers/:id)
//
// File fields are S3 URL strings on the backend (frontend sends File objects
// on upload, but receives string URLs back from the API).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Delete result DTOs
// ─────────────────────────────────────────────────────────────────────────────

/** Returned by deleteFarmer service method (boolean true) — no extra fields */
export interface DeleteFarmerResultDto {
  success: boolean;
}

/** Returned by softDeleteFarmers service method */
export interface BulkDeleteFarmerResultDto {
  affected?: number | null;


  createdDate?: string | null;
  createdTime?: string | null;

  // ── Status & codes ────────────────────────────────────────────────────────
  /** Full lifecycle: draft → pending → approved | rejected | notapproved */
  status?: Status;
  farmerCode?: string;
  farmerGrading?: string;
  farmerType?: string;

  // ── Personal details ──────────────────────────────────────────────────────
  farmerfName: string | null;
  farmermName: string | null;
  farmerlName: string | null;
  primaryMobileNo: string | null;
  secondaryMobileNo: string | null;
  email: string | null;
  gender: string | null;
  dob: string | null;

  // ── Address ───────────────────────────────────────────────────────────────
  residensialAddress: AddressDto;
  farmAddress: AddressDto;

  // ── Identity proof ────────────────────────────────────────────────────────
  idProofNo: string | null;
  /** S3 URL string (frontend IFarmer has File | null — on response it is always a URL) */
  idProofCopy: string | null;
  idProofCopyDownloadUrl: string | null;

  // ── Sell info ─────────────────────────────────────────────────────────────
  howDoYouSell: string | null;

  // ── Farm details ──────────────────────────────────────────────────────────
  landHoldingStatus: LandHoldingStatusType | null;
  landStatus: LandStatusType | null;
  totalLandArea: number | null;
  cultivationArea: number | null;
  sevenTwelveNo: string | null;
  /** S3 URL string */
  sevenTwelveCopy: string | null;
  sevenTwelveCopyDownloadUrl: string | null;

  // ── Photos ────────────────────────────────────────────────────────────────
  /** S3 URL string (frontend IFarmer has File | null — on response it is always a URL) */
  farmerPhoto: string | null;
  farmerPhotoDownloadUrl: string | null;
  /** S3 URL string */
  farmPhoto: string | null;
  farmPhotoDownloadUrl: string | null;

  // ── Crops ─────────────────────────────────────────────────────────────────
  crops: CropDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Farmer detail response DTO  (used by getfarmerbyidforview & getfarmerbyidforupdate)
// ─────────────────────────────────────────────────────────────────────────────

export interface FarmerResponseDto {
  id: string;
  farmerfName: string | null;
  farmermName: string | null;
  farmerlName: string | null;
  gender?: string | null;
  status?: string | null;
  dob?: string | null;
  idProofNo?: string | null;
  idProofCopy?: string | null;
  howDoYouSell?: string | null;
  landHoldingStatus?: LandHoldingStatusType | null;
  landStatus?: LandStatusType | null;
  totalLandArea?: number | null;
  cultivationArea?: number | null;
  sevenTwelveNo?: string | null;
  sevenTwelveCopy?: string | null;
  primaryMobileNo?: string | null;
  secondaryMobileNo?: string | null;
  email?: string | null;
  farmerCode?: string | null;
  farmerPhoto?: string | null;
  farmPhoto?: string | null;
  createdBy?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  approvedBy?: string | null;
  residensialAddress?: AddressDto | Record<string, any>;
  farmAddress?: AddressDto | Record<string, any>;
  crops?: CropDto[];
}
