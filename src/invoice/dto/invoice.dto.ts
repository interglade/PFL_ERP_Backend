import { ammountStatus } from "../../utils/status.enum";


export interface InvoiceProductDto {
  id?: string | null;
  productName?: string | null;
  variant?: string | null;
  saleUoM?: string | null;
  quantity?: number | null;
  acceptedQty?: number | null;
  rejectedQty?: number | null;
  returnedQty?: number | null;
  amount?: number | null;
  unitPrice?: number | null;
  grossWeight?: number | null;
  netWeight?: number | null;
  hsnCode?: string | null;
  description?: string | null;
}

export interface InvoiceAddressDto {
  id?: string | null;
  address1?: string | null;
  address2?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface InvoiceBankDetailsDto {
  bankName?: string | null;
  accountNo?: string | null;
  branch?: string | null;
  ifscCode?: string | null;
}

export interface InvoiceCompanyRefDto {
  id?: string | null;
  name?: string | null;
  officeAddress?: string | null;
  gstNo?: string | null;
  fassaiNo?: string | null;
  bankDetails?: InvoiceBankDetailsDto | null;
}

export interface InvoiceCustomerRefDto {
  id?: string | null;
  customerName?: string | null;
  customerCode?: string | null;
  contactNo?: string | null;
  gstn?: string | null;
  panNo?: string | null;
}

export interface InvoiceUserRefDto {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface CreateInvoiceDto {
  invoiceNo?: string;
  invoiceDate?: Date;
  pdfData?: string | null;
  deliveryChallan?: string | null;
  invoiceProducts?: InvoiceProductDto[];
  companyName?: string | null;
  customerName?: string | null;
  poNumber?: string | null;
  fromLocation?: string | null;
  billingAddress?: InvoiceAddressDto | null;
  deliveryAddress?: InvoiceAddressDto | null;
  vehicleNo?: string | null;
  placeOfSupply?: string | null;
  totalProductAmount?: number | null;
  netProductWeight?: number | null;
  totalAmount?: number | null;
  totalAmtInWords?: string | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  taxAmount?: number | null;
  discount?: number | null;
  freight?: number | null;
  otherCharges?: number | null;
}

export type UpdateInvoiceDto = Partial<CreateInvoiceDto>;

export interface InvoiceListItemDto {
  documentId?: string | null;
  ammountStatus:ammountStatus;
  overAllStatus?: string | null;
  createdBy?: string | null;
  createdDate?: string | null;
  createdTime?: string | null;
  id: string;
  invoiceNo?: string | null;
  invoiceDate?: Date | null;
  vehicleNo?: string | null;
  companyName?: string | null;
  deliveryChallan?: string | null;
  customerName?: string | null;
  poNumber?: string | null;
  fromLocation?: string | null;
  totalProductAmount?: number | null;
  netProductWeight?: number | null;
  grossProductWeight?: number | null;
  totalAmount?: number | null;
  billingAddress?: string | null;
  deliveryAddress?: string | null;
}

export interface InvoiceDetailDto {
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
  invoiceNo?: string | null;
  invoiceDate?: Date | null;
  createdDate?: string | null;
  createdTime?: string | null;
  createdBy?: string | null;
  companyName?: InvoiceCompanyRefDto | null;
  customer?: InvoiceCustomerRefDto | null;
  deliveryChallan?: string | null;
  poNumber?: string | null;
  fromLocation?: string | null;
  billingAddress?: InvoiceAddressDto | null;
  deliveryAddress?: InvoiceAddressDto | null;
  vehicleNo?: string | null;
  placeOfSupply?: string | null;
  totalProductAmount?: number | null;
  netProductWeight?: number | null;
  totalAmount?: number | null;
  totalAmtInWords?: string | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  taxAmount?: number | null;
  discount?: number | null;
  freight?: number | null;
  otherCharges?: number | null;
  invoiceProducts?: InvoiceProductDto[];
}
