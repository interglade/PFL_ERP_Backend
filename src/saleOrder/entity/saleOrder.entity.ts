import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from "typeorm";

import { SaleOrderProduct } from "./saleOrderProduct.entity";

import { format } from "date-fns";
import { Company } from "../../company/entity/company.entity";
import { PartyDetails } from "./partyDetails.entity";
import Model from "../../global/model.entity";

@Entity({ name: "sale_order" })
export class SaleOrder extends Model {
  @ManyToOne(() => Company, {cascade: true,nullable: true,onDelete: "SET NULL" })
  @JoinColumn({name: "company_id"})
   companyName: Company;

  @OneToOne(() => PartyDetails, {
    nullable: true,
    onDelete: "SET NULL",
    cascade: true,
  })
  @JoinColumn({ name: "bill_from_id" })
  billFrom: PartyDetails;

  @OneToOne(() => PartyDetails, {
    nullable: true,
    onDelete: "SET NULL",
    cascade: true,
  })
  @JoinColumn({ name: "shipped_from_id" })
  shippedFrom: PartyDetails;

  @OneToOne(() => PartyDetails, {
    nullable: true,
    onDelete: "SET NULL",
    cascade: true,
  })
  @JoinColumn({ name: "bill_to_id" })
  billTo: PartyDetails;

  @OneToOne(() => PartyDetails, {
    nullable: true,
    onDelete: "SET NULL",
    cascade: true,
  })
  @JoinColumn({ name: "shipped_to_id" })
  shippedTo: PartyDetails;

 

  @Column({ name: "po_number", type: "varchar", length: 50, unique: true })
  poNumber: string;

  @Column({ name: "po_date", type: "date",nullable:true , 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
})
  poDate: Date;

  @Column({ name: "expected_delivery_date", type: "date" ,nullable:true, 
  //   transformer: {
  //   to: (value: Date) => value, 
  //   from: (value: string) => value ? format(new Date(value), "dd-MM-yyyy") : null, // Convert to DD-MM-YYYY format
  // },
})
  expectedDeliveryDate: Date;

  @Column({ name: "customer_company_name", type: "varchar", length: 255,nullable:true })
  customerCompanyName: string;

  @Column({ name: "customer_id", nullable:true})
  customerId: string;
  @OneToMany(() => SaleOrderProduct, (saleOrderProduct) => saleOrderProduct.saleOrder, {
    nullable: true,
    cascade: true,
  })
  saleProducts: SaleOrderProduct[];
 
  @Column({ name: "amount_in_words", type: "text",nullable:true })
  amountInWords: string;

  @Column({ name: "vehicle_no", type: "varchar", length: 50,nullable:true })
  vehicleNo: string;

  @Column({ name: "prepared_by", type: "varchar", length: 255 ,nullable:true})
  preparedBy: string;

  @Column({ name: "verified_by", type: "varchar", length: 255,nullable:true })
  verifiedBy: string;

  @Column({ name: "authenticated_by", type: "varchar", length: 255,nullable:true })
  authenticatedBy: string;

  @Column({ name: "remark", type: "varchar", length: 255,nullable:true })
  remark: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  otherCharges: number;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  transportationCharges: number;

  // @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  // unloadingLocalLabour: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  labourCharges: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalDeduction: number;

  // @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  // grandTotal: number;
}
