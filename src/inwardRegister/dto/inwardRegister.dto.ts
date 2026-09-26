import { Source } from "../../utils/status.enum";
import { InwardType } from "../entity/inwardRegister.entity";


export interface CreateInwardProductDto {
  productName: string;
  variant?: string;
  uom: string;

  packingMaterialWeight?: number;
  quantity?: number;
  weight?: number;
  unitPrice?: number;
  amount?: number;
  netWeight?: number;
  grossWeight?: number;
}

export interface CreateInwardRegisterInput
  extends CreateInwardRegisterDto {
  requestedBy: string;

  selectedVendor?: {
    id: string;
  };

  selectedFarmer?: {
    id: string;
  };

  inwardNo?:string

  variants?: string | string[];
}

export interface CreateInwardRegisterDto {
  grnNo?: string | null;
  deliveryChallanNo?: string | null;
  rbcNo?: string | null;

  inwardType: InwardType;

  companyName: string;
  location: string;
  fromLocation?: string;

  date?: Date;
  batchNo?: string;

  source: Source;

  selectedParty?: string;
  customerName?: string;

  purchasedBy?: string;
  inwardBy?: string;

  incomingGrossQty?: number;
  incomingNetQty?: number;

  inwardGrossQty?: number;
  inwardNetQty?: number;

  inwardCost?: number;
  totalWeightInKg?: number;

  remarks?: string;

  inwardProducts: CreateInwardProductDto[];
}


// ─── View DTOs ────────────────────────────────────────────────────────────────

export interface InwardViewAddressDto {
  id: string;
  address1: string | null;
  address2: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface InwardViewFarmerPartyDto {
  fullname: string;
  primaryMobileNo: string | null;
  secondaryMobileNo: string | null;
  farmerCode: string | null;
  email: string | null;
  farmAddress: InwardViewAddressDto | null;
  residensialAddress: InwardViewAddressDto | null;
}

export interface InwardViewVendorPartyDto {
  companyName: string | null;
  category: string | null;
  subcategory: string | null;
  vendorCode: string | null;
  contactPersonName: string | null;
  officeAddress: InwardViewAddressDto | null;
}

export interface InwardViewProductDto {
  id: string;
  productName: string | null;
  uom: string | null;
  variant: string | null;
  packingMaterialWeight: number | null;
  quantity: number | null;
  weight: number | null;
  unitPrice: number | null;
  amount: number | null;
  netWeight: number | null;
  grossWeight: number | null;
}

export interface InwardRegisterViewDto {
  documentId: string | null;
  overAllStatus: string | null;
  createdBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  approvalSummary?: {
    createdBy?: { userId: string; name: string } | null;
    verified?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    thirdApproved?: { userId: string; name: string; status: string; reason: string | null } | null;
    firstFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
    secondFinalized?: { userId: string; name: string; status: string; reason: string | null } | null;
  } | null;

  selectedParty: InwardViewFarmerPartyDto | InwardViewVendorPartyDto | null;

  id: string;
  inwardType: string;
  inwardNo: string | null;
  batchNo: string | null;
  remarks: string | null;
  source: string;

  incomingGrossQty: number | null;
  incomingNetQty: number | null;
  inwardGrossQty: number | null;
  inwardNetQty: number | null;
  inwardCost: number | null;
  totalWeightInKg: number | null;

  grnNo: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;
  companyName: string | null;
  location: string | null;
  fromLocation: string | null;
  customerName: string | null;

  date: Date | null;
  purchasedBy: string | null;
  inwardBy: string | null;

  inwardProducts: InwardViewProductDto[];
}


// ─── Update (Edit) DTOs ───────────────────────────────────────────────────────

export interface InwardUpdateProductDto {
  id: string | null;
  productName: string | null;
  productCode: string | null;
  variant: string | null;
  variantName:string | null;
  variantCode:string |null;
  uom: string | null;
  grossWeight: number | null;
  netWeight: number | null;
  weight: number | null;
  packingMaterialWeight: number | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
}

export interface InwardRegisterUpdateDto {
  id: string;
  createdDate: string | null;
  createdTime: string | null;

  inwardType: string;
  companyName: string | null;
  location: string | null;
  fromLocation: string | null;
  date: Date | null;
  batchNo: string | null;
  source: string;

  totalWeightInKg: number | null;
  incomingGrossQty: number | null;
  incomingNetQty: number | null;
  inwardGrossQty: number | null;
  inwardNetQty: number | null;
  inwardCost: number | null;
  remarks: string | null;

  purchasedBy: string | null;
  inwardBy: string | null;

  grnNo: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;

  selectedParty: string | null;
  customer:string | null;

  inwardProducts: InwardUpdateProductDto[];
}


// ─── List DTOs ────────────────────────────────────────────────────────────────

export interface InwardRegisterListItemDto {
  documentId: string;
  overAllStatus: string;
  createdBy: string;
  createdDate: string | null;
  createdTime: string | null;

  id: string | null;
  batchNo: string | null;
  inwardType: string | null;
  inwardNo: string | null;
  source: string | null;

  inwardNetQty: number | null;
  inwardGrossQty: number | null;
  incomingNetQty: number | null;
  incomingGrossQty: number | null;
  inwardCost: number | null;
  totalWeightInKg: number | null;
  remarks: string | null;
  date: Date | null;

  grnNo: string | null;
  deliveryChallanNo: string | null;
  rbcNo: string | null;
  companyName: string | null;
  location: string | null;

  vendorName: string | null;
  farmerName: string | null;
  purchasedBy: string | null;
  inwardBy: string | null;
}

export interface InwardRegisterListResultDto {
  data: InwardRegisterListItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}


// ─── Update Input DTOs (request body) ────────────────────────────────────────

export interface UpdateInwardProductInputDto {
  productName?: string | null;
  variant?: string | null;
  uom?: string | null;
  packingMaterialWeight?: number | null;
  quantity?: number | null;
  weight?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  netWeight?: number | null;
  grossWeight?: number | null;
}

export interface UpdateInwardRegisterDto {
  grnNo?: string | null;
  deliveryChallanNo?: string | null;
  rbcNo?: string | null;

  inwardType?: InwardType;

  companyName?: string;
  location?: string;
  fromLocation?: string | null;

  date?: string | null;
  batchNo?: string | null;

  source?: Source;

  // frontend sends selectedParty; controller resolves to selectedVendor / selectedFarmer
  selectedParty?: string | null;
  selectedVendor?: { id: string } | null;
  selectedFarmer?: { id: string } | null;

  customerName?: string | null;

  purchasedBy?: string | null;
  inwardBy?: string | null;

  incomingGrossQty?: number | null;
  incomingNetQty?: number | null;
  inwardGrossQty?: number | null;
  inwardNetQty?: number | null;
  inwardCost?: number | null;
  totalWeightInKg?: number | null;

  remarks?: string | null;

  inwardProducts?: UpdateInwardProductInputDto[];
}
