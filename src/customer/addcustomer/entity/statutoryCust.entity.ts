import { Entity,  Column,  OneToOne } from 'typeorm';
import Model from '../../../global/model.entity';
import { Customer } from './customer.entity';
export enum CertificationType {
  ISO = 'iso',
  APEDA = 'apeda',
  FSSAI = 'fssai',
  OTHER = 'other'
}

export enum CorporateRegistrationType {
  MSME = 'msme',
  OTHER = 'other'
}


@Entity('customer_statutory_details')
export class StatutoryDetails extends Model {
  

  @Column({ name: 'statutory_details_pan_number', nullable: true })
  panNo: string;

  @Column({ name: 'statutory_details_aadhar_number', nullable: true })
  aadharNo: string;
  @Column({ name: 'statutory_details_pan_copy', nullable: true})
  panCopy: string;

  @Column({ name: 'statutory_details_aadhar_copy', nullable: true })
  aadharCopy: string;
  @Column({ name: 'statutory_details_gst_registration_number', nullable: true })
  gstn: string;
  @Column({ name: 'statutory_details_bill_book_copy', nullable: true })
  billBookCopy: string;

  @Column({
    type: 'enum',
    enum: CertificationType,
    
    nullable: true
  })
  certificationsDetails: CertificationType;
  

  @Column({ name: 'statutory_details_any_other_certifications', nullable: true })
  otherCertifications: string;
  @Column({
    type: 'enum',
    enum: CorporateRegistrationType,
    
    nullable: true
  })
  corpRegiDetails: CorporateRegistrationType;
  @Column({ name: 'statutory_details_other_corporate__registration_details', nullable: true })
  otherCorpRegiDetails: string;
  @Column({ name: 'statutory_details_incorporate_certifications_copy', nullable: true })
  incorpoCertificateCopy: string;
  @Column({ name: 'statutory_details_cin_no', nullable: true })
  cinNo: string;
  @Column({ name: 'statutory_details_registration_certificate_copy', nullable: true })
  regiCertificateCopy:string;

  @OneToOne(() => Customer, (customer) => customer.statutoryDetails,{ onDelete: "SET NULL" })
  customer: Customer;
}
