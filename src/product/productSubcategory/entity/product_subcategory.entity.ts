import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import Model from "../../../global/model.entity";
import { ProductCategory } from "../../productCategory/entity/product_category.entity";
import { Product } from "../../createproduct/entity/product.entity";



@Entity("product_subcategory")
export class ProductSubcategory extends Model {
  @Column()
  name: string;

  @ManyToOne(() => ProductCategory, (category) => category.subcategories,{ onDelete: "SET NULL" ,cascade:true})
  @JoinColumn({ name: "category_id" })  // Foreign key column for category
  category: ProductCategory | null;

  @OneToMany(() => Product, (product) => product.subcategory, {
    //cascade: true,
    onDelete: "SET NULL",
  })
  products: Product[];
}
