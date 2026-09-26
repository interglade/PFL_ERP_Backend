import { Entity, Column, OneToMany, JoinColumn, ManyToOne } from "typeorm";
import { ReturnedProducts } from "./returnProduct.entity";
import { format, toZonedTime } from "date-fns-tz";
import Model from "../../global/model.entity";
import { DeliveryChallanPurchase } from "../../deliveryChallans/deliverychllan/entity/deliveryChallan.entity";
import { Company } from "../../company/entity/company.entity";
import { Branches } from "../../branch/entity/branches.entity";
import { Customer } from "../../customer/addcustomer/entity/customer.entity";
import { User } from "../../employee/entity/user.entity";

@Entity("return_by_customer")
export class PostReturnByCustomer extends Model {
  // @Column({ length: 50 })
  // proformaInvNo: string;
  // @ManyToOne(() => Invoice, {
  //   nullable: true,
  //   onDelete: "SET NULL",
  //   cascade: true,
  // })
  // @JoinColumn({ name: "invoice_id" })
  // proformaInvNo: Invoice;

  @ManyToOne(() => DeliveryChallanPurchase, {
    //cascade:true,
    nullable: true,
    onDelete: "SET NULL",
    //cascade: true,
  })
  @JoinColumn({ name: "delivery_challan_id" }) 
  deliveryChallanNo: DeliveryChallanPurchase;
  @ManyToOne(() => Company, {
    cascade: true,
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "company_id" })
  companyName: Company;

  @ManyToOne(() => Branches, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'branch_id' })
    location: Branches;

    @ManyToOne(() => Customer, {
        nullable: true,
        onDelete: 'SET NULL',
        cascade: true,
      })
      @JoinColumn({ name: 'customer_id' })
      customerName: Customer;

  @Column({ type: "date",nullable:true ,
      transformer: {
        from: (value: string) => {
          return value ? format(toZonedTime(value, "Asia/Kolkata"), "dd-MM-yyyy hh:mm a", { timeZone: "Asia/Kolkata" }) : null;
        },
        to: (value: Date) => value,
      },
    })
  date: Date;

  @OneToMany(
    () => ReturnedProducts,
    (returnedProduct) => returnedProduct.postReturn,
    { cascade: true }
  )
  returnedProducts: ReturnedProducts[];

  // @Column({ type: "decimal", precision: 10, scale: 2 ,nullable:true})
  // totalPrice: number;
  // @Column({ type: "decimal", precision: 10, scale: 2 ,nullable:true})
  // totalQty: number;
   @Column({nullable:true })
  rbcNo: string;
  @Column({ type: "text",nullable:true })
  remark: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdby_id' })
  createdBy: User;
}
