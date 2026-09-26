import { Entity,  Column, ManyToOne, OneToOne } from 'typeorm';


import { format } from 'date-fns';
import Model from '../../../global/model.entity';
import { Customer } from './customer.entity';

@Entity('customer_payment_terms')
export class PaymentTerms extends Model {
  

  @Column({ name: 'customer_payment_terms_payment_mode', nullable: true})
  paymentMode: string;
  @Column({ name: 'customer_payment_terms_other_payment_mode', nullable: true})
  otherPaymentMode: string;
  @Column({ name: 'customer_payment_terms_other_payment_made', nullable: true })
  otherPaymentMade: string;
   @Column({ name: 'customer_payment_terms_payment_made', nullable: true })
  paymentMade: string;

  @Column({ name: 'customer_payment_terms_margin_deposit', nullable: true })
  marginDeposit: string;
  @Column({ name: 'rtv', nullable: true })
  rtv: boolean;
  @Column({ name: 'agreementExecuted', nullable: true })
  agreementExecuted: boolean;
  @Column({ name: 'l/c', nullable: true })
  lc: string;
  @Column({ name: 'b/g', nullable: true })
  bg: string;
  @Column({ name: 'security_deposit_details_cheq_No', nullable: true })
  securityDepoCheqNo: string;
  @Column({ name: 'security_deposit_details_Amt', nullable: true })
  securityDepoAmt: number;
  //Initial Exposure Limit (IEL)
  @Column({ name: 'initial_exposure_limit_Amount', nullable: true })
  IELinAmt: number;
  @Column({ name: 'initial_exposure_limit_RecommendedBy', nullable: true })
  IELRecommendedBy: string;
  
   
  @Column({ type: 'date',name: 'initial_exposure_limit_RecommendedDate', nullable: true, 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // }, 
})
  IELRecommendedDate: Date;
//Revision of Exposure Limit (REL)
@Column({ name: 'Revision_exposure_limit_amount', nullable: true })
RELinAmt: number;
@Column({ name: 'Revision_exposure_limit_RecommendedBy', nullable: true })
RELRecommendedBy: string;
@Column({ type: 'date',name: 'Revision_exposure_limit_RecommendedDate', nullable: true, 
//   transformer: {
//   to: (value: Date) => value, 
//   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
// },
 })
RELRecommendedDate: Date;
@Column({ name: 'Reason', nullable: true })
reason: string;
@Column({ name: 'doc_evidence_copy', nullable: true })
docEvidenceCopy: string;
@OneToOne(() => Customer, (customer) => customer.paymentTerms,{ onDelete: "SET NULL" })
customer: Customer;
}
