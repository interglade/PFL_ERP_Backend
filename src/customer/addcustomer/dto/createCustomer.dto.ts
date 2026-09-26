import { Status } from "../../../utils/status.enum"; 


import { BankDetailsDto } from "./bankDetails.dto";
import { StatutoryDetailsDto } from "./statutoryDetails.dto";
import { BillingDetailsDto } from "./billingDetails.dto";

import { PaymentTermsDto } from "./paydetails.dto";
import { OfficeUseOnlyDto } from "./officeUseOnly.dto";

import { ProductSpecificationDto } from "./productSpecification.dto";
import { DeliveryDetailsDto } from "./deliveryDetails.dto";
import { KeyMobileNoDto } from "./keyMobileNo.dto";
import { AddressDto } from "../../../address/dto/address.dto";

export interface CreateCustomerDto {
  organisationName: string;

  customerImage: string;

  organisationType: string;

  otherType?: string;

  customerCategory: string;

  customerTypes: string;

  primaryContactNo: string;

  secondaryContactNo?: string;

  emailPrimary: string;

  emailSecondary?: string;

  customerCode: string;

  createdBy: string;

  status: Status;

  customerAddress?: AddressDto;

  bankDetails?: BankDetailsDto;

  statutoryDetails?: StatutoryDetailsDto;

  billingDetails?: BillingDetailsDto;

  deliveryDetails?: DeliveryDetailsDto;

  paymentTerms?: PaymentTermsDto;

  officeUseOnly?: OfficeUseOnlyDto;

  keyMobileNumbers?: KeyMobileNoDto;

  productSpecification?: ProductSpecificationDto[];
}

export interface CustomerListResponseDto {
  id: string;
  createdBy: string | null;
  customerTypes: string | null;
  createdDate: string | null;
  createdTime: string | null;
  status: string;
  customerCode: string;
  organisationName: string;
  organisationType: string;
  customerCategory: string | null;
  primaryContactNo: string;
  emailPrimary: string;
  customerAddress: string | null;
  contactPersonName: string | null;
}

export interface PaginationMeta {
  total: number;
  page?: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface CustomerViewResponseDto {
  id: string;
  organisationName: string;
  customerImage: string | null;
  organisationType: string;
  otherType: string | null;
  customerCategory: string | null;
  customerTypes: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  createdDate: string | null;
  createdTime: string | null;
  customerCode: string;
  status?: string | null;
  emailPrimary: string;
  emailSecondary: string | null;
  primaryContactNo: string;
  secondaryContactNo: string | null;
  status?: string;

  bankDetails: BankDetailsDto | null;
  customerAddress: AddressDto | null;
  statutoryDetails: StatutoryDetailsDto | null;
  billingDetails: BillingDetailsDto | null;
  deliveryDetails: DeliveryDetailsDto | null;
  paymentTerms: PaymentTermsDto | null;
  officeUseOnly: OfficeUseOnlyDto | null;
  keyMobileNumbers: KeyMobileNoDto | null;
  productSpecification: ProductSpecificationDto[];
}

export interface CustomerTypeResponseDto {
  id: string;
  name: string;
}

export interface CreateCustomerTypeDto {
  name: string;
}

export interface CustomerCategoryResponseDto {
  id: string;
  name: string;
}

export interface CreateCustomerCategoryDto {
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete result DTOs
// ─────────────────────────────────────────────────────────────────────────────

/** Returned by deleteCustomer service method */
export interface DeleteCustomerResultDto {
  organisationName: string;
}

/** Item in the deleted array from softDeleteCustomers */
export interface DeletedCustomerItemDto {
  id: string;
  organisationName: string;
}

/** Returned by softDeleteCustomers service method */
export interface BulkDeleteCustomerResultDto {
  affected?: number | null;
  deleted: DeletedCustomerItemDto[];
}

/** Returned by deleteCustomerCategory service method */
export interface DeleteCustomerCategoryResultDto {
  name: string;
}

/** Item in the deleted array from softDeleteCustomerCategory */
export interface DeletedCustomerCategoryItemDto {
  id: string;
  name: string;
}

/** Returned by softDeleteCustomerCategory service method */
export interface BulkDeleteCustomerCategoryResultDto {
  affected?: number | null;
  deleted: DeletedCustomerCategoryItemDto[];
}

/** Returned by deleteCustomerType service method */
export interface DeleteCustomerTypeResultDto {
  name: string;
}

/** Item in the deleted array from softDeleteCustomerType */
export interface DeletedCustomerTypeItemDto {
  id: string;
  name: string;
}

/** Returned by softDeleteCustomerType service method */
export interface BulkDeleteCustomerTypeResultDto {
  affected?: number | null;
  deleted: DeletedCustomerTypeItemDto[];
}