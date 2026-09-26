import { AddressDto } from "../../../address/dto/address.dto";


export interface BillingDetailsDto {
  id?: string;
  billingAddress?: AddressDto | null;

  billingName?: string;

  contactPersonFName?: string;
  contactPersonMName?: string;
  contactPersonLName?: string;

  commonlyKnownAs?: string;

  primaryContactNo?: string;
  secondaryContactNo?: string;

  emailPrimary?: string;
  emailSecondary?: string;

  billingFormatCopy?: string;
  billingAddressProofCopy?: string;
}