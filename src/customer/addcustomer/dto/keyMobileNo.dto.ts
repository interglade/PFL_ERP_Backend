import { AddressDto } from "../../../address/dto/address.dto";


export interface KeyMobileNoDto {
  id?: string;
  accDeptFName?: string;
  accDeptMName?: string;
  accDeptLName?: string;

  accDeptMobileNo?: string;

  ownerFName?: string;
  ownerMName?: string;
  ownerLName?: string;

  ownerMobileNo?: string;

  mandiLicenceNo?: string;
  mandiLicenceCopy?: string;

  regiNo?: string;
  regiCopy?: string;

  electricityBill?: string;
  consumerNo?: string;

  electricityBillCopy?: string;

  notElectricityBillReason?: string;

  customerBlacklisted?: string;

  ifBlacklistedReason?: string;

  blackListedBy?: string;

  visitingCard?: string;

  visitingContactNo?: string;

  visitingCardCopy?: string;

  notVisitingCardReason?: string;

  ref1FName?: string;
  ref1MName?: string;
  ref1LName?: string;

  ref1Address?: AddressDto | null;

  ref1ContactNo?: string;

  ref1Email?: string;

  ref2FName?: string;
  ref2MName?: string;
  ref2LName?: string;

  ref2Address?: AddressDto | null;

  ref2ContactNo?: string;

  ref2Email?: string;
}