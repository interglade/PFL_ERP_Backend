import { Entity, Column, ManyToOne, OneToMany } from "typeorm";
import Model from "../../../global/model.entity";
import { VendorCategory } from "../../vendorCategory/entity/vendorCategory.entity";



@Entity("vendor_subcategory")
export class VendorSubcategory extends Model {
  @Column()
  name: string;

  @ManyToOne(
    () => VendorCategory,
    (vendorCategory) => vendorCategory.vendorSubcategories,{ onDelete: "SET NULL" }
  )
  category: VendorCategory;

  
}
