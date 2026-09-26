import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';

import { format } from 'date-fns-tz';

import { InvoiceProduct } from './invoiceProduct.entity';
import Model from '../../global/model.entity';
import { Company } from '../../company/entity/company.entity';
import { DeliveryChallanPurchase } from '../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity';
import { Customer } from '../../customer/addcustomer/entity/customer.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { Address } from '../../address/entity/address.entity';
import { ammountStatus } from '../../utils/status.enum';
import { User } from '../../employee/entity/user.entity';


@Entity('invoices')
export class Invoice extends Model {
  @ManyToOne(() => Company, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'company_id' })
  companyName: Company;

  @Column({ nullable: true })
  invoiceNo: string;

  @Column({
    type: 'date',
    nullable: true,
    // transformer: {
    //   to: (value: Date) => value,
    //   from: (value: string) => (value ? format(new Date(value), 'dd-MM-yyyy') : null),
    // },
  })
  invoiceDate: Date;

  @Column({ nullable: true })
  pdfData: string;

  @ManyToOne(() => DeliveryChallanPurchase, (dc) => dc.invoices, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'delivery_challan_id' })
  deliveryChallan: DeliveryChallanPurchase;

  @OneToMany('InvoiceProduct', (product: any) => product.invoice, {
    cascade: true,
    nullable: true,
  })
  invoiceProducts: InvoiceProduct[];

  // Customer Invoice Fields
  @ManyToOne(() => Customer, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'customer_id' })
  customerName: Customer;

  @Column({ nullable: true })
  poNumber: string;

  @ManyToOne(() => Branches, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branch_id' })
  fromLocation: Branches;

  @ManyToOne(() => Address, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'billingAddres_id' })
  billingAddress: Address;

  @ManyToOne(() => Address, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'deliveryAddres_id' })
  deliveryAddress: Address;

  @Column({ nullable: true })
  vehicleNo: string;

  @Column({ nullable: true })
  placeOfSupply: string;

  // Amount and Weight Fields
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  totalProductAmount: number;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  netProductWeight: number;


  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  totalAmount: number;

  @Column({ name: 'amount_in_words', nullable: true })
  totalAmtInWords: string;

  // Tax Fields
  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  cgst: number;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  sgst: number;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  igst: number;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  taxAmount: number;


  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  discount: number;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  freight: number;

  @Column('decimal', { precision: 20, scale: 4, nullable: true })
  otherCharges: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @Column({
    type: 'enum',
    enum: ammountStatus,
    default: ammountStatus.UNPAID,
    nullable: true
  })
  ammountStatus: ammountStatus

}

