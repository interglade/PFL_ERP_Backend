

export interface SecondSaleProductDto {
  id?: string | null;
  unitPrice?:number|null;
  productName?: string | null;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
  netWeight?: number | null;
  grossWeight?: number | null;
  packagingMaterialWeight?:number|null;
  packagingMaterialQuantity?:number|null;
  packagingMaterialUnitPrice?:number|null;
  packagingMaterialAmount?:number|null;
  packagingMaterialTotalWeight?:number|null;
  variant?:string|null;
  saleUoM?:string|null;
  packagingMaterialUoM?:string|null;
  packagingMaterial?:string|null
  
}

export interface SecondSaleAddressDto {
  id?: string | null;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface SecondSaleCompanyRefDto {
  id?: string | null;
  name?: string | null;
}

export interface SecondSaleBranchRefDto {
  id?: string | null;
  branchName?: string | null;
}

export interface SecondSaleDeliveryChallanRefDto {
  id?: string | null;
  challanNo?: string | null;
}

export interface CreateSecondSaleDto {
  secondSaleNo?: string | null;
  saleDate?: string | Date;
  companyName?: string | null;
  location?: string | null;
  deliveryChallanNo?: string | null;
  customerName?: string | null;
  customerContactNo?: string | null;
  customerEmail?: string | null;
  customerAddress?: SecondSaleAddressDto | null;
  reasonForSale?: string | null;
  secondSaleProducts?: SecondSaleProductDto[];
  totalNetWeight?: number | null;
  totalGrossWeight?: number | null;
  totalAmt?: number | null;
  totalAmtInWords?: string | null;
  paidAmount?: number | null;
  paymentMode?: string | null;
  pendingAmt?: number | null;
  remarks?: string | null;
}

export type UpdateSecondSaleDto = Partial<CreateSecondSaleDto>;

// export interface SecondSaleListItemDto {
//   id: string;
//   secondSaleNo?: string | null;
//   saleDate?: string | Date | null;
//   companyName?: string | null;
//   location?: string | null;
//   deliveryChallanNo?: string | null;
//   customerName?: string | null;
//   customerContactNo?: string | null;
//   customerEmail?: string | null;
//   reasonForSale?: string | null;
//   totalNetWeight?: number | null;
//   totalGrossWeight?: number | null;
//   totalAmt?: number | null;
//   totalAmtInWords?: string | null;
//   paidAmount?: number | null;
//   paymentMode?: string | null;
//   pendingAmt?: number | null;
//   remarks?: string | null;
//   createdAt?: Date | null;
//   createdBy?: string | null;
// }

export interface SecondSaleDetailDto {
  id: string;
  documentId?: string | null;
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
  secondSaleNo?: string | null;
  saleDate?: string | Date | null;
  companyName?: string | null;
  location?: string | null;
  deliveryChallanNo?: string | null;
  customerName?: string | null;
  customerContactNo?: string | null;
  customerEmail?: string | null;
  customerAddress?: SecondSaleAddressDto | null;
  reasonForSale?: string | null;
  secondSaleProducts?: SecondSaleProductDto[];
  totalNetWeight?: number | null;
  totalGrossWeight?: number | null;
  totalAmt?: number | null;
  totalAmtInWords?: string | null;
  paidAmount?: number | null;
  paymentMode?: string | null;
  pendingAmt?: number | null;
  remarks?: string | null;
  createdAt?: Date | null;
  createdBy?: string | null;
}

export interface SecondSaleListItemDto {
  id: string;
  documentId?: string | null;
  overAllStatus?: string | null;
  secondSaleNo?: string | null;
  saleDate?: string | Date | null;
  companyName?: string | null;
  location?: string | null;
  customerName?: string | null;
  customerContactNo?: string | null;
  customerEmail?: string | null;
  reasonForSale?: string | null;
  totalNetWeight?: number | null;
  totalGrossWeight?: number | null;
  totalAmt?: number | null;
  totalAmtInWords?: string | null;
  paidAmount?: number | null;
  paymentMode?: string | null;
  pendingAmt?: number | null;
  remarks?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  createdBy?: string | null;
}

export interface SecondSaleListResponseDto {
  data: SecondSaleListItemDto[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}
