import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from "typeorm";
import Model from "../../../global/model.entity";

import { Customer } from "./customer.entity";
import { Address } from "../../../address/entity/address.entity";

@Entity("customer_key_mobile_numbers")
export class keyMobileNoData extends Model {
    @Column({ name: 'account_department_fname', nullable: true})
    accDeptFName: string;
    @Column({ name: 'account_department_mname', nullable: true})
    accDeptMName: string;
    @Column({ name: 'account_department_lname', nullable: true})
    accDeptLName: string;
    @Column({ name: 'account_department_mobile_no', nullable: true})
    accDeptMobileNo: string;
    @Column({ name: 'owner_fname', nullable: true})
    ownerFName: string;
    @Column({ name: 'owner_mname', nullable: true})
    ownerMName: string;
    @Column({ name: 'owner_lname', nullable: true})
    ownerLName: string;
    @Column({ name: 'owner_mobile_number', nullable: true})
    ownerMobileNo: string;
    @Column({ name: 'mandi_licence_no', nullable: true})
    mandiLicenceNo: string;
    @Column({ name: 'mandi_licence_copy', nullable: true})
    mandiLicenceCopy: string;
    @Column({ name: 'regi_no', nullable: true})
    regiNo: string;
    @Column({ name: 'regi_copy', nullable: true})
    regiCopy: string;
    @Column({ name: 'electricity_bill', nullable: true})
    electricityBill: string;
    @Column({ name: 'consumer_no', nullable: true})
    consumerNo: string;
    @Column({ name: 'electricity_copy', nullable: true})
    electricityBillCopy: string;
    @Column({ name: 'reason_for_electricity_bill', nullable: true})
    notElectricityBillReason: string;
    @Column({ name: 'customer_black_listed_by', nullable: true})
    customerBlacklisted: string;
    @Column({ name: 'reason_for_backlisted', nullable: true})
    ifBlacklistedReason: string;
    @Column({ name: 'backlisted_by', nullable: true})
    blackListedBy: string;
    @Column({ name: 'visiting_card', nullable: true})
    visitingCard: string;
    @Column({ name: 'visiting_contact_no', nullable: true})
    visitingContactNo: string;
    @Column({ name: 'visiting_card_copy', nullable: true})
    visitingCardCopy: string;
    @Column({ name: 'reason_for_visiting_card', nullable: true})
    notVisitingCardReason: string;
    @Column({ name: 'ref1_fname', nullable: true})
    ref1FName: string;
    
    @Column({ name: 'ref1_mname', nullable: true})
    ref1MName: string;
    @Column({ name: 'ref1_lname', nullable: true})
    ref1LName: string;
    
    // @Column({ name: 'mandi_licence_copy', nullable: true})
    // ref1Address: Address;
    @ManyToOne(() => Address, { cascade: true, nullable: true,onDelete: "SET NULL" })
  @JoinColumn()
  ref1Address: Address;
    @Column({ name: 'ref1_contact_no', nullable: true})
    ref1ContactNo: string;
    @Column({ name: 'ref1_contact_email', nullable: true})
    ref1Email: string;
    @Column({ name: 'ref2_fname', nullable: true})
    ref2FName: string;
    @Column({ name: 'ref2_mname', nullable: true})
    ref2MName: string;
    @Column({ name: 'ref2_lname', nullable: true})
    ref2LName: string;
    @ManyToOne(() => Address, { cascade: true, nullable: true,onDelete: "SET NULL"})
    @JoinColumn()
    ref2Address: Address;
    @Column({ name: 'ref2_contact_no', nullable: true})
    ref2ContactNo: string;
    @Column({ name: 'ref1_email', nullable: true})
    ref2Email: string;
    @OneToOne(() => Customer, (customer) => customer.keyMobileNumbers,{ onDelete: "SET NULL" })
  customer: Customer;


}
 