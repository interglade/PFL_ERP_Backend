import { Column, Entity, JoinColumn, OneToOne } from "typeorm";
import Model from "../../../global/model.entity";
import { Address } from "../../../address/entity/address.entity";
import { AccountType } from "../../../customer/addcustomer/entity/bankDetailsCust.entity";
import { Vendor } from "./vendor.entity";


@Entity('bank_details_vendor')
export class BankDetailsvend extends Model {
    @Column("character varying", {
        name: "beneficiary_first_name",
        length: 400,
        nullable: true
    })
    beneficiaryFName: string;

    @Column("character varying", {
        name: "beneficiary_middle_name",
        length: 400,
        nullable: true
    })
    beneficiaryMName: string;

    @Column("character varying", {
        name: "beneficiary_last_name",
        length: 400,
        nullable: true
    })
    beneficiaryLName: string;

    @Column("character varying", {
        name: "bank_name",
        length: 400,
        nullable: true,
    })
    bankName: string;

    // One-to-One relationship with Address for branch address
    @OneToOne(() => Address, { nullable: true ,onDelete: "SET NULL",cascade:true})
    @JoinColumn({ name: "branch_address_id" }) // Maps the relation to a column in the current entity
    branchAddress: Address;

    @Column({
        type: 'enum',
        enum: AccountType,
        name: 'type_of_account',
        nullable: true,
    })
    typeOfAcc: AccountType;

    @Column("character varying", {
        name: "ifsc_Code",
        length: 400,
        nullable: true,
    })
    ifscCode: string;

    @Column("character varying", {
        name: "SWIFT_Number",
        length: 400,
        nullable: true,
    })
    swiftNo: string;

    @Column("character varying", {
        name: "invoice_currency",
        length: 400,
        nullable: true,
    })
    invoiceCurrency: string;

    @Column("character varying", {
        name: "cancelledChequeCopy",
        length: 400,
        nullable: true,
    })
    cancelledChequeCopy: string;

    @Column({
        name: 'if_cancelled_cheque',
        nullable: true,
       
    })
    ifCancelledCheque: boolean;


    @Column( { nullable: true })
    bankCompanyName:string;

    
    // One-to-One relationship with Vendor
    @OneToOne(() => Vendor, (vendor) => vendor.vendorBankDetails,{ onDelete: "SET NULL" })
    vendor: Vendor;
}
