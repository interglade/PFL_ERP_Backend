import { AddressDto } from "../../../address/dto/address.dto";


export interface DeliveryDetailsDto {
  id?: string;
  deliveryAddress?: AddressDto | null;

  deliveryAddressProofCopy?: string;

  deliveryTime?: string | null;

  receivingPersonFName?: string;
  receivingPersonMName?: string;
  receivingPersonLName?: string;

  primaryContactNo?: string;
  secondaryContactNo?: string;

  emailPrimary?: string;
  emailSecondary?: string;
}