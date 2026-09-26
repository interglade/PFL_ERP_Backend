import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { Source } from '../../utils/status.enum';
import { InwardProduct } from './inwardProduct.entity';

import { format, toZonedTime } from 'date-fns-tz';
import Model from '../../global/model.entity';
import { GRN } from '../../grn/entity/grn.entity';
import { DeliveryChallanPurchase } from '../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity';
import { Company } from '../../company/entity/company.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { Farmer } from '../../farmer/entity/farmer.entity';
import { Vendor } from '../../vendor/createVendor/entity/vendor.entity';
import { Customer } from '../../customer/addcustomer/entity/customer.entity';
import { User } from '../../employee/entity/user.entity';
import { PostReturnByCustomer } from '../../returnByCustomer/entity/postReturnByCustomer.entity';

'./postReturnByCustomer.entity';

export enum InwardType {
  Purchase = 'purchase',
  Transferred = 'transferred',
  ReturnedByCustomer = 'returned-by-customer',
}
@Entity('inward_register')
export class InwardRegister extends Model {
  @ManyToOne(() => GRN, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grn_id' })
  grnNo: GRN;
  @ManyToOne(() => DeliveryChallanPurchase, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'delivery_challan_id' })
  deliveryChallanNo: DeliveryChallanPurchase;

  @ManyToOne(() =>PostReturnByCustomer, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'rbc_id' })
  rbcNo: PostReturnByCustomer;

  @Column({
    type: 'enum',
    nullable: true,
    enum: InwardType,
  })
  inwardType: InwardType;
@Column({ nullable: true })
  inwardNo: string;

  @ManyToOne(() => Company, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'company_id' })
  companyName: Company;
  @ManyToOne(() => Branches, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branch_id' })
  location: Branches;

  @ManyToOne(() => Branches, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'fromlocation_branch_id' })
  fromLocation: Branches;
   @Column({
    type: 'date',
    nullable: true,
    default: null,
    
  })
  date: Date;

  @Column({ nullable: true })
  batchNo: string;

  @ManyToOne(() => Vendor, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vendor_id' })
  selectedVendor: Vendor;

  @ManyToOne(() => Farmer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'farmer_id' })
  selectedFarmer: Farmer;

  @OneToMany(
    () => InwardProduct,
    (inwardProduct) => inwardProduct.inwardRegister,
    { nullable: true, onDelete: 'SET NULL', cascade: true },
  )
  @JoinColumn({ name: 'inward_register_id' })
  inwardProducts: InwardProduct[];
  @Column({
    type: 'enum',
    enum: Source,
    nullable: true,
  })
  source: Source;

  @ManyToOne(() => Customer, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'customer_id' })
  customerName: Customer;

  // @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  // purchasedQty: number;
   @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  incomingGrossQty: number;
  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  incomingNetQty: number;

  // @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  // inwardQtyInKg: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  inwardGrossQty: number;
  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  inwardNetQty: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  inwardCost: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  totalWeightInKg: number;

  @Column({ nullable: true })
  remarks: string;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'purchase_id' })
  purchasedBy: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  inwardBy: User;
}
