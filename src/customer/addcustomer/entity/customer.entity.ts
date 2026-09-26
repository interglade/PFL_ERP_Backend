import {
  Entity,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
  OneToMany,
  BeforeInsert,
} from 'typeorm';




import { Status } from '../../../utils/status.enum';




import { generateIncrementalCode } from '../../../utils/codeGeneration';


import Model from '../../../global/model.entity';
import { BankDetailsCust } from './bankDetailsCust.entity';

import { BillingDetailsCust } from './billingdetailsCust.entity';
import { DeliveryDetails } from './deliveryDetailsCust.entity';

import { keyMobileNoData } from './keyMobileNoCust.entity';
import { CustomerCategory } from '../../customerCategory/entity/customerCategory.entity';
import { CustomerType } from '../../customerType/entity/customerType.entity';
import { Address } from '../../../address/entity/address.entity';
import { StatutoryDetails } from './statutoryCust.entity';
import { PaymentTerms } from './paymentDetailsCust.entity';
import { OfficeUseOnly } from './officeUseOnlyCust.entity';
import { ProductSpecification } from './productSpecificationCust.entity';
import { User } from '../../../employee/entity/user.entity';



@Entity('customers')
export class Customer extends Model {
  @Column({ name: 'organisation_name', nullable: true })
  organisationName: string;

  @Column({ name: 'customer_image', nullable: true })
  customerImage: string;

  @Column({ name: 'type_of_organisation', nullable: true })
  organisationType: string;

  @Column({ name: 'other_organisation', nullable: true })
  otherType: string;

  @ManyToOne(
    () => CustomerCategory,
    (customerCategory) => customerCategory.customers,
    { nullable: true, cascade: true, onDelete: 'SET NULL' },
  )
  customerCategory: CustomerCategory;

  @ManyToOne(() => CustomerType, (customerType) => customerType.customers, {
    nullable: true,
    cascade: true,
    onDelete: 'SET NULL',
  })
  customerTypes: CustomerType;

  @OneToOne(() => BankDetailsCust, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  bankDetails: BankDetailsCust;

  @OneToOne(() => Address, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  customerAddress: Address;

  @OneToOne(() => StatutoryDetails, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  statutoryDetails: StatutoryDetails;

  @OneToOne(() => BillingDetailsCust, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  billingDetails: BillingDetailsCust;

  @OneToOne(() => DeliveryDetails, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  deliveryDetails: DeliveryDetails;

  @OneToOne(() => PaymentTerms, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  paymentTerms: PaymentTerms;

  @OneToOne(() => OfficeUseOnly, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  officeUseOnly: OfficeUseOnly;

  @OneToOne(() => keyMobileNoData, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  keyMobileNumbers: keyMobileNoData;

  // One-to-many relationship for productspecification

  @OneToMany(
    () => ProductSpecification,
    (productSpecification) => productSpecification.customer,
    { cascade: true, nullable: true, onDelete: 'SET NULL' },
  )
  productSpecification: ProductSpecification[];

  @Column({ name: 'customer_primary_contact_number', nullable: true })
  primaryContactNo: string;

  @Column({ name: 'customer_secondary_contact_number', nullable: true })
  secondaryContactNo: string;

  @Column({ name: 'customer_email_primary', nullable: true })
  emailPrimary: string;

  @Column({ name: 'customer_email_secondary', nullable: true})
  emailSecondary: string;

  @Column({ name: 'customercode', nullable: true })
  customerCode: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approvedBy: User;

  @Column({
    type: 'enum',
    enum: Status,
    default: Status.PENDING,
    name: 'status',
  })
  status: Status;
  @BeforeInsert()
  async setCustomerCode() {
    // Use the createdAt field which is set by TypeORM before insertion
    this.customerCode = await generateIncrementalCode('customer');
  }
}
