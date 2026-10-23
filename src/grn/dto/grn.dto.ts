import { ammountStatus, Source } from "../../utils/status.enum";
import { GrnDeliveryMode, GrnType, LocationType, PurchaseType } from "../entity/grn.entity";


export interface GrnProductDto {
  id?: string;
  quantity?: number;
  unitPrice?: number;
  productName?: string | null;
  variant?: string | null;
  uom?: string | null;
  /** Packaging material id (create / update / edit form) or name (view). */
  packagingMaterial?: string | null;
  amount?: number;
  rtv?: boolean;
  netWeight?: number;
  grossWeight?: number;
  packingMaterialWeight?: number;
  revisedRate?: number;
  revisedQuantity?: number;
  purchaseDate?: string | Date | null;
  dispatchDate?: string | Date | null;
  deliveryDate?: string | Date | null;
  expectedHarvestDate?: string | Date | null;
}

export interface PaymentInfoDto {
  id?: string | null;
  paymentMode?: string | null;
  paymentDate?: string | Date | null;
  advancePaidAmt?: number | null;
  remainingAmt?: number | null;
  paymentTerms?: string | null;
  dueDate?: string | Date | null;
  creditPeriod?: number | null;
}

export interface CreateGrnDto {
  companyName?: string;
  purchaseInstructionsBy?: string;
  /** Optional, alphanumeric, unique among live GRNs. */
  batchNo?: string | null;
  locationType?: LocationType;
  grnType?: GrnType;
  /** Where the goods go: `cc-dc` (default, receivable) or `direct-to-customer`. */
  deliveryMode?: GrnDeliveryMode;
  purchaseType?: PurchaseType;
  dealSlipId?: string;
  rfpaId?: string;
  securityPerson?: string;
  specialReq?: string;
  purchaseLocation?: string;
  purchaseForSalesLocation?: string;
  otherPurchaseLoc?: string;
  otherPurchaseForSalesLoc?: string;
  source?: Source;
  selectedParty?: string;
  selectedVendor?: { id?: string } | string;
  selectedFarmer?: { id?: string } | string;
  billNo?: string;
  billImage?: string;
  subTotalAmt?: number;
  freight?: number;
  otherCharges?: number;
  totalAmt?: number;
  amtWords?: string;
  purchasedBy?: string;
  approvalNote?: string;
  timeIn?: string | null;
  cratesIn?: number;
  receivingPerson?: string;
  remark?: string;
  purchaseBy?: string;
  paymentInfo?: PaymentInfoDto;
  grnProducts?: GrnProductDto[];
  variants?: string[] | string;
  createdBy?: string;
  requestedBy?: string;
  createdAt?: Date;
  grnNo?: string;
  expectedHarvestDate?: string | null;
}

export type UpdateGrnDto = Partial<CreateGrnDto>;

export interface GetAllGrnsQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  rfpaId?: string;
  companyName?: string;
  source?: Source;
  grnType?: GrnType;
  locationType?: LocationType;
}

export interface GrnListItemDto {
  id: string;
  documentId?: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  companyName: string | null;
  grnType: GrnType | null;
  deliveryMode: GrnDeliveryMode | null;
  purchaseType: PurchaseType | null;
  locationType: LocationType | null;
  source: Source | null;
  billNo: string | null;
  freight: number | null;
  subTotalAmt: number | null;
  otherCharges: number | null;
  totalAmt: number | null;
  amtWords: string | null;
  cratesIn: number | null;
  purchasedBy: string | null;
  timeIn: string | null;
  remark: string | null;
  securityPerson: string | null;
  receivingPerson: string | null;
  rmn: string | null;
  purchaseLocation: string | null;
  purchaseForSalesLocation: string | null;
  grnNo: string | null;
  batchNo: string | null;
  totalGrossWeight: number | null;
  totalNetWeight: number | null;
  paymentInfo: PaymentInfoDto | null;
}

export interface GrnDetailDto {
  id: string;
  overAllStatus?: string | null;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;
  ammountStatus:ammountStatus;
  companyName: string | null;
  purchaseInstructionsBy?: string | { id?: string; firstName?: string; lastName?: string } | null;
  dealSlipId: string | { id: string | null; dealSlipNo: string | null } | null;
  purchaseType?: PurchaseType | null;
  otherPurchaseForSalesLoc?: string | null;
  otherPurchaseLoc?: string | null;
  grnNo?: string | null;
  batchNo?: string | null;
  totalGrossWeight?: number | null;
  totalNetWeight?: number | null;
  locationType?: LocationType | null;
  grnType?: GrnType | null;
  deliveryMode?: GrnDeliveryMode | null;
  rmn?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  createdBy?: string | null;
  purchaseLocation?: string | null;
  purchaseForSalesLocation?: string | null;
  selectedParty?: string | null;
  source?: Source | null;
  billNo?: string | null;
  billImage?: string | null;
  subTotalAmt?: number | null;
  freight?: number | null;
  otherCharges?: number | null;
  totalAmt?: number | null;
  amtWords?: string | null;
  purchasedBy?: string | null;
  timeIn?: string | null;
  cratesIn?: number | null;
  receivingPerson?: string | null;
  specialReq?: string | null;
  securityPerson?: string | null;
  approvalNote?: string | null;
  remark?: string | null;
  purchaseBy?: {
    firstName: string;
    lastName: string;
  } | null;
  paymentInfo?: PaymentInfoDto | null;
  grnProducts: GrnProductDto[];
}

/** Returned by deleteGrn service method */
export interface DeleteGrnResultDto {
  grnNo?: string;
}