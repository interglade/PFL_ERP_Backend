import { Column, Entity, OneToOne } from "typeorm";
import Model from "../../../global/model.entity";
import { Vendor } from "./vendor.entity";


@Entity("vendor_sale_info")
export class VendorSaleInfo extends Model {

  @Column("character varying", {
    name: "contact_person_first_name",
    length: 400,
    nullable: true,
  })
  contactFName: string;

  @Column("character varying", {
    name: "contact_person_middle_name",
    length: 400,
    nullable: true,
  })
  contactMName: string;

  @Column("character varying", {
    name: "contact_person_last_name",
    length: 400,
    nullable: true,
  })
  contactLName: string;

  @Column("character varying", {
    name: "direct_contact_number",
    length: 400,
    nullable: true,
  })
  directContactNumber: string;

  @Column("character varying", {
    name: "mobile_number",
    length: 400,
    nullable: true,
  })
  mobileNumber: string;

  @Column("character varying", {
    name: "email",
    length: 100, // Increased email length
    nullable: true,
  })
  email: string;

   // OneToOne relationship with Vendor
   @OneToOne(() => Vendor, (vendor) => vendor.vendorSaleInfo,{ onDelete: "SET NULL" })
   vendor: Vendor;

}
