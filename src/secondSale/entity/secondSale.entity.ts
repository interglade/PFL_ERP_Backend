import { Entity, Column, OneToMany, ManyToOne, JoinColumn, OneToOne } from 'typeorm';

import { SecondSaleProduct } from './secondSaleProduct.entity';

import { join } from 'path/posix';
;
import { format } from 'date-fns';
import { Company } from '../../company/entity/company.entity';
import Model from '../../global/model.entity';
import { Branches } from '../../branch/entity/branches.entity';
import { DeliveryChallanPurchase } from '../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity';
import { Address } from '../../address/entity/address.entity';


@Entity({ name: 'second_sale_document' })
export class SecondSale extends Model {
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



  @ManyToOne(() => DeliveryChallanPurchase, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true, // Enable cascade save
  })
  @JoinColumn({ name: 'delivery_challan_id'}) // Define the foreign key column
  deliveryChallanNo: DeliveryChallanPurchase;

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

   @OneToOne(() => Address, (add) => add.secondSaleRegister, {
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'customeraddress_id' })
  customerAddress: Address

  

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
