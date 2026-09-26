import { ChildEntity, Column, JoinColumn, ManyToOne } from "typeorm";
import { DeliveryChallanPurchase } from "../../deliverychllan/entity/deliveryChallan.entity";
import { Branches } from "../../../branch/entity/branches.entity";
import { Address } from "../../../address/entity/address.entity";



@ChildEntity("other-delivery-challan")
export class OtherDeliveryChallan extends DeliveryChallanPurchase {

    // @ManyToOne(() => Address, {
    //   nullable: true,
    //   onDelete: "SET NULL",
    //   cascade: true,
    // })
    // @JoinColumn({ name: "input_tolocation_id" })
    // toLocationInput: Address;
    @ManyToOne(() => Branches, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'other_from_location_id_for_other' })
  fromLocation: Branches;

@Column({ type: 'varchar', nullable: true, name: 'other_customer_name' })
    customer: string;
    
    @Column({ type: 'varchar', nullable: true, name: 'other_customer_contact_no' })
    customerContactNo: string;
    
    @Column({ type: 'varchar', nullable: true, name: 'other_customer_email' })
    customerEmail: string;
    @ManyToOne(() => Address, {
      nullable: true,
      onDelete: "SET NULL",
    })
    @JoinColumn({ name: "customer_address_for_other" })
    customerAddress: Address;
}
