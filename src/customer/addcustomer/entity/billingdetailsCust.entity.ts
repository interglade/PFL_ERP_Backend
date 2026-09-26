import { Entity, Column, ManyToOne, JoinColumn, EntityManager, OneToOne } from 'typeorm';

import Model from '../../../global/model.entity';

import { Customer } from './customer.entity';
import { Address } from '../../../address/entity/address.entity';

@Entity('customer_billing_details')

export class BillingDetailsCust extends Model{
  

  @OneToOne(() => Address, { cascade: true, nullable: true,onDelete: "SET NULL" })
  @JoinColumn({name:"billing address"})
  billingAddress: Address;

  @Column({ name: 'customer_billing__details_name', nullable: true})
  billingName: string;

  @Column({ name: 'customer_billing_details_contact_person_fname', nullable: true})
  contactPersonFName: string;
  @Column({ name: 'customer_billing_details_contact_person_mname', nullable: true })
  contactPersonMName: string;
  @Column({ name: 'customer_billing_details_contact_person_lname', nullable: true})
  contactPersonLName: string;
  @Column({ name: 'commonly_known_as', nullable: true })
  commonlyKnownAs: string;
  @Column({ name: 'customer_billing_details_primary_contact_number', nullable: true })
  primaryContactNo: string;
 
  @Column({ name: 'billing_format', nullable: true })
  billingFormatCopy: string;

  @Column({ name: 'customer_billing_details_address_proof', nullable: true })
  billingAddressProofCopy: string;
  @Column({ name: 'customer_billing_details_secondary_contact_number', nullable: true })
  secondaryContactNo: string;

  @Column({ name: 'customer_billing_details_email_primary', nullable: true })
  emailPrimary: string;

  @Column({ name: 'customer_billing_details_email_secondary', nullable: true })
  emailSecondary: string;

  @OneToOne(() => Customer, (customer) => customer.billingDetails,{ onDelete: "SET NULL" })
  customer: Customer;
   
}
