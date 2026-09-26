import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  TableInheritance,
} from 'typeorm';
import Model from '../../../global/model.entity';
import { Company } from '../../../company/entity/company.entity';
import { OfficesData } from '../../../office/entity/offices.entity';
import { GRN } from '../../../grn/entity/grn.entity';
import { Item } from './dItem.entity';
import { Department, Status } from '../../../utils/status.enum';
import { Invoice } from '../../../invoice/entity/invoice.entity';
import { PostReturnByCustomer } from '../../../returnByCustomer/entity/postReturnByCustomer.entity';
import { User } from '../../../employee/entity/user.entity';


export enum DeliveryChallanType {
  CUSTOMER = 'customer',
  STOCK_TRANSFER_INTERNAL = 'cc-dc stock transfer',
  DC_DC_STOCK_TRANSFER = 'dc-dc stock transfer',
  OTHER = 'other',
}
@Entity('delivery_challan_purchase')
@TableInheritance({ column: { type: 'varchar', name: 'type', nullable: true } })
export class DeliveryChallanPurchase extends Model {
  @ManyToOne(() => Company, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'company_id' })
  companyName: Company;    //

  @ManyToOne(() => OfficesData, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'office_id' })
  offices: OfficesData;

  @ManyToOne(() => GRN, { nullable: true, cascade: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grn_id' })
  grnNo: GRN;

  @Column({ nullable: true })
  challanNo: string;
@Column({ nullable: true })
   transitInsuranceNo:string;
  @Column({ default: false })
  isReturned: boolean;

  @OneToMany(() => Item, (item) => item.deliveryChallan, {
    cascade: true,
    nullable: true,
  })
  deliveryChallanProducts: Item[];

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  totalProductAmount: number;
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  netProductWeight: number;
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  netPackagingMaterialWeight: number;
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  totalPackagingMaterialAmount: number;
  @Column({ name: 'amount in words', nullable: true })
  totalAmtInWords: string;

  @Column({ nullable: true })
  driverName: string;

  @Column({ nullable: true })
  contactNo: string;

  @Column({ nullable: true })
  altContactNo: string;

  @Column({ nullable: true })
  vehicleNo: string;

  @Column({ nullable: true })
  licenseNo: string;

  @Column({ name: 'rmn', nullable: true })
  rmn: string;

  @Column({ nullable: true })
  receiverName: string;

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

  @Column({
    type: 'enum',
    enum: Department,
    nullable: true,
  })
  requestingDepartment: Department;

  @Column({ type: 'text', nullable: true })
  remark: string;

  @OneToMany(() => Invoice, (invoice) => invoice.deliveryChallan, {
    cascade: true,
  })
  invoices: Invoice[];

  @OneToMany(
    () => PostReturnByCustomer,
    (returnByCustomer) => returnByCustomer.deliveryChallanNo,
    {
      cascade: true,
    },
  )
  returns: PostReturnByCustomer[];
   @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'created_by' })
    createdBy: User;
}

// @Column({ nullable: true })
// partyName: string;
// @ManyToOne(() => Customer, (customer) => customer.deliveryChallan, {
//     cascade: true,
//     nullable: true,
//     onDelete: "SET NULL",
//   })
//   @JoinColumn({ name: "customer_id" })
//   customer: Customer;
// @Column({ nullable: true })
// poNumber: string;
//  @ManyToOne(() => Address, {
//     nullable: true,
//     onDelete: "SET NULL",
//     cascade: true,
//   })
//   @JoinColumn({ name: "input_tolocation_id" })
//   toLocationInput: Address;

//   @ManyToOne(() => Address, {
//     nullable: true,
//     onDelete: "SET NULL",
//     cascade: true,
//   })
//   @JoinColumn({ name: "input_fromlocation_id" })
//   fromLocationInput: Address;

// @ManyToOne(() => User, { nullable: true,cascade:true, onDelete: "CASCADE" })
// @JoinColumn({ name: "requested_by_employee_id" })
// requestedBy: User;

// @ManyToOne(() => Branches, {
//   nullable: true,
//   onDelete: "SET NULL",
//   cascade: true,
// })
// @JoinColumn({ name: "from_location_id" })
// fromLocation: Branches;

// @ManyToOne(() => Branches, {
//   nullable: true,
//   onDelete: "SET NULL",
//   cascade: true,
// })
// @JoinColumn({ name: "to_location_id" })
// toLocation: Branches ;

// @Column({
//   type: 'enum',
//   enum: DeliveryChallanType,

//   nullable: true,
// })
// deliveryCType: DeliveryChallanType;

// @Column({ nullable: true })
// otherCType: string;
