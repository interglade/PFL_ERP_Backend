import { Repository } from "typeorm";
import { ProductCategory } from "../entity/product_category.entity";


export class ProductCategoryRepository extends Repository<ProductCategory> {}
