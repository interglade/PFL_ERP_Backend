import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import Model from "../../../global/model.entity";
import { ProductClassification } from "../../productClassification/entity/product_classification.entity";
import { ProductSubcategory } from "../../productSubcategory/entity/product_subcategory.entity";
import { Product } from "../../createproduct/entity/product.entity";


@Entity("product_category")
export class ProductCategory extends Model {
  @Column()
  name: string;

  @ManyToOne(() => ProductClassification, (classification) => classification.categories,{ onDelete: "SET NULL"})
  @JoinColumn({ name: "classification_id" })  // Foreign key column name
  productClassification: ProductClassification | null;

  @OneToMany(() => ProductSubcategory, (subcategory) => subcategory.category,{ onDelete: "SET NULL"})
  subcategories: ProductSubcategory[];

  @OneToMany(() => Product, (product) => product.category,{ onDelete: "SET NULL" })
  products: Product[];
}
