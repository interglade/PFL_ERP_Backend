import { Entity, Column, ManyToOne, OneToOne } from 'typeorm';

import { format } from 'date-fns-tz';
import Model from '../../../global/model.entity';
import { Customer } from './customer.entity';

@Entity('customer_office_use_only')
export class OfficeUseOnly extends Model {
  @Column({ name: 'customer_office_use_only_proposer_bd_name', nullable: true })
  proposerBDName: string;
  @Column({ name: 'customer_office_use_only_coordinator', nullable: true })
  pflCoordinator: string;
  @Column({ name: 'customer_office_use_only_recommended_by', nullable: true })
  recommendedBy: string;
  @Column({ name: 'customer_office_use_only_dispatch_location_PFL', nullable: true })
  dispatchLocationPfl:string
  @Column({ name: 'customer_office_use_only_approved_by', nullable: true })
  approvedBy: string;

  @Column({ name: 'customer_office_use_only_relationship_manager', nullable: true })
  relationshipManager: string;
  @Column({ name: 'customer_office_use_only_avg_monthly_billing', nullable: true })
  avgBillingMonthly: number;
  @Column({ name: 'customer_office_use_only_volume in tonnes per monthly', nullable: true })
  volumeMonthly: number;
  @Column({ name: 'customer_office_use_only_customer_verification_completed', nullable: true })
  customerVerification: boolean;

  @Column({ name: 'customer_office_use_only_verification_agency', nullable: true })
  verificationAgency: string;

  @Column({ name: 'customer_office_use_only_validity_period',  type: 'date',  nullable: true ,
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
})
  validityPeriod: Date;

  @Column({ name: 'customer_office_use_only_due_diligence_done', nullable: true })
  dueDiligenceDone: boolean;

  @Column({ name: 'customer_office_use_only_credit_worthiness_due', nullable: true })
  creditWorthinessDue: string;

  @Column({ name: 'customer_office_use_only_key_account_person_assigned', nullable: true })
  keyAccountPersonAssigned: string;
  @Column({ name: 'customer_office_use_only_since_when', nullable: true ,  type: 'date', 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
})
  sinceWhen: Date;
  @Column({ 
    name: 'customer_office_use_only_ledger_created_date', 
    type: 'date', 
    nullable: true 
  , 
  // transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
})
  ledgerCreatedDate: Date;

  @Column({ name: 'customer_office_use_only_ledger_created_by', nullable: true })
  ledgerCreatedBy: string;

  @Column({ name: 'customer_office_use_only_ledger_verified_approved_by', nullable: true })
  ledgerVerifiedApprovedBy: string;

  @Column({ name: 'customer_office_use_only_created_by', nullable: true })
  createdBy: string;

  

  @Column({ name: 'customer_office_use_only_additional_notes', type: 'text', nullable: true })
  additionalNotes: string;

  @OneToOne(() => Customer, (customer) => customer.officeUseOnly,{ onDelete: "SET NULL" })
  customer: Customer;
}
