import { Column, Entity, OneToMany } from "typeorm";
import Model from "../../../global/model.entity";
import { ProductCategory } from "../../productCategory/entity/product_category.entity";


@Entity("product_classification")
export class ProductClassification extends Model {
  @Column()
  name: string;

  @OneToMany(() => ProductCategory, (category) => category.productClassification,{ onDelete: "SET NULL" ,cascade:true})
  categories: ProductCategory[];
  
}