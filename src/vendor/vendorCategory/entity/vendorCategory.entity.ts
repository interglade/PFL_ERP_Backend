import { Entity, Column, OneToMany } from "typeorm";

import Model from "../../../global/model.entity";
import { VendorSubcategory } from "../../vendorSubcategory/entity/vendorSubcategory.entity";



@Entity("vendor_category")
export class VendorCategory extends Model {
  @Column()
  name: string;
 
  @OneToMany(
    () => VendorSubcategory,
    (vendorSubcategory) => vendorSubcategory.category,{ onDelete: "SET NULL" }
  )
  vendorSubcategories: VendorSubcategory[];
}
