import { Entity, Column, ManyToOne, JoinColumn, OneToMany, JoinTable, ManyToMany } from 'typeorm';
import Model from '../../../global/model.entity';

import { Department, Status } from '../../../utils/status.enum';
import { GRN } from '../../../grn/entity/grn.entity';
import { Company } from '../../../company/entity/company.entity';
import { Product } from '../../../product/createproduct/entity/product.entity';
import { User } from '../../../employee/entity/user.entity';
import { Branches } from '../../../branch/entity/branches.entity';


@Entity('transport_payment_voucher')
export class TPVoucher extends Model {
  // Relation to GRN entity
  @ManyToOne(() => GRN, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grn_id' })
  grnNo: GRN;
  @Column({ nullable: true })
  voucherNo: string;
  @Column({
    type: 'enum',
    enum: Department,
    nullable: true,
  })
  requestingDepartment: Department;
  // @Column({
  //   // type: 'enum',
  //   // enum: CompanyName,
  //   nullable: true
  // })
  // companyName: string;

  @ManyToOne(() => Company, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'company_id' })
  companyName: Company;
  @Column({ nullable: true })
  debitCreditTo: string;

  @Column({ nullable: true })
  payReceivedFrom: string;

  @ManyToOne(() => Branches, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'location_id' })
  location: Branches;

  @Column({ nullable: true })
  driverName: string;

  @Column({ nullable: true })
  contactNo: string;

  @Column({ nullable: true })
  altContactNo: string;

  @Column({ nullable: true })
  vehicleNo: string;

  @Column({ nullable: true })
  dispatchLocation: string;

  @Column({ nullable: true })
  destinationLocation: string;

  // @Column({ nullable: true })
  // products: string;


    @ManyToMany(() => Product, { cascade: true ,nullable: true})
     @JoinTable({
       name: 'voucher_products',
       joinColumn: { name: 'product_id', referencedColumnName: 'id' },
       inverseJoinColumn: { name: 'products_id', referencedColumnName: 'id' },
     })
     products: Product[];

  @Column({ nullable: true })
  paymentMode: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  freightAmt: number;

  // @Column('decimal', { precision: 10, scale: 2, nullable: true })
  // totalAmt: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  decidedAmt: number;
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  actualAmt: number;
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  advanceAmt: number;
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  totalPayableAmt: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  finalPayableAmt: number;
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  deductionAmt: number;
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  extraAmt: number;

  @Column({ nullable: true })
  amtWords: string;

  @Column({ nullable: true })
  receiverName: string;
  
  @Column({ nullable: true })
  kyc: boolean;

  // @Column({ name: 'any attachment',nullable:true })
  //  anyAttachment: string;

  @Column('simple-array', { nullable: true })
  anyAttachment: string[] | null;

  @Column({
    type: 'enum',
    enum: Status,
    default: Status.PENDING,
    name: 'approval_status',
    nullable: true,
  })
  approvalStatus: Status;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'requested_by_employee_id' })
  requestedBy: User;
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'pass_by_employee_id' })
  passBy: User;
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'approved_by_employee_id' })
  approveBy: User;

  @Column({ type: 'text', nullable: true })
  remark: string;
}
