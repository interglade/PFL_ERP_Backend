import { AddressDto } from "../../../address/dto/address.dto";


export interface BankDetailsDto {
  id?: string;
  bankAccHolderFName?: string;
  bankAccHolderMName?: string;
  bankAccHolderLName?: string;

  bankName?: string;
  bankBranch?: string;
  bankAccNo?: string;
  ifscCode?: string;

  accType?: string;
  ifCancelledCheque?: boolean;

  notCancelledChequeReason?: string;
  cancelledChequeCopy?: string;

  otherAccType?: string;

  bankStatementCopy?: string;

  bankAddress?: AddressDto | null;
}