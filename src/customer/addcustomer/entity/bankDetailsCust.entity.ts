import { Entity, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import Model from '../../../global/model.entity';
import { Customer } from './customer.entity';
import { Address } from '../../../address/entity/address.entity';


export enum AccountType {
  SAVINGS = 'savings',
  CURRENT = 'current',
  CASH_CREDIT = 'cash credit',
  OVERDRAFT = 'over draft account',
  OTHER = 'other',
}

@Entity({ name: 'customer_bank_details' })
export class BankDetailsCust extends Model {
  
 

  @Column({ name: 'customer_bank_account_holder_fname', nullable: true })
  bankAccHolderFName: string;

  @Column({ name: 'customer_bank_account_holder_mname', nullable: true })
  bankAccHolderMName: string;
  
  @Column({ name: 'customer_bank_account_holder_lname', nullable: true })
  bankAccHolderLName: string;
  @Column({ name: 'customer_bank_name', nullable: true })
  bankName: string;

  @Column({ name: 'branch', nullable: true })
 bankBranch: string;

  @Column({ name: 'customer_bank_account_number', nullable: true })
  bankAccNo: string;

  @Column({ name: 'ifsc_code', nullable: true })
  ifscCode: string;

  @Column({
    type: 'enum',
    enum: AccountType,
    name: 'type_of_account',
    nullable: true,
  })
  accType: AccountType;

  @Column({ name: 'if_cancelled_cheque', nullable: true })
  ifCancelledCheque: boolean;  // true or false

  @Column({ name: 'reason_no_cheque', nullable: true })
  notCancelledChequeReason: string; // Reason for not providing the copy
  @Column({ name: 'cancelled_cheque_copy', nullable: true })
  cancelledChequeCopy: string; // Reason for not providing the copy
  @Column({ name: 'other_type_of_account', nullable: true })
  otherAccType: string; // For 'other' type of account
  // Optional field to capture additional account type if 'type_of_account' is 'other'

  @Column({ name: 'customer_bank_statement_copy', nullable: true })
  bankStatementCopy: string; // For 'other' type of account
  @ManyToOne(() => Address, { cascade:true,nullable: true,onDelete: "SET NULL" })
 bankAddress: Address;
 

 
  @OneToOne(() => Customer, (customer) => customer.bankDetails,{ onDelete: "SET NULL" })
  customer: Customer;
}
