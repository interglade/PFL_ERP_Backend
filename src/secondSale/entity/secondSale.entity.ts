import { Entity, Column, OneToMany, ManyToOne, JoinColumn, OneToOne, Index } from 'typeorm';

import { SecondSaleProduct } from './secondSaleProduct.entity';

import { join } from 'path/posix';
;
import { format } from 'date-fns';
import { Company } from '../../company/entity/company.entity';
import Model from '../../global/model.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { Address } from '../../address/entity/address.entity';
import type { WalkInCustomerType } from '../../global/walkInCustomer/walkInCustomer';


@Entity({ name: 'second_sale_document' })
export class SecondSale extends Model {
  /** Transaction number of the deal this document belongs to (docs/transaction-tracking-plan.md §9). */
  @Index('IDX_second_sale_document_txn_no')
  // Written only by src/transactions (raw SQL); never from a request body through an entity save.
  @Column({ name: 'txn_no', type: 'varchar', length: 13, nullable: true, insert: false, update: false })
  txnNo: string | null;

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



  @Column({
    type: 'date',
    // transformer: {
    //   to: (value: Date) => value,
    //   from: (value: string) =>
    //     value ? format(new Date(value), 'dd-MM-yyyy') : null, // Convert to DD-MM-YYYY format
    // },
  })
  saleDate: string;

  @Column({ type: 'text', nullable: true })
  customerName: string;


    @Column({ type: 'text', nullable: true })
  secondSaleNo: string | null;

  @Column({ type: 'text', nullable: true })
  customerContactNo: string;
   @Column({ type: 'text', nullable: true })
 customerEmail: string;

  @Column({ type: 'text', nullable: true })
  reasonForSale: string;

  // Walk-in customer details: the same fields as the Other DC (global/walkInCustomer).
  @Column({ type: 'varchar', nullable: true, name: 'customer_alt_contact_no' })
  customerAltContactNo: string | null;

  /** 'individual' or 'business' (WALK_IN_CUSTOMER_TYPES). */
  @Column({ type: 'varchar', length: 20, nullable: true, default: 'individual', name: 'customer_type' })
  customerType: WalkInCustomerType | null;

  /** Optional; 10-character PAN, stored upper case. */
  @Column({ type: 'varchar', length: 10, nullable: true, name: 'customer_pan_no' })
  customerPanNo: string | null;

  // Was `customerAddress` (one-to-one, column customeraddress_id).
  @ManyToOne(() => Address, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'billing_address_id' })
  billingAddress: Address | null;

  /** When true there is no shipping address of its own: the goods go to the billing address. */
  @Column({ type: 'boolean', default: true, name: 'ship_to_same_as_billing' })
  shipToSameAsBilling: boolean;

  @ManyToOne(() => Address, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'shipping_address_id' })
  shippingAddress: Address | null;

  /** State the goods are supplied to; defaults to the shipping (or billing) address state. */
  @Column({ type: 'varchar', nullable: true, name: 'place_of_supply' })
  placeOfSupply: string | null;



  @OneToMany(() => SecondSaleProduct, (product) => product.secondSaleRegister, {
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'second_sale_id' })
  secondSaleProducts: SecondSaleProduct[];

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  totalNetWeight: number;

   @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  totalGrossWeight: number;

  @Column({ nullable: true, type: 'decimal', precision: 100, scale: 3 })
  totalAmt: number;

  @Column({ nullable: true, type: 'text' })
   totalAmtInWords: string;
   
  @Column({ type: 'decimal', nullable: true })
  paidAmount: number;

  @Column({ nullable: true })
  paymentMode: string;

  @Column({ type: 'decimal', nullable: true })
  pendingAmt: number;

  @Column({ type: 'text', nullable: true })
  remarks: string;

  
  
}
