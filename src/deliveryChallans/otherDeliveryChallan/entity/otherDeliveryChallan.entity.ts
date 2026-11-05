import { ChildEntity, Column, JoinColumn, ManyToOne } from "typeorm";
import { DeliveryChallanPurchase } from "../../deliverychllan/entity/deliveryChallan.entity";
import { Branches } from "../../../branch/entity/branches.entity";
import { Address } from "../../../address/entity/address.entity";
import type { WalkInCustomerType } from "../../../global/walkInCustomer/walkInCustomer";



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

    @Column({ type: 'varchar', nullable: true, name: 'other_customer_alt_contact_no' })
    customerAltContactNo: string | null;

    /** 'individual' or 'business' (WALK_IN_CUSTOMER_TYPES). */
    @Column({ type: 'varchar', length: 20, nullable: true, default: 'individual', name: 'other_customer_type' })
    customerType: WalkInCustomerType | null;

    /** Optional; 10-character PAN, stored upper case. */
    @Column({ type: 'varchar', length: 10, nullable: true, name: 'other_customer_pan_no' })
    customerPanNo: string | null;

    @ManyToOne(() => Address, {
      nullable: true,
      onDelete: "SET NULL",
    })
    @JoinColumn({ name: "other_billing_address_id" })
    billingAddress: Address | null;

    /** When true there is no shipping address of its own: the goods go to the billing address. */
    @Column({ type: 'boolean', default: true, name: 'other_ship_to_same_as_billing' })
    shipToSameAsBilling: boolean;

    @ManyToOne(() => Address, {
      nullable: true,
      onDelete: "SET NULL",
    })
    @JoinColumn({ name: "other_shipping_address_id" })
    shippingAddress: Address | null;

    /** State the goods are supplied to; defaults to the shipping (or billing) address state. */
    @Column({ type: 'varchar', nullable: true, name: 'other_place_of_supply' })
    placeOfSupply: string | null;
}

