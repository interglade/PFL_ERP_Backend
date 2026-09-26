import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from "typeorm";



import { AqrParameter } from "./aqrQuality.entity";
import Model from "../../global/model.entity";
import { Company } from "../../company/entity/company.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { Source } from "../../utils/status.enum";
import { DeliveryChallanPurchase } from "../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity";
import { Vendor } from "../../vendor/createVendor/entity/vendor.entity";
import { Farmer } from "../../farmer/entity/farmer.entity";
import { Product } from "../../product/createproduct/entity/product.entity";
import { ProductVarient } from "../../product/productVarient/entity/productVarient.entity";
import { User } from "../../employee/entity/user.entity";
export enum AqrFor {
  purchase = "purchase",
  transfer = "transfer",
}

@Entity("aqr")
export class Aqr extends Model {


  @Column({ type: "enum", enum: AqrFor, nullable: true })
  aqrFor: AqrFor;

  @ManyToOne(() => Company, {
    cascade: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'company_id' })
  companyName: Company;    //

  @ManyToOne(() => Branches, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'branch_id' })
  location: Branches


  @Column({
    type: 'enum',
    enum: Source,
    nullable: true,
  })
  source: Source;

  @ManyToOne(() => DeliveryChallanPurchase, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "delivery_challan_id" }) // Define the foreign key column
  deliveryChallanNo: DeliveryChallanPurchase;


  @ManyToOne(() => Vendor, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'vendor_id' })
  selectedVendor: Vendor;

  @ManyToOne(() => Farmer, {
    onDelete: 'SET NULL',
    nullable: true,
    cascade: true,
  })
  @JoinColumn({ name: 'farmer_id' })
  selectedFarmer: Farmer;
  @ManyToOne(() => Branches, {
    nullable: true,
    onDelete: 'SET NULL',
    cascade: true,
  })
  @JoinColumn({ name: 'fromlocation_id' })
  fromLocation: Branches

  @ManyToOne(() => Product, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "product_id" })
  product: Product;

  @ManyToOne(() => ProductVarient, { onDelete: 'SET NULL', cascade: true })
  @JoinColumn({ name: 'varient_id' })
  variant: ProductVarient;



  @Column({ nullable: true })
  arrivedQty: string;
  @Column({
    type: 'date', nullable: true, default: null,
    //     transformer: {
    //   to: (value: Date) => value, 
    //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, 
    // },
  })
  arrivalDate: Date;

  @Column({ nullable: true })
  samplingQty: string;
  @Column({ nullable: true })
  aqrNo: string;



  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'purchase_id' })
  purchaseBy: User;




  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'received_id' })
  receivedBy: User;



  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'qccheck_id' })
  qcCheckBy: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'verified_id' })
  verifiedBy: User;



  @Column({ nullable: true, type: "decimal", precision: 100, scale: 3 })
  totalQty: number;

  @Column({ nullable: true, type: "decimal", precision: 100, scale: 3 })
  totalpercent: number;


  @Column({ type: "text", nullable: true })
  remark: string;





  @OneToMany(() => AqrParameter, (aqrParameter) => aqrParameter.aqr, {
    cascade: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "parameter_id" })
  parameters: AqrParameter[];
}





