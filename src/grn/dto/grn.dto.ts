import { ammountStatus, Department, Source } from "../../utils/status.enum";
import { GrnType, LocationType, PurchaseType } from "../entity/grn.entity";


export interface GrnProductDto {
  id?: string;
  quantity?: number;
  unitPrice?: number;
  productName?: string | null;
  variant?: string | null;
  uom?: string | null;
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
  requestingDepartment?: Department;
  locationType?: LocationType;
  grnType?: GrnType;
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
  receivedThrough?: string;
  vehicleNo?: string;
  timeIn?: string | null;
  cratesIn?: number;
  deliveryReceivingPerson?: string;
  baseLocation?: string;
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
  receivedThrough: string | null;
  vehicleNo: string | null;
  timeIn: string | null;
  remark: string | null;
  securityPerson: string | null;
  deliveryReceivingPerson: string | null;
  rmn: string | null;
  purchaseLocation: string | null;
  purchaseForSalesLocation: string | null;
  grnNo: string | null;
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
  locationType?: LocationType | null;
  grnType?: GrnType | null;
  rmn?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  createdBy?: string | null;
  requestingDepartment?: Department | null;
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
  receivedThrough?: string | null;
  vehicleNo?: string | null;
  timeIn?: string | null;
  cratesIn?: number | null;
  deliveryReceivingPerson?: string | null;
  baseLocation?: string | null;
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